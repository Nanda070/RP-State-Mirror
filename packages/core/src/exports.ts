/**
 * CSV export of registries (§5.2). UTF-8 with BOM and `;` separator — opens correctly in Excel.
 */
import { RegistrationKind, prisma } from "@mirror/db";

/** Excel reads UTF-8 CSV correctly only with a byte order mark. */
const UTF8_BOM = String.fromCharCode(0xfeff);

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  // A leading = + - @ would be run as a formula by spreadsheet apps; prefix it to keep it text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `${UTF8_BOM}${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export const EXPORT_REGISTRIES = [
  "documents",
  "wanted",
  "fines",
  "personnel",
  "ic-blacklist",
  "registrations-vehicles",
  "registrations-uniforms",
  "tokens",
] as const;
export type ExportRegistry = (typeof EXPORT_REGISTRIES)[number];

export const EXPORT_TITLES: Record<ExportRegistry, string> = {
  documents: "Документы",
  wanted: "Розыск",
  fines: "Штрафы",
  personnel: "Кадровый аудит",
  "ic-blacklist": "IC чёрный список",
  "registrations-vehicles": "Регистрации ТС",
  "registrations-uniforms": "Регистрации униформы",
  tokens: "Нашивки",
};

const MAX_ROWS = 50_000;
const newest = { orderBy: { createdAt: "desc" }, take: MAX_ROWS } as const;

function payloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** The whole registry as CSV (newest first, capped at 50 000 rows). */
export async function exportRegistryCsv(registry: ExportRegistry): Promise<string> {
  switch (registry) {
    case "documents": {
      const rows = await prisma.document.findMany(newest);
      return toCsv(
        ["Номер", "Фракция", "Описание", "Уведомляемое лицо", "Ссылка на форум", "Автор (Discord ID)", "Статус", "Создан (UTC)", "Истекает (UTC)"],
        rows.map((r) => [r.number, r.factionCode, r.content, r.notifiedPerson, r.forumLink, r.authorDiscordId, r.status, r.createdAt, r.expiresAt]),
      );
    }
    case "wanted": {
      const rows = await prisma.wanted.findMany(newest);
      return toCsv(
        ["Номер", "ФИО", "Паспорт", "Обвинение", "Срок", "Ссылка на форум", "Объявил (Discord ID)", "Закрыл (Discord ID)", "Доказательства", "Статус", "Создан (UTC)"],
        rows.map((r) => [r.number, r.characterName, r.staticId, r.reason, r.termText, r.forumLink, r.issuedByDiscordId, r.closedByDiscordId, r.evidence, r.status, r.createdAt]),
      );
    }
    case "fines": {
      const rows = await prisma.fine.findMany(newest);
      return toCsv(
        ["Номер", "ФИО", "Паспорт", "Сумма", "Основание", "Фракция", "Срок оплаты", "Выписал (Discord ID)", "Оплату отметил (Discord ID)", "Оплачен (UTC)", "Статус", "Создан (UTC)"],
        rows.map((r) => [r.number, r.characterName, r.staticId, r.amount, r.reason, r.factionCode, r.paymentDeadlineText, r.issuedByDiscordId, r.paidByDiscordId, r.paidAt, r.status, r.createdAt]),
      );
    }
    case "personnel": {
      const rows = await prisma.personnelEvent.findMany(newest);
      return toCsv(
        ["Фракция", "Тип", "Сотрудник", "Сотрудник (Discord ID)", "Оформил (Discord ID)", "Детали", "Статус", "Создан (UTC)"],
        rows.map((r) => [r.factionCode, r.type, r.subjectName, r.subjectDiscordId, r.actorDiscordId, JSON.stringify(r.details ?? {}), r.status, r.createdAt]),
      );
    }
    case "ic-blacklist": {
      const rows = await prisma.icBlacklistEntry.findMany(newest);
      return toCsv(
        ["Номер", "ФИО", "Паспорт", "Причина", "Ссылка на форум", "Добавил (Discord ID)", "Снял (Discord ID)", "Причина снятия", "Статус", "Создан (UTC)"],
        rows.map((r) => [r.number, r.fullName, r.staticId, r.reason, r.forumLink, r.createdByDiscordId, r.closedByDiscordId, r.closeReason, r.status, r.createdAt]),
      );
    }
    case "registrations-vehicles":
    case "registrations-uniforms": {
      const vehicle = registry === "registrations-vehicles";
      const rows = await prisma.registration.findMany({
        where: { kind: vehicle ? RegistrationKind.VEHICLE : RegistrationKind.UNIFORM },
        ...newest,
      });
      return toCsv(
        ["ID", "Статик", vehicle ? "Модель" : "Описание", "Госномер", "Заявитель (Discord ID)", "Решение", "Решил (Discord ID)", "Причина отказа", "Статус", "Подана (UTC)", "Решена (UTC)", "Действует до (UTC)"],
        rows.map((r) => [r.id, r.staticId, payloadText(r.payload, vehicle ? "model" : "description"), r.plate, r.applicantDiscordId, r.decision, r.decidedByDiscordId, r.rejectionReason, r.status, r.createdAt, r.decidedAt, r.expiresAt]),
      );
    }
    case "tokens": {
      const rows = await prisma.token.findMany({
        orderBy: { issuedAt: "desc" },
        take: MAX_ROWS,
        include: { character: { include: { user: { select: { discordId: true } } } } },
      });
      return toCsv(
        ["Номер нашивки", "Персонаж", "Статик", "Владелец (Discord ID)", "Статус", "Выдана (UTC)", "Отозвана (UTC)"],
        rows.map((r) => [r.number, r.character.name, r.character.staticId, r.character.user.discordId, r.status, r.issuedAt, r.revokedAt]),
      );
    }
  }
}
