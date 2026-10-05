/**
 * Registry actions from the dashboard (PLAN §14.4): everything an admin does to a record with a
 * button — close a wanted order, mark a fine paid, decide an application, revoke a badge, retry a job.
 * One entry point keeps the rules in one place: the same core functions the bot uses, the same
 * follow-up jobs (the Discord card is edited either way), the same audit trail.
 */
import {
  type AuditActorType,
  DecisionStatus,
  JobStatus,
  type Prisma,
  RecordStatus,
  TransferStatus,
  prisma,
} from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";
import { decideFinePaymentClaim } from "./fine-claims.js";
import { cancelFine, markFinePaid, updateFineAmount } from "./fines.js";
import { decideFormSubmission } from "./forms.js";
import { cancelJob, enqueueJob } from "./jobs.js";
import {
  MODULE_JOB_TYPES,
  enqueueFineEditPaid,
  enqueuePersonnelPublish,
  enqueueWantedEditClosed,
} from "./module-jobs.js";
import { revokePersonnelEvent } from "./personnel.js";
import {
  closeIcBlacklistEntry,
  decideRegistration,
  decideTransfer,
  revokeToken,
  updateCharacterStaticId,
} from "./stage4.js";
import { cancelWanted, closeWanted } from "./wanted.js";

export class RegistryActionError extends UserError {
  override name = "RegistryActionError";
}

export const REGISTRY_ACTIONS = {
  wanted: ["close", "cancel"],
  fine: ["paid", "cancel", "set_amount"],
  personnel: ["revoke", "resend", "kick"],
  registration: ["approve", "reject", "revoke"],
  transfer: ["approve_source", "reject_source", "approve_target", "reject_target", "cancel"],
  token: ["revoke"],
  character: ["archive", "set_static"],
  ic_blacklist: ["close"],
  form_submission: ["approve", "reject"],
  fine_claim: ["approve", "reject"],
  job: ["retry", "cancel"],
} as const;

export type RegistryEntity = keyof typeof REGISTRY_ACTIONS;

/** Actions that touch the system itself, not a module record: super admins only. */
export const SYSTEM_REGISTRY_ENTITIES: readonly RegistryEntity[] = ["job"];

export const registryActionSchema = z.object({
  entity: z.enum(Object.keys(REGISTRY_ACTIONS) as [RegistryEntity, ...RegistryEntity[]]),
  id: z.string().min(1).max(64),
  action: z.string().min(1).max(32),
  /** Reason of a refusal, a cancellation or a removal; evidence link for a closed wanted order. */
  text: z.string().trim().max(2000).optional(),
  actorDiscordId: z.string().min(1).max(32),
});
export type RegistryActionInput = z.input<typeof registryActionSchema>;

function need(text: string | undefined, message: string): string {
  if (!text) throw new RegistryActionError(message);
  return text;
}

/** Withdraws an approved registration before its term ends (the static and the plate become free). */
export async function revokeRegistration(id: string, actorDiscordId: string, reason: string, context: AuditContext) {
  return auditedMutation(context, "registration.revoked", "registration", async (tx) => {
    const current = await tx.registration.findUnique({ where: { id } });
    if (!current || current.status !== RecordStatus.ACTIVE || current.decision !== DecisionStatus.APPROVED) {
      throw new RegistryActionError("Снять можно только действующую одобренную регистрацию.");
    }
    const updated = await tx.registration.update({
      where: { id },
      data: { status: RecordStatus.REVOKED, rejectionReason: reason },
    });
    // The same job as for an expiry: the card loses its «active» look and the owner gets a DM.
    await enqueueJob({ type: MODULE_JOB_TYPES.REGISTRATION_EXPIRED, payload: { registrationId: id } }, tx);
    return {
      entityId: id,
      before: { status: current.status },
      after: { status: updated.status, reason, revokedByDiscordId: actorDiscordId },
      result: updated,
    };
  });
}

