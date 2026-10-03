import {
  AuditActorType,
  DecisionStatus,
  RecordStatus,
  RegistrationKind,
  FeedbackTicketStatus,
  TransferStatus,
  prisma,
  type WebhookRequestStatus,
} from "@mirror/db";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue, type Db } from "./db.js";
import { enqueueJob } from "./jobs.js";
import { createButtonAction } from "./message-designs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { getSetting } from "./settings.js";

const snowflakeLike = z.string().min(1).max(32);
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const ACTIVE_TOKEN = { where: { status: RecordStatus.ACTIVE }, take: 1 } as const;

export const createCharacterSchema = z.object({
  userId: z.string().min(1),
  slot: z.number().int().min(1).max(3),
  staticId: nonEmptyText(32),
  name: nonEmptyText(128),
  factionCode: z.string().trim().max(32).optional(),
  department: z.string().trim().max(128).optional(),
  rank: z.number().int().min(0).max(100).optional(),
});
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

export async function createCharacter(input: CreateCharacterInput, context: AuditContext) {
  const data = createCharacterSchema.parse(input);
  return auditedMutation(context, "character.created", "character", async (tx) => {
    const active = await tx.character.findMany({
      where: { userId: data.userId, status: RecordStatus.ACTIVE },
      select: { slot: true },
    });
    if (active.length >= 3) throw new Error("У Discord-аккаунта уже три активных персонажа.");
    if (active.some((item) => item.slot === data.slot)) throw new Error(`Слот ${data.slot} уже занят.`);
    const staticTaken = await tx.character.findFirst({
      where: { staticId: data.staticId, status: RecordStatus.ACTIVE },
      select: { id: true },
    });
    if (staticTaken) throw new Error("Этот статик уже привязан к другому персонажу.");
    const character = await tx.character.create({
      data: {
        userId: data.userId,
        slot: data.slot,
        staticId: data.staticId,
        name: data.name,
        factionCode: data.factionCode ?? null,
        department: data.department ?? null,
        rank: data.rank ?? null,
      },
    });
    return { entityId: character.id, after: character, result: character };
  });
}

export async function listCharacters(userId: string) {
  return prisma.character.findMany({
    where: { userId, status: RecordStatus.ACTIVE },
    include: { tokens: ACTIVE_TOKEN },
    orderBy: { slot: "asc" },
  });
}

export async function getCharacterForUser(userId: string, staticId: string) {
  return prisma.character.findFirst({
    where: { userId, staticId, status: RecordStatus.ACTIVE },
    include: { tokens: ACTIVE_TOKEN },
  });
}

/** Faction badge for token get/find: `[LSPD | Отдел | 1234]`. */
export function formatTokenDisplay(input: {
  factionCode?: string | null;
  department?: string | null;
  number: string;
}): string {
  const faction = input.factionCode?.trim() || "—";
  const department = input.department?.trim() || "—";
  return `[${faction} | ${department} | ${input.number}]`;
}

export const updateCharacterStaticSchema = z.object({
  currentStaticId: nonEmptyText(32),
  newStaticId: nonEmptyText(32),
});

/** Admin-only: change an ACTIVE character's static id (partial unique index still applies). */
export async function updateCharacterStaticId(
  input: z.input<typeof updateCharacterStaticSchema>,
  context: AuditContext,
) {
  const data = updateCharacterStaticSchema.parse(input);
  if (data.currentStaticId === data.newStaticId) throw new Error("Новый статик совпадает с текущим.");
  return auditedMutation(context, "character.static_updated", "character", async (tx) => {
    const current = await tx.character.findFirst({
      where: { staticId: data.currentStaticId, status: RecordStatus.ACTIVE },
    });
    if (!current) throw new Error("Активный персонаж с таким статиком не найден.");
    const taken = await tx.character.findFirst({
      where: { staticId: data.newStaticId, status: RecordStatus.ACTIVE },
      select: { id: true },
    });
    if (taken) throw new Error("Новый статик уже занят другим активным персонажем.");
    const updated = await tx.character.update({
      where: { id: current.id },
      data: { staticId: data.newStaticId },
    });
    return { entityId: current.id, before: current, after: updated, result: updated };
  });
}

export type TokenLookupResult = {
  token: { id: string; number: string; status: RecordStatus; issuedAt: Date };
  character: {
    id: string;
    name: string;
    staticId: string;
    factionCode: string | null;
    department: string | null;
    rank: number | null;
  };
  ownerDiscordId: string;
  display: string;
};

