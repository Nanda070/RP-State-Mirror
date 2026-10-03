import {
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

export const createRegistrationSchema = z.object({
  kind: z.nativeEnum(RegistrationKind),
  characterId: z.string().min(1),
  payload: z.record(z.unknown()),
  evidenceFileIds: z.array(z.string().min(1)).max(10).default([]),
});

export async function createRegistration(
  input: z.input<typeof createRegistrationSchema>,
  context: AuditContext,
) {
  const data = createRegistrationSchema.parse(input);
  return auditedMutation(context, "registration.created", "registration", async (tx) => {
    const active = await tx.registration.findFirst({
      where: { characterId: data.characterId, kind: data.kind, status: RecordStatus.ACTIVE },
    });
    if (active) throw new Error("У персонажа уже есть активная регистрация этого типа.");
    const created = await tx.registration.create({
      data: {
        kind: data.kind,
        characterId: data.characterId,
        payload: toJsonValue(data.payload),
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
    return { entityId: id, before: current, after: updated, result: updated };
  });
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

export async function createTransfer(input: z.input<typeof createTransferSchema>, context: AuditContext) {
  const data = createTransferSchema.parse(input);
  if (data.fromFactionCode.toUpperCase() === data.toFactionCode.toUpperCase()) {
    throw new Error("Фракции отправителя и получателя должны различаться.");
  }
  return auditedMutation(context, "transfer.created", "transfer", async (tx) => {
    const pending = await tx.transfer.findFirst({
      where: { characterId: data.characterId, status: TransferStatus.PENDING },
      select: { id: true },
    });
    if (pending) throw new Error("У персонажа уже есть заявка на перевод на рассмотрении.");
    const created = await tx.transfer.create({
      data: {
        ...data,
        fromFactionCode: data.fromFactionCode.toUpperCase(),
        toFactionCode: data.toFactionCode.toUpperCase(),
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
});

export async function createWebhookRequest(
  input: z.input<typeof createWebhookRequestSchema>,
  context: AuditContext,
) {
  const data = createWebhookRequestSchema.parse(input);
  return auditedMutation(context, "webhook_request.created", "webhook_request", async (tx) => {
    const request = await tx.webhookRequest.create({ data });
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

export async function createIcBlacklistEntry(input: z.input<typeof createBlacklistSchema>, context: AuditContext) {
  const data = createBlacklistSchema.parse(input);
  return auditedMutation(context, "ic_blacklist.created", "ic_blacklist", async (tx) => {
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