/** Closes a transfer nobody will decide (wrong faction, the player changed their mind). */
export async function cancelTransfer(id: string, actorDiscordId: string, reason: string, context: AuditContext) {
  return auditedMutation(context, "transfer.cancelled", "transfer", async (tx) => {
    await tx.$queryRaw`SELECT id FROM transfers WHERE id = ${id} FOR UPDATE`;
    const current = await tx.transfer.findUnique({ where: { id } });
    if (!current || current.status !== TransferStatus.PENDING) {
      throw new RegistryActionError("Перевод уже закрыт или не найден.");
    }
    const updated = await tx.transfer.update({
      where: { id },
      data: { status: TransferStatus.CLOSED, rejectionReason: reason },
    });
    await enqueueJob({ type: MODULE_JOB_TYPES.TRANSFER_DECIDED, payload: { transferId: id } }, tx);
    return {
      entityId: id,
      before: { status: current.status },
      after: { status: updated.status, reason, cancelledByDiscordId: actorDiscordId },
      result: updated,
    };
  });
}

/**
 * Frees a character slot: the character and its active badge are archived, nothing is deleted.
 * Without this a typo in a static would occupy one of the three slots forever.
 */
export async function archiveCharacter(id: string, actorDiscordId: string, reason: string, context: AuditContext) {
  return auditedMutation(context, "character.archived", "character", async (tx) => {
    const current = await tx.character.findUnique({ where: { id } });
    if (!current || current.status !== RecordStatus.ACTIVE) {
      throw new RegistryActionError("Персонаж не найден или уже в архиве.");
    }
    const pending = await tx.transfer.count({ where: { characterId: id, status: TransferStatus.PENDING } });
    if (pending > 0) throw new RegistryActionError("У персонажа есть перевод на рассмотрении — сначала закройте его.");
    const now = new Date();
    const tokens = await tx.token.updateMany({
      where: { characterId: id, status: RecordStatus.ACTIVE },
      data: { status: RecordStatus.REVOKED, revokedAt: now },
    });
    const updated = await tx.character.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
    return {
      entityId: id,
      before: { status: current.status, staticId: current.staticId, slot: current.slot },
      after: { status: updated.status, reason, archivedByDiscordId: actorDiscordId, tokensRevoked: tokens.count },
      result: updated,
    };
  });
}

/** Puts a failed or cancelled job back in the queue with a fresh set of attempts. */
export async function retryJob(id: string, context: AuditContext) {
  return auditedMutation(context, "job.retried", "job", async (tx) => {
    const current = await tx.job.findUnique({ where: { id } });
    if (!current || (current.status !== JobStatus.FAILED && current.status !== JobStatus.CANCELLED)) {
      throw new RegistryActionError("Повторить можно только упавшую или отменённую задачу.");
    }
    const updated = await tx.job.update({
      where: { id },
      data: {
        status: JobStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        completedAt: null,
        lastError: null,
      },
    });
    return {
      entityId: id,
      before: { status: current.status, lastError: current.lastError },
      after: { status: updated.status },
      result: updated,
    };
  });
}