/** Look up by token number, character static id, or owner Discord snowflake. */
export async function findTokens(query: string): Promise<TokenLookupResult[]> {
  const q = nonEmptyText(64).parse(query);
  const include = {
    character: { include: { user: { select: { discordId: true } } } },
  } as const;

  const byNumber = await prisma.token.findMany({
    where: { number: q, status: RecordStatus.ACTIVE },
    include,
    take: 10,
  });
  const byStatic = await prisma.token.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      character: { staticId: q, status: RecordStatus.ACTIVE },
    },
    include,
    take: 10,
  });
  const byDiscord =
    /^\d{17,20}$/.test(q)
      ? await prisma.token.findMany({
          where: {
            status: RecordStatus.ACTIVE,
            character: { status: RecordStatus.ACTIVE, user: { discordId: q } },
          },
          include,
          take: 10,
        })
      : [];

  const seen = new Set<string>();
  const results: TokenLookupResult[] = [];
  for (const token of [...byNumber, ...byStatic, ...byDiscord]) {
    if (seen.has(token.id)) continue;
    seen.add(token.id);
    results.push({
      token: { id: token.id, number: token.number, status: token.status, issuedAt: token.issuedAt },
      character: {
        id: token.character.id,
        name: token.character.name,
        staticId: token.character.staticId,
        factionCode: token.character.factionCode,
        department: token.character.department,
        rank: token.character.rank,
      },
      ownerDiscordId: token.character.user.discordId,
      display: formatTokenDisplay({
        factionCode: token.character.factionCode,
        department: token.character.department,
        number: token.number,
      }),
    });
  }
  return results;
}

const MIN_TOKEN_LENGTH = 4;
const MAX_TOKEN_LENGTH = 9;

