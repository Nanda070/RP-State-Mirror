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
import {
  MODULE_JOB_TYPES,
  enqueueFeedbackClosedSend,
  enqueueFeedbackOpenPublish,
  enqueueFeedbackReplySend,
  enqueueFeedbackTicketNotify,
  enqueueFormOpenPublish,
  enqueueFormSubmissionDeliver,
  enqueueIcBlacklistEditClosed,
  enqueueIcBlacklistPublish,
  enqueueRolePanelArchive,
  enqueueRolePanelPublish,
  enqueueWebhookRequestNotify,
} from "./module-jobs.js";
import { embedSpecSchema } from "./embeds.js";
import { getSetting } from "./settings.js";

const snowflakeLike = z.string().min(1).max(32);
const snowflakeStrict = z.string().regex(/^\d{17,20}$/);
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

/** Canonical Discord client link to a guild channel message. */
export function discordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

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

/** Badge display is the token number only (no faction/department prefix). */
export function formatTokenDisplay(input: { number: string } | string): string {
  return typeof input === "string" ? input : input.number;
}

const TOKEN_STATUS_LABEL_RU: Record<RecordStatus, string> = {
  ACTIVE: "активна",
  CLOSED: "закрыта",
  EXPIRED: "истекла",
  REVOKED: "отозвана",
  ARCHIVED: "в архиве",
};

export function tokenStatusLabelRu(status: RecordStatus): string {
  return TOKEN_STATUS_LABEL_RU[status] ?? status;
}

export type UserTokenListItem = {
  token: { id: string; number: string; status: RecordStatus; issuedAt: Date; revokedAt: Date | null };
  character: { id: string; name: string; staticId: string };
  display: string;
};