/** Runs one registry action and returns the sentence shown to the admin. */
export async function runRegistryAction(input: RegistryActionInput, context: AuditContext): Promise<string> {
  const data = registryActionSchema.parse(input);
  const allowed: readonly string[] = REGISTRY_ACTIONS[data.entity];
  if (!allowed.includes(data.action)) throw new RegistryActionError("Неизвестное действие.");
  const { id, text, actorDiscordId } = data;

  switch (`${data.entity}.${data.action}`) {
    case "wanted.close": {
      const wanted = await prisma.wanted.findUnique({ where: { id }, select: { number: true } });
      if (!wanted) throw new RegistryActionError("Розыск не найден.");
      const closed = await closeWanted(
        {
          wantedNumber: wanted.number,
          closedByDiscordId: actorDiscordId,
          evidence: need(text, "Укажите доказательства исполнения (ссылку или описание)."),
        },
        context,
      );
      await enqueueWantedEditClosed(closed.id);
      return `Розыск ${closed.number} исполнен.`;
    }
    case "wanted.cancel": {
      const cancelled = await cancelWanted(id, context);
      return `Розыск ${cancelled.number} отменён.`;
    }
    case "fine.paid": {
      const fine = await prisma.fine.findUnique({ where: { id }, select: { number: true } });
      if (!fine) throw new RegistryActionError("Штраф не найден.");
      const paid = await markFinePaid({ fineNumber: fine.number, paidByDiscordId: actorDiscordId }, context);
      await enqueueFineEditPaid(paid.id);
      return `Штраф ${paid.number} отмечен оплаченным.`;
    }
    case "fine.cancel": {
      const cancelled = await cancelFine(id, context);
      return `Штраф ${cancelled.number} отменён.`;
    }
    case "fine.set_amount": {
      const amount = Number(need(text, "Укажите новую сумму.").replace(/[\s$.,]/g, ""));
      const updated = await updateFineAmount(id, amount, context);
      return `Сумма штрафа ${updated.number} изменена.`;
    }
    case "personnel.resend": {
      const event = await prisma.personnelEvent.findUnique({ where: { id }, select: { status: true } });
      if (!event || event.status !== RecordStatus.ACTIVE) throw new RegistryActionError("Событие не найдено или отозвано.");
      await enqueuePersonnelPublish(id);
      return "Событие будет опубликовано заново.";
    }
    case "personnel.kick": {
      const event = await prisma.personnelEvent.findUnique({ where: { id }, select: { type: true, status: true } });
      if (!event || event.status !== RecordStatus.ACTIVE || event.type !== "dismissal") {
        throw new RegistryActionError("Исключить с сервера можно по действующему событию об увольнении.");
      }
      await enqueueJob({
        type: MODULE_JOB_TYPES.PERSONNEL_KICK,
        payload: { personnelEventId: id, requestedByDiscordId: actorDiscordId },
        maxAttempts: 2,
      });
      return "Бот исключит сотрудника с сервера фракции. Результат — в журнале аудита.";
    }
    case "personnel.revoke":
      await revokePersonnelEvent(id, context);
      return "Кадровое событие отозвано.";
    case "registration.approve":
      await decideRegistration(id, DecisionStatus.APPROVED, actorDiscordId, null, context);
      return "Регистрация одобрена.";
    case "registration.reject":
      await decideRegistration(
        id,
        DecisionStatus.REJECTED,
        actorDiscordId,
        need(text, "Укажите причину отказа."),
        context,
      );
      return "В регистрации отказано.";
    case "fine_claim.approve":
      await decideFinePaymentClaim(id, DecisionStatus.APPROVED, actorDiscordId, null, context);
      return "Оплата подтверждена, штраф закрыт.";
    case "fine_claim.reject":
      await decideFinePaymentClaim(id, DecisionStatus.REJECTED, actorDiscordId, need(text, "Укажите причину отказа."), context);
      return "Сообщение об оплате отклонено.";
    case "form_submission.approve":
      await decideFormSubmission(id, DecisionStatus.APPROVED, actorDiscordId, null, context);
      return "Ответ одобрен.";
    case "form_submission.reject":
      await decideFormSubmission(id, DecisionStatus.REJECTED, actorDiscordId, need(text, "Укажите причину отказа."), context);
      return "В ответе отказано.";
    case "registration.revoke":
      await revokeRegistration(id, actorDiscordId, need(text, "Укажите причину снятия регистрации."), context);
      return "Регистрация снята.";
    case "transfer.approve_source":
    case "transfer.approve_target":
    case "transfer.reject_source":
    case "transfer.reject_target": {
      const [verb, side] = data.action.split("_") as ["approve" | "reject", "source" | "target"];
      const decided = await decideTransfer(
        id,
        side,
        verb === "approve" ? DecisionStatus.APPROVED : DecisionStatus.REJECTED,
        actorDiscordId,
        verb === "reject" ? need(text, "Укажите причину отказа.") : null,
        context,
      );
      // One side has decided, the other has not: the core queues nothing, but the card in Discord
      // must show this decision and lose that side's buttons.
      if (decided.status === TransferStatus.PENDING) {
        await enqueueJob({ type: MODULE_JOB_TYPES.TRANSFER_DECIDED, payload: { transferId: id } });
      }
      return verb === "approve" ? "Решение сохранено: одобрено." : "Решение сохранено: отказано.";
    }
    case "transfer.cancel":
      await cancelTransfer(id, actorDiscordId, need(text, "Укажите причину отмены перевода."), context);
      return "Перевод отменён.";
    case "token.revoke": {
      const token = await prisma.token.findUnique({ where: { id }, select: { number: true } });
      if (!token) throw new RegistryActionError("Нашивка не найдена.");
      await revokeToken(token.number, context);
      return `Нашивка ${token.number} отозвана.`;
    }
    case "character.archive":
      await archiveCharacter(id, actorDiscordId, need(text, "Укажите причину архивирования персонажа."), context);
      return "Персонаж отправлен в архив, слот свободен.";
    case "character.set_static": {
      const character = await prisma.character.findUnique({ where: { id }, select: { staticId: true } });
      if (!character) throw new RegistryActionError("Персонаж не найден.");
      const newStaticId = need(text, "Укажите новый статик.");
      await updateCharacterStaticId({ currentStaticId: character.staticId, newStaticId }, context);
      return `Статик изменён: ${character.staticId} → ${newStaticId}.`;
    }
    case "ic_blacklist.close": {
      const entry = await prisma.icBlacklistEntry.findUnique({ where: { id }, select: { number: true } });
      if (!entry) throw new RegistryActionError("Запись ЧС не найдена.");
      // The core function queues the Discord card update itself.
      await closeIcBlacklistEntry(
        { number: entry.number, closedByDiscordId: actorDiscordId, closeReason: need(text, "Укажите причину снятия.") },
        context,
      );
      return `Запись ЧС ${entry.number} снята.`;
    }
    case "job.retry":
      await retryJob(id, context);
      return "Задача возвращена в очередь.";
    case "job.cancel":
      if (!(await cancelJob(id))) throw new RegistryActionError("Отменить можно только ожидающую задачу.");
      return "Задача отменена.";
    default:
      throw new RegistryActionError("Неизвестное действие.");
  }
}

