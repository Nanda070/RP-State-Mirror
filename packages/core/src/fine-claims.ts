/**
 * «Я оплатил»: the fined person reports the payment with a screenshot, the staff confirms it with
 * one press instead of `/штраф-оплачено`.
 *
 * The reports go to one channel chosen in the dashboard (`fines.claimChannelId`); the feature is
 * off while it is empty. The bot posts every report there itself, so its buttons always work —
 * unlike buttons under a message sent through a faction's own webhook.
 */
import { DecisionStatus, RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, writeAuditEvent, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";
import { enqueueJob } from "./jobs.js";
import { createButtonAction } from "./message-designs.js";
import { MODULE_JOB_TYPES, enqueueFineEditPaid } from "./module-jobs.js";
import { findDiscordIdByStatic } from "./notifications.js";
import { getSetting } from "./settings.js";

export const FINE_CLAIM_MAX_FILES = 3;

export async function finePaymentClaimsEnabled(): Promise<boolean> {
  return (await getSetting("fines.claimChannelId")) !== null;
}

/**
 * The checks that do not need the screenshot yet, so the bot can refuse before it opens the
 * window: the feature is on, the fine is unpaid, the person may report it, no report is waiting.
 */
export async function assertCanClaimFinePayment(fineId: string, claimantDiscordId: string) {
  if (!(await finePaymentClaimsEnabled())) {
    throw new UserError("Сообщения об оплате не настроены: администрация ещё не выбрала для них канал.");
  }
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine || fine.status !== RecordStatus.ACTIVE) throw new UserError("Штраф уже оплачен или закрыт.");
  const ownerDiscordId = await findDiscordIdByStatic(fine.staticId);
  if (ownerDiscordId && ownerDiscordId !== claimantDiscordId) {
    throw new UserError("Сообщить об оплате может владелец статика, на который выписан штраф.");
  }
  const waiting = await prisma.finePaymentClaim.findFirst({
    where: { fineId, decision: DecisionStatus.PENDING },
    select: { id: true },
  });
  if (waiting) throw new UserError("Сообщение об оплате этого штрафа уже ждёт подтверждения.");
  return fine;
}

const createClaimSchema = z.object({
  fineId: z.string().min(1),
  claimantDiscordId: z.string().min(1).max(32),
  comment: z.string().trim().max(1000).nullish(),
  evidenceFileIds: z
    .array(z.string().min(1))
    .min(1, "Приложите скриншот оплаты.")
    .max(FINE_CLAIM_MAX_FILES, `Не больше ${FINE_CLAIM_MAX_FILES} скриншотов.`),
});

export async function createFinePaymentClaim(input: z.input<typeof createClaimSchema>, context: AuditContext) {
  const parsed = createClaimSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Проверьте данные.");
  const data = parsed.data;
  await assertCanClaimFinePayment(data.fineId, data.claimantDiscordId);

  return auditedMutation(context, "fine_claim.created", "fine_claim", async (tx) => {
    // Two reports sent at the same moment queue here; the second one sees the first.
    await tx.$queryRaw`SELECT id FROM fines WHERE id = ${data.fineId} FOR UPDATE`;
    const fine = await tx.fine.findUnique({ where: { id: data.fineId }, select: { status: true } });
    if (!fine || fine.status !== RecordStatus.ACTIVE) throw new UserError("Штраф уже оплачен или закрыт.");
    const waiting = await tx.finePaymentClaim.findFirst({
      where: { fineId: data.fineId, decision: DecisionStatus.PENDING },
      select: { id: true },
    });
    if (waiting) throw new UserError("Сообщение об оплате этого штрафа уже ждёт подтверждения.");

    const created = await tx.finePaymentClaim.create({
      data: {
        fineId: data.fineId,
        claimantDiscordId: data.claimantDiscordId,
        comment: data.comment?.trim() || null,
        evidenceFileIds: data.evidenceFileIds,
      },
    });
    const approve = await createButtonAction("fine.claim_approve", { claimId: created.id }, tx);
    const reject = await createButtonAction("fine.claim_reject", { claimId: created.id }, tx);
    const claim = await tx.finePaymentClaim.update({
      where: { id: created.id },
      data: { reviewButtons: { approve: approve.customId, reject: reject.customId } },
    });
    await enqueueJob({ type: MODULE_JOB_TYPES.FINE_CLAIM_REVIEW, payload: { claimId: claim.id } }, tx);
    return { entityId: claim.id, after: claim, result: claim };
  });
}