/** All badges ever issued to the user's characters (active + revoked), newest first. */
export async function listTokensForUser(userId: string): Promise<UserTokenListItem[]> {
  const tokens = await prisma.token.findMany({
    where: { character: { userId } },
    include: {
      character: {
        select: { id: true, name: true, staticId: true },
      },
    },
    orderBy: { issuedAt: "desc" },
  });
  return tokens.map((token) => ({
    token: {
      id: token.id,
      number: token.number,
      status: token.status,
      issuedAt: token.issuedAt,
      revokedAt: token.revokedAt,
    },
    character: token.character,
    display: formatTokenDisplay(token.number),
  }));
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
      display: formatTokenDisplay(token.number),
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

export const receiveTokenForStaticSchema = z.object({
  userId: z.string().min(1),
  staticId: nonEmptyText(32),
  /** Optional IC display name; defaults to the static id. */
  name: nonEmptyText(128).optional(),
  factionCode: z.string().trim().max(32).optional(),
  department: z.string().trim().max(128).optional(),
});
export type ReceiveTokenForStaticInput = z.infer<typeof receiveTokenForStaticSchema>;

/**
 * `/нашивка получить` and the receive button: user enters only a static.
 * Creates an ACTIVE character in the next free slot when needed, then issues a badge.
 */
export async function receiveTokenForStatic(input: ReceiveTokenForStaticInput, context: AuditContext) {
  const data = receiveTokenForStaticSchema.parse(input);
  let character = await getCharacterForUser(data.userId, data.staticId);
  let created = false;
  if (!character) {
    const taken = await prisma.character.findFirst({
      where: { staticId: data.staticId, status: RecordStatus.ACTIVE },
      select: { id: true, userId: true },
    });
    if (taken) throw new Error("Этот статик уже привязан к другому персонажу.");
    const active = await prisma.character.findMany({
      where: { userId: data.userId, status: RecordStatus.ACTIVE },
      select: { slot: true },
    });
    if (active.length >= 3) throw new Error("У Discord-аккаунта уже три активных персонажа.");
    const used = new Set(active.map((row) => row.slot));
    const slot = ([1, 2, 3] as const).find((value) => !used.has(value));
    if (slot == null) throw new Error("У Discord-аккаунта уже три активных персонажа.");
    character = {
      ...(await createCharacter(
        {
          userId: data.userId,
          slot,
          staticId: data.staticId,
          name: data.name ?? data.staticId,
          ...(data.factionCode ? { factionCode: data.factionCode } : {}),
          ...(data.department ? { department: data.department } : {}),
        },
        context,
      )),
      tokens: [],
    };
    created = true;
  }
  const token = await issueToken(character.id, context);
  return { character, token, created };
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

/** Free-text model name: non-empty, trimmed, max 128. Catalog is not required for registration. */
export async function resolveVehicleModelName(raw: string): Promise<string> {
  return nonEmptyText(128).parse(raw);
}

export const createRegistrationSchema = z.object({
  kind: z.nativeEnum(RegistrationKind),
  /** Free-text static on the application — not resolved against characters/tokens. */
  staticId: nonEmptyText(32),
  applicantDiscordId: snowflakeLike,
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
      where: { staticId: data.staticId, kind: data.kind, status: RecordStatus.ACTIVE },
    });
    if (active) throw new Error("По этому статику уже есть активная регистрация этого типа.");
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
        staticId: data.staticId,
        applicantDiscordId: data.applicantDiscordId,
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
  webhookUrl: string | null | undefined,
  context: AuditContext,
) {
  return auditedMutation(context, "webhook_request.updated", "webhook_request", async (tx) => {
    const current = await tx.webhookRequest.findUnique({ where: { id } });
    if (!current) throw new Error("Запрос webhook не найден.");
    const updated = await tx.webhookRequest.update({
      where: { id },
      data: {
        status,
        ...(webhookUrl !== undefined ? { webhookUrl } : {}),
      },
    });
    // DM заявителю при смене статуса (форма собрана / отклонён).
    if (
      updated.status !== current.status &&
      (updated.status === "FORM_BUILT" || updated.status === "REJECTED")
    ) {
      await enqueueWebhookRequestNotify(updated.id, tx);
    }
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

/** Active form bound to the same webhook URL as a request (newest first). */
export async function findFormForWebhookRequest(webhookUrl: string | null | undefined) {
  if (!webhookUrl) return null;
  return prisma.discordForm.findFirst({
    where: { webhookUrl, status: RecordStatus.ACTIVE },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listWebhookRequests(filter: { status?: WebhookRequestStatus; limit?: number } = {}) {
  return prisma.webhookRequest.findMany({
    ...(filter.status ? { where: { status: filter.status } } : {}),
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 50,
  });
}

export const createBlacklistSchema = z.object({
  /** Passport number (stored as staticId for character matching). */
  staticId: nonEmptyText(32),
  fullName: nonEmptyText(128),
  reason: nonEmptyText(2000),
  forumLink: nonEmptyText(1000),
  expiresAt: z.coerce.date().nullable().default(null),
  createdByDiscordId: snowflakeLike,
});

export const closeBlacklistSchema = z.object({
  number: nonEmptyText(64),
  closedByDiscordId: snowflakeLike,
  closeReason: nonEmptyText(2000),
});

function isActiveBlacklistEntry(entry: { status: RecordStatus; expiresAt: Date | null }, now = new Date()) {
  return entry.status === RecordStatus.ACTIVE && (!entry.expiresAt || entry.expiresAt > now);
}

/** Next system number BL-001, BL-002, … */
export async function nextIcBlacklistNumber(db: Db = prisma): Promise<string> {
  const last = await db.icBlacklistEntry.findFirst({
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  let seq = 1;
  if (last) {
    const n = Number.parseInt(last.number.replace(/^BL-/i, ""), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `BL-${String(seq).padStart(3, "0")}`;
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
      throw new Error("У этого гражданина уже есть активная запись IC чёрного списка.");
    }
    const number = await nextIcBlacklistNumber(tx);
    const entry = await tx.icBlacklistEntry.create({
      data: {
        number,
        staticId: data.staticId,
        fullName: data.fullName,
        reason: data.reason,
        forumLink: data.forumLink,
        expiresAt: data.expiresAt,
        createdByDiscordId: data.createdByDiscordId,
        status: RecordStatus.ACTIVE,
      },
    });
    await enqueueIcBlacklistPublish(entry.id, tx);
    return { entityId: entry.id, after: entry, result: entry };
  });
}

export async function closeIcBlacklistEntry(input: z.input<typeof closeBlacklistSchema>, context: AuditContext) {
  const data = closeBlacklistSchema.parse(input);
  const number = data.number.toUpperCase();
  return auditedMutation(context, "ic_blacklist.closed", "ic_blacklist", async (tx) => {
    const current = await tx.icBlacklistEntry.findUnique({ where: { number } });
    if (!current || current.status !== RecordStatus.ACTIVE) {
      throw new Error(`Запись ЧС ${number} не найдена или уже снята.`);
    }
    const updated = await tx.icBlacklistEntry.update({
      where: { id: current.id },
      data: {
        status: RecordStatus.CLOSED,
        closedByDiscordId: data.closedByDiscordId,
        closeReason: data.closeReason,
      },
    });
    await enqueueIcBlacklistEditClosed(updated.id, tx);
    return { entityId: updated.id, before: current, after: updated, result: updated };
  });
}

/** @deprecated Prefer closeIcBlacklistEntry by number. */
export async function revokeIcBlacklistEntry(
  id: string,
  actorDiscordId: string,
  context: AuditContext,
  closeReason = "Снято администратором",
) {
  return auditedMutation(context, "ic_blacklist.revoked", "ic_blacklist", async (tx) => {
    const current = await tx.icBlacklistEntry.findUnique({ where: { id } });
    if (!current || current.status !== RecordStatus.ACTIVE) throw new Error("Запись чёрного списка не найдена.");
    const updated = await tx.icBlacklistEntry.update({
      where: { id },
      data: {
        status: RecordStatus.CLOSED,
        closedByDiscordId: actorDiscordId,
        closeReason,
      },
    });
    await enqueueIcBlacklistEditClosed(updated.id, tx);
    return { entityId: id, before: current, after: updated, result: updated };
  });
}

export async function getIcBlacklistByNumber(number: string) {
  return prisma.icBlacklistEntry.findUnique({ where: { number: number.toUpperCase() } });
}

export async function listIcBlacklistEntries(filter: { status?: RecordStatus; limit?: number } = {}) {
  return prisma.icBlacklistEntry.findMany({
    ...(filter.status ? { where: { status: filter.status } } : {}),
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 50,
  });
}

/** Active (non-expired) IC blacklist row for a passport/static, if any. */
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
  const spec = embedSpecSchema.parse(input.spec);
  return auditedMutation(context, "role_panel.created", "role_panel", async (tx) => {
    const panel = await tx.rolePanel.create({
      data: {
        guildDiscordId: input.guildDiscordId,
        channelDiscordId: input.channelDiscordId,
        spec: toJsonValue(spec),
        createdByDiscordId: input.createdByDiscordId,
      },
    });
    await enqueueRolePanelPublish(panel.id, tx);
    return { entityId: panel.id, after: panel, result: panel };
  });
}

export async function listRolePanels() {
  return prisma.rolePanel.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: { updatedAt: "desc" },
  });
}

export async function archiveRolePanel(id: string, context: AuditContext) {
  return auditedMutation(context, "role_panel.archived", "role_panel", async (tx) => {
    const current = await tx.rolePanel.findUnique({ where: { id } });
    if (!current || current.status !== RecordStatus.ACTIVE) throw new Error("Панель не найдена.");
    const panel = await tx.rolePanel.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED },
    });
    await enqueueRolePanelArchive(id, tx);
    return { entityId: id, before: current, after: panel, result: panel };
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
    await enqueueFeedbackTicketNotify(ticket.id, tx);
    return { entityId: ticket.id, after: ticket, result: ticket };
  });
}

export async function addFeedbackMessage(
  ticketId: string,
  authorDiscordId: string,
  content: string,
  context: AuditContext,
) {
  const text = nonEmptyText(4000).parse(content);
  return auditedMutation(context, "feedback_message.created", "feedback_message", async (tx) => {
    const ticket = await tx.feedbackTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === FeedbackTicketStatus.CLOSED) throw new Error("Тикет закрыт или не найден.");
    const message = await tx.feedbackMessage.create({ data: { ticketId, authorDiscordId, content: text } });
    if (authorDiscordId !== ticket.authorDiscordId) {
      await enqueueFeedbackReplySend({ ticketId: ticket.id, messageId: message.id }, tx);
    }
    return { entityId: message.id, after: message, result: message };
  });
}

export async function listFeedbackTickets() {
  return prisma.feedbackTicket.findMany({
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export async function closeFeedbackTicket(id: string, context: AuditContext) {
  return auditedMutation(context, "feedback_ticket.closed", "feedback_ticket", async (tx) => {
    const current = await tx.feedbackTicket.findUnique({
      where: { id },
      include: { messages: true },
    });
    if (!current || current.status === FeedbackTicketStatus.CLOSED) throw new Error("Тикет уже закрыт или не найден.");
    const ticket = await tx.feedbackTicket.update({
      where: { id },
      data: { status: FeedbackTicketStatus.CLOSED },
      include: { messages: true },
    });
    await enqueueFeedbackClosedSend(ticket.id, tx);
    return { entityId: id, before: current, after: ticket, result: ticket };
  });
}

export const publishFeedbackOpenSchema = z.object({
  guildDiscordId: snowflakeStrict,
  channelDiscordId: snowflakeStrict,
});
export type PublishFeedbackOpenInput = z.infer<typeof publishFeedbackOpenSchema>;

/** Queue bot delivery of a channel message with a feedback.open button. */
export async function publishFeedbackOpen(
  input: z.input<typeof publishFeedbackOpenSchema>,
  context: AuditContext,
) {
  const data = publishFeedbackOpenSchema.parse(input);
  return auditedMutation(context, "feedback.open_publish_queued", "system_setting", async (tx) => {
    await enqueueFeedbackOpenPublish(
      {
        guildDiscordId: data.guildDiscordId,
        channelDiscordId: data.channelDiscordId,
      },
      tx,
    );
    return {
      entityId: "feedback.openMessage",
      after: data,
      result: data,
    };
  });
}

/** Persist the last published feedback.open message coordinates (called by the bot worker). */
export async function setFeedbackOpenMessage(message: {
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
}) {
  const parsed = z
    .object({
      guildDiscordId: snowflakeStrict,
      channelDiscordId: snowflakeStrict,
      messageDiscordId: snowflakeStrict,
    })
    .parse(message);
  await prisma.systemSetting.upsert({
    where: { key: "feedback.openMessage" },
    create: { key: "feedback.openMessage", value: toJsonValue(parsed) },
    update: { value: toJsonValue(parsed) },
  });
  return parsed;
}

export async function getDiscordForm(formId: string) {
  return prisma.discordForm.findFirst({
    where: { id: formId, status: RecordStatus.ACTIVE },
    include: { fields: { orderBy: { position: "asc" } } },
  });
}

const formFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().trim().min(1).max(45),
  type: z.enum(["short", "paragraph"]).default("short"),
  required: z.boolean().default(false),
});

export const createDiscordFormSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    webhookUrl: z.string().url().nullable().optional(),
    deliveryChannelId: snowflakeStrict.nullable().optional(),
    expiresAt: z.date().nullable().optional(),
    responseLimit: z.number().int().positive().nullable().optional(),
    /** Discord modals accept at most 5 fields per step; multi-step (>5) is Stage 5. */
    fields: z.array(formFieldSchema).min(1).max(5),
    createdByDiscordId: snowflakeLike,
  })
  .superRefine((data, ctx) => {
    if (!data.webhookUrl && !data.deliveryChannelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Укажите канал доставки и/или webhook URL для ответов формы.",
        path: ["deliveryChannelId"],
      });
    }
  });