// ──────────────────────────────────────────────────────────────
// Listings for the dashboard: search, filters, pages
// ──────────────────────────────────────────────────────────────

export const REGISTRY_PAGE_SIZE = 50;

export interface PageQuery {
  /** Free text: number, static, name. */
  q?: string | undefined;
  status?: string | undefined;
  page?: number | undefined;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

function paging(page: number | undefined) {
  const current = Math.max(1, Math.floor(page ?? 1));
  return { current, skip: (current - 1) * REGISTRY_PAGE_SIZE, take: REGISTRY_PAGE_SIZE };
}

function asPage<T>(items: T[], total: number, current: number): Page<T> {
  return { items, total, page: current, pages: Math.max(1, Math.ceil(total / REGISTRY_PAGE_SIZE)) };
}

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

export async function listTransfersPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const where: Prisma.TransferWhereInput = {
    ...(query.status && query.status in TransferStatus ? { status: query.status as TransferStatus } : {}),
    ...(q
      ? {
          OR: [
            { fromFactionCode: contains(q) },
            { toFactionCode: contains(q) },
            { character: { staticId: contains(q) } },
            { character: { name: contains(q) } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.transfer.count({ where }),
    prisma.transfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { character: { select: { name: true, staticId: true } } },
    }),
  ]);
  return asPage(items, total, current);
}

export async function listCharactersPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const where: Prisma.CharacterWhereInput = {
    ...(query.status && query.status in RecordStatus ? { status: query.status as RecordStatus } : {}),
    ...(q
      ? {
          OR: [
            { staticId: contains(q) },
            { name: contains(q) },
            { factionCode: contains(q) },
            { user: { discordId: contains(q) } },
            { tokens: { some: { number: contains(q) } } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.character.count({ where }),
    prisma.character.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: { select: { discordId: true } },
        tokens: { orderBy: { issuedAt: "desc" }, take: 5 },
      },
    }),
  ]);
  return asPage(items, total, current);
}