/** Numbers of every length ever issued (revoked ones stay reserved: numbers are never reused). */
async function issuedTokenCount(db: Db, length: number): Promise<number> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM tokens WHERE length(number) = ${length}`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Picks the shortest length whose free share is still at or above the threshold
 * (default 10 %), then a random free number of that length.
 */
export async function allocateTokenNumber(db: Db): Promise<string> {
  const thresholdPercent = await getSetting("tokens.expandThresholdPercent", db);
  for (let length = MIN_TOKEN_LENGTH; length <= MAX_TOKEN_LENGTH; length += 1) {
    const min = 10 ** (length - 1);
    const capacity = 9 * min;
    const issued = await issuedTokenCount(db, length);
    const freePercent = ((capacity - issued) / capacity) * 100;
    if (freePercent < thresholdPercent || issued >= capacity) continue;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const number = String(randomInt(min, min * 10));
      const existing = await db.token.findUnique({ where: { number }, select: { id: true } });
      if (!existing) return number;
    }
  }
  throw new Error("Не удалось подобрать свободный номер нашивки.");
}

export async function issueToken(characterId: string, context: AuditContext) {
  return auditedMutation(context, "token.issued", "token", async (tx) => {
    const character = await tx.character.findFirst({ where: { id: characterId, status: RecordStatus.ACTIVE } });
    if (!character) throw new Error("Персонаж не найден или неактивен.");
    const existing = await tx.token.findFirst({ where: { characterId, status: RecordStatus.ACTIVE } });
    if (existing) throw new Error("У персонажа уже есть активная нашивка.");
    const number = await allocateTokenNumber(tx);
    const token = await tx.token.create({ data: { number, characterId } });
    return { entityId: token.id, after: token, result: token };
  });
}

export async function revokeToken(tokenNumber: string, context: AuditContext) {
  return auditedMutation(context, "token.revoked", "token", async (tx) => {
    const token = await tx.token.findUnique({ where: { number: tokenNumber } });
    if (!token || token.status !== RecordStatus.ACTIVE) throw new Error("Активная нашивка не найдена.");
    const { count } = await tx.token.updateMany({
      where: { id: token.id, status: RecordStatus.ACTIVE },
      data: { status: RecordStatus.REVOKED, revokedAt: new Date(), revokedById: context.actorUserId ?? null },
    });
    if (count !== 1) throw new Error("Активная нашивка не найдена.");
    const updated = await tx.token.findUniqueOrThrow({ where: { id: token.id } });
    return { entityId: token.id, before: token, after: updated, result: updated };
  });
}

export type RegistrationReviewButtons = { approve: string; reject: string };
export type TransferReviewButtons = {
  sourceApprove: string;
  sourceReject: string;
  targetApprove: string;
  targetReject: string;
};

/** Buttons and the delivery job are created in the caller's transaction, so job retries never duplicate them. */
async function scheduleRegistrationReview(tx: Db, registrationId: string) {
  const approve = await createButtonAction("registration.approve", { registrationId }, tx);
  const reject = await createButtonAction("registration.reject", { registrationId }, tx);
  const reviewButtons: RegistrationReviewButtons = { approve: approve.customId, reject: reject.customId };
  const registration = await tx.registration.update({ where: { id: registrationId }, data: { reviewButtons } });
  await enqueueJob({ type: MODULE_JOB_TYPES.REGISTRATION_REVIEW, payload: { registrationId } }, tx);
  return registration;
}

async function scheduleTransferReview(tx: Db, transfer: { id: string; fromFactionCode: string; toFactionCode: string }) {
  const source = { transferId: transfer.id, side: "source", factionCode: transfer.fromFactionCode };
  const target = { transferId: transfer.id, side: "target", factionCode: transfer.toFactionCode };
  const reviewButtons: TransferReviewButtons = {
    sourceApprove: (await createButtonAction("transfer.approve.source", source, tx)).customId,
    sourceReject: (await createButtonAction("transfer.reject.source", source, tx)).customId,
    targetApprove: (await createButtonAction("transfer.approve.target", target, tx)).customId,
    targetReject: (await createButtonAction("transfer.reject.target", target, tx)).customId,
  };
  const updated = await tx.transfer.update({ where: { id: transfer.id }, data: { reviewButtons } });
  await enqueueJob({ type: MODULE_JOB_TYPES.TRANSFER_REVIEW, payload: { transferId: transfer.id } }, tx);
  return updated;
}

const PLATE_RE = /^[0-9A-ZА-ЯЁ-]{2,12}$/;

export function normalizePlate(raw: string): string {
  const plate = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!PLATE_RE.test(plate)) throw new Error("Госномер: 2–12 символов (буквы, цифры, дефис).");
  return plate;
}

export async function listVehicleModels(query = "", limit = 25) {
  return prisma.vehicleModel.findMany({
    where: { status: RecordStatus.ACTIVE, ...(query ? { name: { contains: query, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: limit,
  });
}

/** With an empty catalog any model is accepted; otherwise the name must match an active catalog entry. */
export async function resolveVehicleModelName(raw: string): Promise<string> {
  const name = nonEmptyText(128).parse(raw);
  const catalogSize = await prisma.vehicleModel.count({ where: { status: RecordStatus.ACTIVE } });
  if (catalogSize === 0) return name;
  const match = await prisma.vehicleModel.findFirst({
    where: { status: RecordStatus.ACTIVE, name: { equals: name, mode: "insensitive" } },
  });
  if (!match) throw new Error(`Модели «${name}» нет в каталоге разрешённых ТС. Выберите модель из подсказок.`);
  return match.name;
}

export const createRegistrationSchema = z.object({
  kind: z.nativeEnum(RegistrationKind),
  characterId: z.string().min(1),
  payload: z.record(z.unknown()),
  plate: z.string().optional(),
  evidenceFileIds: z.array(z.string().min(1)).max(10).default([]),
});

export async function createRegistration(
  input: z.input<typeof createRegistrationSchema>,
  context: AuditContext,
) {
  const data = createRegistrationSchema.parse(input);
  const plateFromPayload = typeof data.payload.plate === "string" ? data.payload.plate : "";
  const plate =
    data.kind === RegistrationKind.VEHICLE ? normalizePlate(data.plate ?? plateFromPayload) : null;
  return auditedMutation(context, "registration.created", "registration", async (tx) => {
    const active = await tx.registration.findFirst({
      where: { characterId: data.characterId, kind: data.kind, status: RecordStatus.ACTIVE },
    });
    if (active) throw new Error("У персонажа уже есть активная регистрация этого типа.");
    if (plate) {
      const plateTaken = await tx.registration.findFirst({
        where: { kind: RegistrationKind.VEHICLE, status: RecordStatus.ACTIVE, plate },
        select: { id: true },
      });
      if (plateTaken) throw new Error(`Госномер ${plate} уже занят другой активной регистрацией.`);
    }
    const created = await tx.registration.create({
      data: {
        kind: data.kind,
        characterId: data.characterId,
        payload: toJsonValue(plate ? { ...data.payload, plate } : data.payload),
        plate,
        evidenceFileIds: data.evidenceFileIds,
      },
    });
    const registration = await scheduleRegistrationReview(tx, created.id);
    return { entityId: registration.id, after: registration, result: registration };
  });
}

export async function decideRegistration(
  id: string,
  decision: Exclude<DecisionStatus, "PENDING">,
  actorDiscordId: string,
  reason: string | null,
  context: AuditContext,
) {
  const rejectionReason = reason?.trim() ?? "";
  if (decision === DecisionStatus.REJECTED && !rejectionReason) throw new Error("Укажите причину отказа.");
  return auditedMutation(context, `registration.${decision.toLowerCase()}`, "registration", async (tx) => {
    const current = await tx.registration.findUnique({ where: { id } });
    if (!current) throw new Error("Заявка не найдена.");
    const now = new Date();
    const ttlDays = await getSetting("registrations.ttlDays", tx);
    const { count } = await tx.registration.updateMany({
      where: { id, status: RecordStatus.ACTIVE, decision: DecisionStatus.PENDING },
      data:
        decision === DecisionStatus.APPROVED
          ? {
              decision,
              decidedByDiscordId: actorDiscordId,
              decidedAt: now,
              expiresAt: new Date(now.getTime() + ttlDays * 86_400_000),
            }
          : {
              decision,
              decidedByDiscordId: actorDiscordId,
              decidedAt: now,
              rejectionReason,
              status: RecordStatus.CLOSED,
            },
    });
    if (count !== 1) throw new Error("Заявка уже обработана.");
    const updated = await tx.registration.findUniqueOrThrow({ where: { id } });
    await enqueueJob({ type: MODULE_JOB_TYPES.REGISTRATION_DECIDED, payload: { registrationId: id } }, tx);
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

/** Marks approved registrations past `expires_at` as EXPIRED and queues card edit + DM. Returns the count. */
export async function expireRegistrations(now: Date = new Date(), batch = 100): Promise<number> {
  const due = await prisma.registration.findMany({
    where: { status: RecordStatus.ACTIVE, decision: DecisionStatus.APPROVED, expiresAt: { lte: now } },
    select: { id: true },
    take: batch,
  });
  let expired = 0;
  for (const { id } of due) {
    const done = await auditedMutation(
      { actorType: AuditActorType.SYSTEM, source: "registrations.expiry" },
      "registration.expired",
      "registration",
      async (tx) => {
        const { count } = await tx.registration.updateMany({
          where: { id, status: RecordStatus.ACTIVE, expiresAt: { lte: now } },
          data: { status: RecordStatus.EXPIRED },
        });
        if (count === 1) {
          await enqueueJob({ type: MODULE_JOB_TYPES.REGISTRATION_EXPIRED, payload: { registrationId: id } }, tx);
        }
        return { entityId: id, after: { status: RecordStatus.EXPIRED }, result: count === 1 };
      },
    );
    if (done) expired += 1;
  }
  return expired;
}

export async function setRegistrationReviewThread(id: string, threadId: string) {
  return prisma.registration.update({ where: { id }, data: { reviewThreadId: threadId } });
}

export const createTransferSchema = z.object({
  characterId: z.string().min(1),
  fromFactionCode: nonEmptyText(32),
  toFactionCode: nonEmptyText(32),
  fromRank: z.number().int().min(0).max(100),
  toRank: z.number().int().min(0).max(100),
  documentFileIds: z.array(z.string().min(1)).max(10).default([]),
  createdByDiscordId: snowflakeLike,
});

/** Empty catalog for a faction pair accepts any ranks; otherwise fromRank→toRank must match a rule. */
export async function assertTransferRanksAllowed(
  fromFactionCode: string,
  toFactionCode: string,
  fromRank: number,
  toRank: number,
  db: Db = prisma,
) {
  const from = fromFactionCode.toUpperCase();
  const to = toFactionCode.toUpperCase();
  const rules = await db.transferRankRule.count({
    where: { fromFactionCode: from, toFactionCode: to, status: RecordStatus.ACTIVE },
  });
  if (rules === 0) return;
  const match = await db.transferRankRule.findFirst({
    where: { fromFactionCode: from, toFactionCode: to, fromRank, status: RecordStatus.ACTIVE },
  });
  if (!match) {
    throw new Error(`Для перевода ${from} → ${to} ранг ${fromRank} не описан в таблице переводов.`);
  }
  if (match.toRank !== toRank) {
    throw new Error(`По таблице переводов ранг ${fromRank} (${from}) соответствует рангу ${match.toRank} (${to}), а не ${toRank}.`);
  }
}

export async function createTransfer(input: z.input<typeof createTransferSchema>, context: AuditContext) {
  const data = createTransferSchema.parse(input);
  const fromFactionCode = data.fromFactionCode.toUpperCase();
  const toFactionCode = data.toFactionCode.toUpperCase();
  if (fromFactionCode === toFactionCode) {
    throw new Error("Фракции отправителя и получателя должны различаться.");
  }
  await assertTransferRanksAllowed(fromFactionCode, toFactionCode, data.fromRank, data.toRank);
  return auditedMutation(context, "transfer.created", "transfer", async (tx) => {
    const pending = await tx.transfer.findFirst({
      where: { characterId: data.characterId, status: TransferStatus.PENDING },
      select: { id: true },
    });
    if (pending) throw new Error("У персонажа уже есть заявка на перевод на рассмотрении.");
    const created = await tx.transfer.create({
      data: {
        ...data,
        fromFactionCode,
        toFactionCode,
        documentFileIds: data.documentFileIds,
      },
    });
    const transfer = await scheduleTransferReview(tx, created);
    return { entityId: transfer.id, after: transfer, result: transfer };
  });
}

export async function decideTransfer(
  id: string,
  side: "source" | "target",
  decision: Exclude<DecisionStatus, "PENDING">,
  actorDiscordId: string,
  reason: string | null,
  context: AuditContext,
) {
  const rejectionReason = reason?.trim() ?? "";
  if (decision === DecisionStatus.REJECTED && !rejectionReason) throw new Error("Укажите причину отказа.");
  return auditedMutation(context, `transfer.${side}.${decision.toLowerCase()}`, "transfer", async (tx) => {
    // Row lock serializes concurrent decisions of both sides: neither is lost and the final status is computed once.
    await tx.$queryRaw`SELECT id FROM transfers WHERE id = ${id} FOR UPDATE`;
    const current = await tx.transfer.findUnique({ where: { id } });
    if (!current || current.status !== TransferStatus.PENDING) throw new Error("Перевод уже закрыт или не найден.");
    const currentSide = side === "source" ? current.sourceDecision : current.targetDecision;
    if (currentSide !== DecisionStatus.PENDING) throw new Error("Решение этой стороны уже принято.");
    const nextSource = side === "source" ? decision : current.sourceDecision;
    const nextTarget = side === "target" ? decision : current.targetDecision;
    const status =
      decision === DecisionStatus.REJECTED
        ? TransferStatus.REJECTED
        : nextSource === DecisionStatus.APPROVED && nextTarget === DecisionStatus.APPROVED
          ? TransferStatus.APPROVED
          : TransferStatus.PENDING;
    const updated = await tx.transfer.update({
      where: { id },
      data: {
        sourceDecision: nextSource,
        targetDecision: nextTarget,
        ...(side === "source" ? { sourceDecidedByDiscordId: actorDiscordId } : { targetDecidedByDiscordId: actorDiscordId }),
        status,
        rejectionReason: decision === DecisionStatus.REJECTED ? rejectionReason : current.rejectionReason,
      },
    });
    if (status === TransferStatus.APPROVED || status === TransferStatus.REJECTED) {
      await enqueueJob({ type: MODULE_JOB_TYPES.TRANSFER_DECIDED, payload: { transferId: id } }, tx);
    }
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

/** Stores where the review message was posted so later decisions can edit it. */
export async function setRegistrationReviewMessage(
  id: string,
  message: { guildId: string; channelId: string; messageId: string },
) {
  return prisma.registration.update({
    where: { id },
    data: { reviewGuildId: message.guildId, reviewChannelId: message.channelId, reviewMessageId: message.messageId },
  });
}

export async function setTransferReviewMessage(
  id: string,
  message: { guildId: string; channelId: string; messageId: string },
) {
  return prisma.transfer.update({
    where: { id },
    data: { reviewGuildId: message.guildId, reviewChannelId: message.channelId, reviewMessageId: message.messageId },
  });
}

export const createWebhookRequestSchema = z.object({
  requesterDiscordId: snowflakeLike,
  guildDiscordId: snowflakeLike,
  channelDiscordId: snowflakeLike,
  description: nonEmptyText(2000),
  /** Discord webhook URL created by the bot; omit only for tests / deferred creation. */
  webhookUrl: z.string().url().optional(),
});

export async function createWebhookRequest(
  input: z.input<typeof createWebhookRequestSchema>,
  context: AuditContext,
) {
  const data = createWebhookRequestSchema.parse(input);
  return auditedMutation(context, "webhook_request.created", "webhook_request", async (tx) => {
    const request = await tx.webhookRequest.create({
      data: {
        requesterDiscordId: data.requesterDiscordId,
        guildDiscordId: data.guildDiscordId,
        channelDiscordId: data.channelDiscordId,
        description: data.description,
        webhookUrl: data.webhookUrl ?? null,
      },
    });
    return { entityId: request.id, after: request, result: request };
  });
}

export async function setWebhookRequestStatus(
  id: string,
  status: WebhookRequestStatus,
  webhookUrl: string | null,
  context: AuditContext,
) {
  return auditedMutation(context, "webhook_request.updated", "webhook_request", async (tx) => {
    const current = await tx.webhookRequest.findUnique({ where: { id } });
    if (!current) throw new Error("Запрос webhook не найден.");
    const updated = await tx.webhookRequest.update({ where: { id }, data: { status, webhookUrl } });
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

export const createBlacklistSchema = z.object({
  staticId: nonEmptyText(32),
  fullName: nonEmptyText(128),
  reason: nonEmptyText(2000),
  evidenceFileIds: z.array(z.string().min(1)).max(10).default([]),
  expiresAt: z.coerce.date().nullable().default(null),
  createdByDiscordId: snowflakeLike,
});

function isActiveBlacklistEntry(entry: { status: RecordStatus; expiresAt: Date | null }, now = new Date()) {
  return entry.status === RecordStatus.ACTIVE && (!entry.expiresAt || entry.expiresAt > now);
}

export async function createIcBlacklistEntry(input: z.input<typeof createBlacklistSchema>, context: AuditContext) {
  const data = createBlacklistSchema.parse(input);
  if (data.expiresAt && data.expiresAt.getTime() <= Date.now()) {
    throw new Error("Срок окончания должен быть в будущем (или оставьте пустым для бессрочной записи).");
  }
  return auditedMutation(context, "ic_blacklist.created", "ic_blacklist", async (tx) => {
    const existing = await tx.icBlacklistEntry.findFirst({
      where: { staticId: data.staticId, status: RecordStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });
    if (existing && isActiveBlacklistEntry(existing)) {
      throw new Error("У этого статика уже есть активная запись IC чёрного списка.");
    }
    const entry = await tx.icBlacklistEntry.create({ data });
    return { entityId: entry.id, after: entry, result: entry };
  });
}

export async function revokeIcBlacklistEntry(id: string, actorDiscordId: string, context: AuditContext) {
  return auditedMutation(context, "ic_blacklist.revoked", "ic_blacklist", async (tx) => {
    const current = await tx.icBlacklistEntry.findUnique({ where: { id } });
    if (!current || current.status !== RecordStatus.ACTIVE) throw new Error("Запись чёрного списка не найдена.");
    const updated = await tx.icBlacklistEntry.update({
      where: { id },
      data: { status: RecordStatus.REVOKED, revokedByDiscordId: actorDiscordId },
    });
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

export async function revokeIcBlacklistByStatic(
  staticId: string,
  actorDiscordId: string,
  context: AuditContext,
) {
  const entry = await prisma.icBlacklistEntry.findFirst({
    where: { staticId, status: RecordStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });
  if (!entry) throw new Error("Активная запись чёрного списка не найдена.");
  return revokeIcBlacklistEntry(entry.id, actorDiscordId, context);
}

/** Active (non-expired) IC blacklist row for a static, if any. */
export async function findActiveIcBlacklist(staticId: string, now = new Date()) {
  const entry = await prisma.icBlacklistEntry.findFirst({
    where: { staticId, status: RecordStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });
  if (!entry || !isActiveBlacklistEntry(entry, now)) return null;
  return entry;
}

export async function listActiveIcBlacklistForStatics(staticIds: string[], now = new Date()) {
  if (staticIds.length === 0) return new Map<string, Awaited<ReturnType<typeof findActiveIcBlacklist>>>();
  const rows = await prisma.icBlacklistEntry.findMany({
    where: { staticId: { in: staticIds }, status: RecordStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (map.has(row.staticId) || !isActiveBlacklistEntry(row, now)) continue;
    map.set(row.staticId, row);
  }
  return map;
}

/** Marks ACTIVE entries past expiresAt as EXPIRED. Returns how many were expired. */
export async function expireIcBlacklistEntries(now: Date = new Date(), batch = 100): Promise<number> {
  const due = await prisma.icBlacklistEntry.findMany({
    where: { status: RecordStatus.ACTIVE, expiresAt: { lte: now } },
    select: { id: true },
    take: batch,
  });
  let expired = 0;
  for (const { id } of due) {
    const done = await auditedMutation(
      { actorType: AuditActorType.SYSTEM, source: "ic_blacklist.expiry" },
      "ic_blacklist.expired",
      "ic_blacklist",
      async (tx) => {
        const { count } = await tx.icBlacklistEntry.updateMany({
          where: { id, status: RecordStatus.ACTIVE, expiresAt: { lte: now } },
          data: { status: RecordStatus.EXPIRED },
        });
        return { entityId: id, after: { status: RecordStatus.EXPIRED }, result: count === 1 };
      },
    );
    if (done) expired += 1;
  }
  return expired;
}

export async function createRolePanel(input: {
  guildDiscordId: string;
  channelDiscordId: string;
  spec: Record<string, unknown>;
  createdByDiscordId: string;
}, context: AuditContext) {
  return auditedMutation(context, "role_panel.created", "role_panel", async (tx) => {
    const panel = await tx.rolePanel.create({ data: { ...input, spec: toJsonValue(input.spec) } });
    return { entityId: panel.id, after: panel, result: panel };
  });
}

export async function createFeedbackTicket(input: {
  authorDiscordId: string;
  category: string;
  content: string;
  attachmentFileIds?: string[];
}, context: AuditContext) {
  const category = nonEmptyText(64).parse(input.category);
  const content = nonEmptyText(4000).parse(input.content);
  return auditedMutation(context, "feedback_ticket.created", "feedback_ticket", async (tx) => {
    const ticket = await tx.feedbackTicket.create({
      data: {
        authorDiscordId: input.authorDiscordId,
        category,
        messages: { create: { authorDiscordId: input.authorDiscordId, content, attachmentFileIds: input.attachmentFileIds ?? [] } },
      },
      include: { messages: true },
    });
    return { entityId: ticket.id, after: ticket, result: ticket };
  });
}

export async function addFeedbackMessage(
  ticketId: string,
  authorDiscordId: string,
  content: string,
  context: AuditContext,
) {
  return auditedMutation(context, "feedback_message.created", "feedback_message", async (tx) => {
    const ticket = await tx.feedbackTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === FeedbackTicketStatus.CLOSED) throw new Error("Тикет закрыт или не найден.");
    const message = await tx.feedbackMessage.create({ data: { ticketId, authorDiscordId, content } });
    return { entityId: message.id, after: message, result: message };
  });
}

export async function getDiscordForm(formId: string) {
  return prisma.discordForm.findFirst({
    where: { id: formId, status: RecordStatus.ACTIVE },
    include: { fields: { orderBy: { position: "asc" } } },
  });
}

export async function submitDiscordForm(
  formId: string,
  values: Record<string, string>,
  authorDiscordId: string | null,
) {
  const form = await getDiscordForm(formId);
  if (!form) throw new Error("Форма не найдена или отключена.");
  if (form.expiresAt && form.expiresAt <= new Date()) throw new Error("Срок действия формы истёк.");
  for (const field of form.fields) {
    if (field.required && !values[field.key]?.trim()) throw new Error(`Заполните поле «${field.label}».`);
  }
  return prisma.$transaction(async (tx) => {
    // Lock the form row so concurrent submissions cannot both pass the response-limit check.
    await tx.$queryRaw`SELECT id FROM forms WHERE id = ${formId} FOR UPDATE`;
    if (form.responseLimit !== null) {
      const count = await tx.formSubmission.count({ where: { formId } });
      if (count >= form.responseLimit) throw new Error("Лимит ответов формы исчерпан.");
    }
    return tx.formSubmission.create({
      data: { formId, values: toJsonValue(values), authorDiscordId, source: "discord" },
    });
  }, { maxWait: 10_000, timeout: 15_000 });
}