export type CreateDiscordFormInput = z.infer<typeof createDiscordFormSchema>;

export async function createDiscordForm(input: CreateDiscordFormInput, context: AuditContext) {
  const data = createDiscordFormSchema.parse(input);
  return auditedMutation(context, "form.created", "form", async (tx) => {
    const form = await tx.discordForm.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        webhookUrl: data.webhookUrl ?? null,
        deliveryChannelId: data.deliveryChannelId ?? null,
        expiresAt: data.expiresAt ?? null,
        responseLimit: data.responseLimit ?? null,
        createdByDiscordId: data.createdByDiscordId,
        fields: {
          create: data.fields.map((field, position) => ({
            ...field,
            position,
            validation: {},
          })),
        },
      },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    return { entityId: form.id, after: form, result: form };
  });
}

/** Disable form.open without deleting history (status CLOSED). */
export async function disableDiscordForm(id: string, context: AuditContext) {
  return auditedMutation(context, "form.disabled", "form", async (tx) => {
    const current = await tx.discordForm.findFirst({
      where: { id, status: RecordStatus.ACTIVE },
    });
    if (!current) throw new Error("Форма не найдена или уже отключена.");
    const form = await tx.discordForm.update({
      where: { id },
      data: { status: RecordStatus.CLOSED },
    });
    return { entityId: id, before: current, after: form, result: form };
  });
}

