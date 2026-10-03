/**
 * Public «share» links (§5.8): a registry record opens by an unguessable link without sign-in and
 * shows only a brief card — no Discord ids, no forum links, no internal notes. A revoked link is
 * indistinguishable from one that never existed.
 */
import { randomBytes } from "node:crypto";
import { DecisionStatus, RecordStatus, RegistrationKind, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";
import { formatMoney } from "./text.js";

export const SHARE_ENTITY_TYPES = ["wanted", "ic_blacklist", "fine", "document", "registration"] as const;
export type ShareEntityType = (typeof SHARE_ENTITY_TYPES)[number];

export class ShareLinkError extends UserError {
  override name = "ShareLinkError";
}

export const createShareLinkSchema = z.object({
  entityType: z.enum(SHARE_ENTITY_TYPES),
  entityId: z.string().min(1).max(64),
  createdByDiscordId: z.string().min(1).max(32),
});

/** 144 bits of randomness, URL-safe: the token is the only thing protecting the card. */
function newToken(): string {
  return randomBytes(18).toString("base64url");
}

async function entityExists(entityType: ShareEntityType, entityId: string): Promise<boolean> {
  const where = { where: { id: entityId }, select: { id: true } } as const;
  switch (entityType) {
    case "wanted":
      return Boolean(await prisma.wanted.findUnique(where));
    case "ic_blacklist":
      return Boolean(await prisma.icBlacklistEntry.findUnique(where));
    case "fine":
      return Boolean(await prisma.fine.findUnique(where));
    case "document":
      return Boolean(await prisma.document.findUnique(where));
    case "registration":
      return Boolean(await prisma.registration.findUnique(where));
  }
}

/** Returns the record's ACTIVE link, creating one when there is none (one live link per record). */
export async function createShareLink(input: z.input<typeof createShareLinkSchema>, context: AuditContext) {
  const data = createShareLinkSchema.parse(input);
  if (!(await entityExists(data.entityType, data.entityId))) throw new ShareLinkError("Запись не найдена.");
  return auditedMutation(context, "share_link.created", "share_link", async (tx) => {
    const existing = await tx.shareLink.findFirst({
      where: { entityType: data.entityType, entityId: data.entityId, status: RecordStatus.ACTIVE },
    });
    if (existing) return { entityId: existing.id, metadata: { reused: true }, result: existing };
    const link = await tx.shareLink.create({ data: { ...data, token: newToken() } });
    // The token is a secret: the audit trail records that a link exists, not the link itself.
    return {
      entityId: link.id,
      after: { entityType: link.entityType, entityId: link.entityId },
      result: link,
    };
  });
}

export async function revokeShareLink(id: string, actorDiscordId: string, context: AuditContext) {
  return auditedMutation(context, "share_link.revoked", "share_link", async (tx) => {
    const current = await tx.shareLink.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
    if (!current) throw new ShareLinkError("Ссылка не найдена или уже отозвана.");
    const link = await tx.shareLink.update({
      where: { id },
      data: { status: RecordStatus.REVOKED, revokedAt: new Date(), revokedByDiscordId: actorDiscordId },
    });
    return {
      entityId: id,
      before: { status: current.status },
      after: { status: link.status, entityType: link.entityType, entityId: link.entityId },
      result: link,
    };
  });
}

/** ACTIVE links of the given records, keyed by record id (for registry tables). */
export async function listShareLinksFor(entityType: ShareEntityType, entityIds: readonly string[]) {
  const map = new Map<string, { id: string; token: string }>();
  if (entityIds.length === 0) return map;
  const links = await prisma.shareLink.findMany({
    where: { entityType, entityId: { in: [...entityIds] }, status: RecordStatus.ACTIVE },
    select: { id: true, token: true, entityId: true },
  });
  for (const link of links) map.set(link.entityId, { id: link.id, token: link.token });
  return map;
}

export interface ShareCard {
  entityType: ShareEntityType;
  /** Kind of record, e.g. «Федеральный розыск». */
  kind: string;
  title: string;
  status: { label: string; tone: "ok" | "warn" | "muted" };
  facts: { label: string; value: string }[];
  createdAt: Date;
  /** media_files id of a photo that may be shown with the card, served only through the link. */
  photoFileId: string | null;
}

const RECORD_STATUS_RU: Record<RecordStatus, string> = {
  ACTIVE: "Активен",
  CLOSED: "Закрыт",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

function recordStatus(status: RecordStatus, labels: Partial<Record<RecordStatus, string>> = {}): ShareCard["status"] {
  return {
    label: labels[status] ?? RECORD_STATUS_RU[status],
    tone: status === RecordStatus.ACTIVE ? "warn" : status === RecordStatus.CLOSED ? "ok" : "muted",
  };
}

function payloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "—";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function dateRu(date: Date | null): string {
  return date ? date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "—";
}

async function buildCard(entityType: ShareEntityType, entityId: string): Promise<ShareCard | null> {
  switch (entityType) {
    case "wanted": {
      const row = await prisma.wanted.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        entityType,
        kind: "Федеральный розыск",
        title: `Ордер ${row.number}`,
        status: recordStatus(row.status, { ACTIVE: "В розыске", CLOSED: "Исполнен" }),
        facts: [
          { label: "ФИО", value: row.characterName },
          { label: "Паспорт", value: row.staticId },
          { label: "Обвинение", value: row.reason },
          { label: "Срок", value: row.termText },
        ],
        createdAt: row.createdAt,
        photoFileId: null,
      };
    }
    case "ic_blacklist": {
      const row = await prisma.icBlacklistEntry.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        entityType,
        kind: "IC чёрный список",
        title: `Запись ${row.number}`,
        status: recordStatus(row.status, { ACTIVE: "Действует", CLOSED: "Снят" }),
        facts: [
          { label: "ФИО", value: row.fullName },
          { label: "Паспорт", value: row.staticId },
          { label: "Причина", value: row.reason },
          ...(row.status === RecordStatus.CLOSED && row.closeReason
            ? [{ label: "Причина снятия", value: row.closeReason }]
            : []),
        ],
        createdAt: row.createdAt,
        photoFileId: null,
      };
    }
    case "fine": {
      const row = await prisma.fine.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        entityType,
        kind: "Штраф",
        title: `Штраф ${row.number}`,
        status: recordStatus(row.status, { ACTIVE: "Не оплачен", CLOSED: "Оплачен", REVOKED: "Отменён" }),
        facts: [
          { label: "ФИО", value: row.characterName },
          { label: "Паспорт", value: row.staticId },
          { label: "Сумма", value: formatMoney(row.amount) },
          { label: "Основание", value: row.reason },
          { label: "Срок оплаты", value: row.paymentDeadlineText },
        ],
        createdAt: row.createdAt,
        photoFileId: null,
      };
    }
    case "document": {
      const row = await prisma.document.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        entityType,
        kind: "Документ",
        title: `Документ ${row.number}`,
        status: recordStatus(row.status, { ACTIVE: "Ожидает ответа", CLOSED: "Ответ получен" }),
        facts: [
          { label: "Фракция", value: row.factionCode },
          { label: "Описание", value: row.content },
          { label: "Уведомляемое лицо", value: row.notifiedPerson },
        ],
        createdAt: row.createdAt,
        photoFileId: null,
      };
    }
    case "registration": {
      const row = await prisma.registration.findUnique({ where: { id: entityId } });
      if (!row) return null;
      const vehicle = row.kind === RegistrationKind.VEHICLE;
      const status: ShareCard["status"] =
        row.status === RecordStatus.EXPIRED
          ? { label: "Истекла", tone: "muted" }
          : row.decision === DecisionStatus.APPROVED
            ? { label: "Действует", tone: "ok" }
            : row.decision === DecisionStatus.REJECTED
              ? { label: "Отказано", tone: "muted" }
              : { label: "На рассмотрении", tone: "warn" };
      return {
        entityType,
        kind: vehicle ? "Регистрация ТС" : "Регистрация униформы",
        title: vehicle ? `ТС ${row.plate ?? "без номера"}` : "Униформа",
        status,
        facts: [
          { label: "Статик владельца", value: row.staticId },
          vehicle
            ? { label: "Модель", value: payloadText(row.payload, "model") }
            : { label: "Описание", value: payloadText(row.payload, "description") },
          ...(vehicle ? [{ label: "Госномер", value: row.plate ?? "—" }] : []),
          ...(row.decision === DecisionStatus.APPROVED ? [{ label: "Действует до", value: dateRu(row.expiresAt) }] : []),
        ],
        createdAt: row.createdAt,
        // The photo is public only while the registration is approved.
        photoFileId: row.decision === DecisionStatus.APPROVED ? (row.evidenceFileIds[0] ?? null) : null,
      };
    }
  }
}

/** The public card behind a token, or null for unknown and revoked links. */
export async function resolveShareLink(token: string): Promise<ShareCard | null> {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || link.status !== RecordStatus.ACTIVE) return null;
  if (!(SHARE_ENTITY_TYPES as readonly string[]).includes(link.entityType)) return null;
  return buildCard(link.entityType as ShareEntityType, link.entityId);
}