/**
 * One decision per report; the reporter cannot confirm their own. A confirmation marks the fine
 * paid — the same change and the same follow-up job as `/штраф-оплачено`.
 */
export async function decideFinePaymentClaim(
  id: string,
  decision: Exclude<DecisionStatus, "PENDING">,
  actorDiscordId: string,
  reason: string | null,
  context: AuditContext,
) {
  const rejectionReason = reason?.trim() ?? "";
  if (decision === DecisionStatus.REJECTED && !rejectionReason) throw new UserError("Укажите причину отказа.");
  return auditedMutation(context, `fine_claim.${decision.toLowerCase()}`, "fine_claim", async (tx) => {
    const current = await tx.finePaymentClaim.findUnique({ where: { id }, include: { fine: true } });
    if (!current) throw new UserError("Сообщение об оплате не найдено.");
    if (current.claimantDiscordId === actorDiscordId) {
      throw new UserError("Своё сообщение об оплате подтверждает другой человек.");
    }
    const now = new Date();
    const { count } = await tx.finePaymentClaim.updateMany({
      where: { id, decision: DecisionStatus.PENDING },
      data: {
        decision,
        decidedByDiscordId: actorDiscordId,
        decidedAt: now,
        rejectionReason: decision === DecisionStatus.REJECTED ? rejectionReason : null,
      },
    });
    if (count !== 1) throw new UserError("По этому сообщению об оплате решение уже принято.");

    if (decision === DecisionStatus.APPROVED) {
      const paid = await tx.fine.updateMany({
        where: { id: current.fineId, status: RecordStatus.ACTIVE },
        data: { status: RecordStatus.CLOSED, paidAt: now, paidByDiscordId: actorDiscordId },
      });
      if (paid.count !== 1) throw new UserError("Штраф уже оплачен или закрыт.");
      await writeAuditEvent(
        {
          ...context,
          action: "fine.paid",
          entityType: "fine",
          entityId: current.fineId,
          before: { status: current.fine.status },
          after: { status: RecordStatus.CLOSED, paidByDiscordId: actorDiscordId, claimId: id },
        },
        tx,
      );
      await enqueueFineEditPaid(current.fineId, tx);
    }
    await tx.buttonAction.updateMany({
      where: {
        action: { in: ["fine.claim_approve", "fine.claim_reject"] },
        params: { path: ["claimId"], equals: id },
      },
      data: { status: RecordStatus.ARCHIVED },
    });
    await enqueueJob({ type: MODULE_JOB_TYPES.FINE_CLAIM_DECIDED, payload: { claimId: id } }, tx);
    const updated = await tx.finePaymentClaim.findUniqueOrThrow({ where: { id } });
    return {
      entityId: id,
      before: { decision: current.decision },
      after: { decision, decidedByDiscordId: actorDiscordId, rejectionReason: updated.rejectionReason },
      result: updated,
    };
  });
}

/** Where the bot posted the report, so the message can be edited when the decision is made. */
export async function setFinePaymentClaimReviewMessage(id: string, message: { channelId: string; messageId: string }) {
  return prisma.finePaymentClaim.update({
    where: { id },
    data: { reviewChannelId: message.channelId, reviewMessageId: message.messageId },
  });
}

export async function getFinePaymentClaim(id: string) {
  return prisma.finePaymentClaim.findUnique({ where: { id }, include: { fine: true } });
}

/** The report that waits for the staff, by fine: the mark and the actions in the fines registry. */
export async function listPendingFineClaims(fineIds: readonly string[]) {
  if (fineIds.length === 0) return new Map<string, Awaited<ReturnType<typeof prisma.finePaymentClaim.findMany>>[number]>();
  const rows = await prisma.finePaymentClaim.findMany({
    where: { fineId: { in: [...fineIds] }, decision: DecisionStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });
  return new Map(rows.map((row) => [row.fineId, row]));
}

export async function countPendingFineClaims(): Promise<number> {
  return prisma.finePaymentClaim.count({ where: { decision: DecisionStatus.PENDING } });
}