/** Re-enable a previously disabled form. */
export async function enableDiscordForm(id: string, context: AuditContext) {
  return auditedMutation(context, "form.enabled", "form", async (tx) => {
    const current = await tx.discordForm.findFirst({
      where: { id, status: RecordStatus.CLOSED },
    });
    if (!current) throw new Error("Форма не найдена или не отключена.");
    const form = await tx.discordForm.update({
      where: { id },
      data: { status: RecordStatus.ACTIVE },
    });
    return { entityId: id, before: current, after: form, result: form };
  });
}

/** Soft-delete a form (status ARCHIVED). form.open stops working. */
export async function archiveDiscordForm(id: string, context: AuditContext) {
  return auditedMutation(context, "form.archived", "form", async (tx) => {
    const current = await tx.discordForm.findFirst({
      where: { id, status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
    });
    if (!current) throw new Error("Форма не найдена.");
    const form = await tx.discordForm.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED },
    });
    return { entityId: id, before: current, after: form, result: form };
  });
}

export const publishDiscordFormOpenSchema = z.object({
  formId: z.string().min(1),
  guildDiscordId: snowflakeStrict,
  channelDiscordId: snowflakeStrict,
});
export type PublishDiscordFormOpenInput = z.infer<typeof publishDiscordFormOpenSchema>;

