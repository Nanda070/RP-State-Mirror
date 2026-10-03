/**
 * Account recovery (§5.3): a player who lost their Discord account asks to move project data
 * (characters with badges, registrations, transfers) from the old account to the new one.
 * Discord roles are never touched — leaders and admins grant them by hand.
 */
import { DecisionStatus, RecordStatus, prisma, type Prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";
import { enqueueAccountRecoveryDecided } from "./module-jobs.js";

export const MAX_CHARACTERS_PER_ACCOUNT = 3;
const REQUESTS_PER_DAY = 3;

export class AccountRecoveryError extends UserError {
  override name = "AccountRecoveryError";
}

const snowflake = z.string().trim().regex(SNOWFLAKE_RE, "Discord ID — это число из 17–20 цифр");

export const createAccountRecoverySchema = z.object({
  newDiscordId: snowflake,
  oldDiscordId: snowflake,
  characterName: z.string().trim().min(1, "Укажите ник персонажа").max(128),
  staticId: z.string().trim().min(1, "Укажите статик").max(32),
  reason: z.string().trim().min(10, "Опишите причину подробнее (не короче 10 символов)").max(2000),
});
export type CreateAccountRecoveryInput = z.input<typeof createAccountRecoverySchema>;

/**
 * The request is accepted without checking that the static belongs to the old account:
 * answering that here would let anyone probe which static belongs to which Discord account.
 * Ownership is verified for the reviewing admin (`previewAccountRecovery`) and enforced on approval.
 */
export async function createAccountRecovery(input: CreateAccountRecoveryInput, context: AuditContext) {
  const data = createAccountRecoverySchema.parse(input);
  if (data.newDiscordId === data.oldDiscordId) {
    throw new AccountRecoveryError("Старый Discord ID совпадает с текущим аккаунтом.");
  }
  return auditedMutation(context, "account_recovery.created", "account_recovery", async (tx) => {
    const pending = await tx.accountRecovery.findFirst({
      where: { newDiscordId: data.newDiscordId, decision: DecisionStatus.PENDING },
      select: { id: true },
    });
    if (pending) throw new AccountRecoveryError("У вас уже есть заявка на рассмотрении.");
    const recent = await tx.accountRecovery.count({
      where: { newDiscordId: data.newDiscordId, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= REQUESTS_PER_DAY) {
      throw new AccountRecoveryError("Слишком много заявок за сутки. Попробуйте завтра.");
    }
    const request = await tx.accountRecovery.create({ data });
    return { entityId: request.id, after: request, result: request };
  });
}

export async function listAccountRecoveries(filter: { decision?: DecisionStatus | undefined; limit?: number } = {}) {
  return prisma.accountRecovery.findMany({
    ...(filter.decision ? { where: { decision: filter.decision } } : {}),
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 100,
  });
}

/** Requests filed from this (new) account, newest first. */
export async function listAccountRecoveriesFor(newDiscordId: string) {
  return prisma.accountRecovery.findMany({
    where: { newDiscordId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

type RecoveryPlan =
  | { ok: false; reason: string; oldCharacters: OldCharacter[]; newCharacterCount: number }
  | {
      ok: true;
      oldUserId: string;
      oldCharacters: OldCharacter[];
      newCharacterCount: number;
      freeSlots: number[];
    };

type OldCharacter = { id: string; slot: number; staticId: string; name: string };

/** What approval would do, or why it is impossible. Shared by the admin preview and the approval itself. */
async function planRecovery(
  db: Prisma.TransactionClient | typeof prisma,
  request: { oldDiscordId: string; newDiscordId: string; staticId: string },
): Promise<RecoveryPlan> {
  const [oldUser, newUser] = await Promise.all([
    db.user.findUnique({
      where: { discordId: request.oldDiscordId },
      select: {
        id: true,
        characters: {
          where: { status: RecordStatus.ACTIVE },
          orderBy: { slot: "asc" },
          select: { id: true, slot: true, staticId: true, name: true },
        },
      },
    }),
    db.user.findUnique({
      where: { discordId: request.newDiscordId },
      select: { characters: { where: { status: RecordStatus.ACTIVE }, select: { slot: true } } },
    }),
  ]);
  const oldCharacters = oldUser?.characters ?? [];
  const usedSlots = new Set((newUser?.characters ?? []).map((character) => character.slot));
  const newCharacterCount = usedSlots.size;
  const fail = (reason: string): RecoveryPlan => ({ ok: false, reason, oldCharacters, newCharacterCount });

  if (!oldUser || oldCharacters.length === 0) return fail("У старого аккаунта нет активных персонажей.");
  if (!oldCharacters.some((character) => character.staticId === request.staticId)) {
    return fail("Указанный статик не принадлежит старому аккаунту.");
  }
  const freeSlots = Array.from({ length: MAX_CHARACTERS_PER_ACCOUNT }, (_, index) => index + 1).filter(
    (slot) => !usedSlots.has(slot),
  );
  if (freeSlots.length < oldCharacters.length) {
    return fail(
      `На новом аккаунте не хватает слотов: нужно ${oldCharacters.length}, свободно ${freeSlots.length}.`,
    );
  }
  return { ok: true, oldUserId: oldUser.id, oldCharacters, newCharacterCount, freeSlots };
}

async function accountLabel(discordId: string): Promise<string | null> {
  const member = await prisma.guildMember.findFirst({
    where: { userDiscordId: discordId },
    orderBy: { updatedAt: "desc" },
    select: { nickname: true, globalName: true, username: true, isPresent: true },
  });
  if (!member) return null;
  return member.nickname?.trim() || member.globalName?.trim() || member.username;
}

/** Everything the reviewing admin needs to see before deciding. */
export async function previewAccountRecovery(id: string) {
  const request = await prisma.accountRecovery.findUnique({ where: { id } });
  if (!request) throw new AccountRecoveryError("Заявка не найдена.");
  const [plan, oldLabel, newLabel, oldStillPresent] = await Promise.all([
    planRecovery(prisma, request),
    accountLabel(request.oldDiscordId),
    accountLabel(request.newDiscordId),
    prisma.guildMember.count({ where: { userDiscordId: request.oldDiscordId, isPresent: true } }),
  ]);
  const claimed = plan.oldCharacters.find((character) => character.staticId === request.staticId);
  return {
    request,
    oldLabel,
    newLabel,
    /** The old account is still on connected servers — a reason to look closer before approving. */
    oldStillPresent: oldStillPresent > 0,
    oldCharacters: plan.oldCharacters,
    newCharacterCount: plan.newCharacterCount,
    /** Does the claimed nickname match the character that owns the static (case-insensitive)? */
    nameMatches: claimed ? claimed.name.trim().toLowerCase() === request.characterName.trim().toLowerCase() : false,
    canApprove: plan.ok,
    blocker: plan.ok ? null : plan.reason,
  };
}

export async function decideAccountRecovery(
  id: string,
  decision: Exclude<DecisionStatus, "PENDING">,
  actorDiscordId: string,
  reason: string | null,
  context: AuditContext,
) {
  const rejectionReason = reason?.trim() ?? "";
  if (decision === DecisionStatus.REJECTED && !rejectionReason) {
    throw new AccountRecoveryError("Укажите причину отказа.");
  }
  return auditedMutation(context, `account_recovery.${decision.toLowerCase()}`, "account_recovery", async (tx) => {
    // Row lock: two admins deciding at once must not both move the characters.
    await tx.$queryRaw`SELECT id FROM account_recoveries WHERE id = ${id} FOR UPDATE`;
    const current = await tx.accountRecovery.findUnique({ where: { id } });
    if (!current) throw new AccountRecoveryError("Заявка не найдена.");
    if (current.decision !== DecisionStatus.PENDING) throw new AccountRecoveryError("Заявка уже обработана.");
    if (actorDiscordId === current.newDiscordId || actorDiscordId === current.oldDiscordId) {
      throw new AccountRecoveryError("Нельзя принимать решение по собственной заявке.");
    }

    let movedCharacterIds: string[] = [];
    let moved = { registrations: 0, transfers: 0 };
    if (decision === DecisionStatus.APPROVED) {
      const plan = await planRecovery(tx, current);
      if (!plan.ok) throw new AccountRecoveryError(plan.reason);
      const newUser = await tx.user.upsert({
        where: { discordId: current.newDiscordId },
        create: { discordId: current.newDiscordId },
        update: {},
      });
      // Free slots of the new account never collide with its own characters; badges follow the character.
      for (const [index, character] of plan.oldCharacters.entries()) {
        await tx.character.update({
          where: { id: character.id },
          data: { userId: newUser.id, slot: plan.freeSlots[index] as number },
        });
      }
      movedCharacterIds = plan.oldCharacters.map((character) => character.id);
      const [registrations, transfers] = await Promise.all([
        tx.registration.updateMany({
          where: { applicantDiscordId: current.oldDiscordId },
          data: { applicantDiscordId: current.newDiscordId },
        }),
        tx.transfer.updateMany({
          where: { createdByDiscordId: current.oldDiscordId },
          data: { createdByDiscordId: current.newDiscordId },
        }),
      ]);
      moved = { registrations: registrations.count, transfers: transfers.count };
    }

    const updated = await tx.accountRecovery.update({
      where: { id },
      data: {
        decision,
        decidedByDiscordId: actorDiscordId,
        decidedAt: new Date(),
        rejectionReason: decision === DecisionStatus.REJECTED ? rejectionReason : null,
        movedCharacterIds,
      },
    });
    await enqueueAccountRecoveryDecided(id, tx);
    return { entityId: id, before: current, after: updated, metadata: moved, result: updated };
  });
}