export async function listJobsPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const where: Prisma.JobWhereInput = {
    ...(query.status && query.status in JobStatus ? { status: query.status as JobStatus } : {}),
    ...(q ? { OR: [{ type: contains(q) }, { lastError: contains(q) }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return asPage(items, total, current);
}

export interface AuditQuery extends PageQuery {
  action?: string | undefined;
  entityType?: string | undefined;
  /** Discord id of the actor (stored in the event metadata or resolved from the user). */
  actorDiscordId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function listAuditLogPage(query: AuditQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const actor = query.actorDiscordId?.trim();
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action?.trim() ? { action: contains(query.action.trim()) } : {}),
    ...(query.entityType?.trim() ? { entityType: query.entityType.trim() } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(actor
      ? {
          OR: [
            { actorUser: { discordId: actor } },
            { metadata: { path: ["discordUserId"], equals: actor } },
          ],
        }
      : {}),
    ...(q ? { AND: [{ OR: [{ entityId: contains(q) }, { action: contains(q) }, { source: contains(q) }] }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { actorUser: { select: { discordId: true } } },
    }),
  ]);
  return asPage(items, total, current);
}

/** Entity types present in the log, for the filter list. */
export async function listAuditEntityTypes(): Promise<string[]> {
  const rows = await prisma.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } });
  return rows.map((row) => row.entityType);
}

/** Discord id of whoever made an audit event, when it is known. */
export function auditActorDiscordId(event: {
  actorType: AuditActorType;
  actorUser: { discordId: string } | null;
  metadata: unknown;
}): string | null {
  if (event.actorUser) return event.actorUser.discordId;
  const metadata = event.metadata as { discordUserId?: unknown } | null;
  return typeof metadata?.discordUserId === "string" ? metadata.discordUserId : null;
}

function statusOf(value: string | undefined): RecordStatus | undefined {
  return value && value in RecordStatus ? (value as RecordStatus) : undefined;
}

export async function listWantedPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const status = statusOf(query.status);
  const where: Prisma.WantedWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ number: contains(q) }, { staticId: contains(q) }, { characterName: contains(q) }, { reason: contains(q) }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.wanted.count({ where }),
    prisma.wanted.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return asPage(items, total, current);
}

export async function listFinesPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const status = statusOf(query.status);
  const where: Prisma.FineWhereInput = {
    // «OVERDUE» is not a stored status: an unpaid fine whose deadline has passed.
    ...(query.status === "OVERDUE" ? { status: RecordStatus.ACTIVE, dueAt: { lte: new Date() } } : status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { number: contains(q) },
            { staticId: contains(q) },
            { characterName: contains(q) },
            { factionCode: contains(q) },
            { reason: contains(q) },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.fine.count({ where }),
    prisma.fine.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return asPage(items, total, current);
}

export async function listDocumentsPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const status = statusOf(query.status);
  const where: Prisma.DocumentWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ number: contains(q) }, { factionCode: contains(q) }, { content: contains(q) }, { notifiedPerson: contains(q) }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { _count: { select: { responses: true } } },
    }),
  ]);
  return asPage(items, total, current);
}

export async function listPersonnelPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const status = statusOf(query.status);
  const where: Prisma.PersonnelEventWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ factionCode: contains(q) }, { subjectName: contains(q) }, { subjectDiscordId: contains(q) }, { type: contains(q) }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.personnelEvent.count({ where }),
    prisma.personnelEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return asPage(items, total, current);
}

export async function listIcBlacklistPage(query: PageQuery = {}) {
  const { current, skip, take } = paging(query.page);
  const q = query.q?.trim();
  const status = statusOf(query.status);
  const where: Prisma.IcBlacklistEntryWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ number: contains(q) }, { staticId: contains(q) }, { fullName: contains(q) }, { reason: contains(q) }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.icBlacklistEntry.count({ where }),
    prisma.icBlacklistEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return asPage(items, total, current);
}