/** Queue bot delivery of a channel message with a form.open button. */
export async function publishDiscordFormOpen(
  input: z.input<typeof publishDiscordFormOpenSchema>,
  context: AuditContext,
) {
  const data = publishDiscordFormOpenSchema.parse(input);
  return auditedMutation(context, "form.open_publish_queued", "form", async (tx) => {
    const form = await tx.discordForm.findFirst({
      where: { id: data.formId, status: RecordStatus.ACTIVE },
    });
    if (!form) throw new Error("Форма не найдена.");
    await enqueueFormOpenPublish(
      {
        formId: form.id,
        guildDiscordId: data.guildDiscordId,
        channelDiscordId: data.channelDiscordId,
      },
      tx,
    );
    return { entityId: form.id, after: form, result: form };
  });
}

/** Persist the last published form.open message coordinates (called by the bot worker). */
export async function setDiscordFormOpenMessage(
  formId: string,
  message: { guildDiscordId: string; channelDiscordId: string; messageDiscordId: string },
) {
  return prisma.discordForm.update({
    where: { id: formId },
    data: {
      openGuildDiscordId: message.guildDiscordId,
      openChannelDiscordId: message.channelDiscordId,
      openMessageDiscordId: message.messageDiscordId,
    },
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
  const context: AuditContext = {
    actorType: authorDiscordId ? AuditActorType.USER : AuditActorType.SYSTEM,
    source: "discord.form",
    metadata: { authorDiscordId: authorDiscordId ?? null, formId },
  };
  return auditedMutation(context, "form.submitted", "form_submission", async (tx) => {
    // Lock the form row so concurrent submissions cannot both pass the response-limit check.
    await tx.$queryRaw`SELECT id FROM forms WHERE id = ${formId} FOR UPDATE`;
    if (form.responseLimit !== null) {
      const count = await tx.formSubmission.count({ where: { formId } });
      if (count >= form.responseLimit) throw new Error("Лимит ответов формы исчерпан.");
    }
    const submission = await tx.formSubmission.create({
      data: { formId, values: toJsonValue(values), authorDiscordId, source: "discord" },
    });
    if (form.webhookUrl || form.deliveryChannelId) {
      await enqueueFormSubmissionDeliver(submission.id, tx);
    }
    return { entityId: submission.id, after: submission, result: submission };
  });
}
