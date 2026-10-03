/**
 * Legacy Discord embed builders ported 1:1 from embeds.py / utils.py.
 * Outbound bot job delivery should use these shapes (colors, fields, spoilers).
 *
 * Field layout: prefer non-inline fields over cramped descriptions so Discord
 * renders embeds at a usable width (description-only embeds stay narrow).
 */
import type { ClassicEmbed } from "./embeds.js";
import { normalizeLinkOrText, spoilerLink } from "./text.js";

// ──────────────────────────────────────────────────────────────
// Colors (embeds.py)
// ──────────────────────────────────────────────────────────────

export const COLOR_DEFAULT = 0x89_89_a8;
export const COLOR_RESPONSE = 0x8b_6f_47;
export const COLOR_WANTED = 0x6e_6b_73;
export const COLOR_WANTED_DONE = 0x5a_8f_63;
export const COLOR_SUCCESS = 0x5a_8f_63;
export const COLOR_ERROR = 0xa6_4b_4b;
export const COLOR_FINE = 0xb0_7a_3f;
export const COLOR_FINE_PAID = 0x5a_8f_63;
export const COLOR_FINE_OVERDUE = 0xa6_4b_4b;

/** Legacy BOT_FOOTER_ICON default used across all bot embeds. */
export const BOT_FOOTER_ICON = "https://i.imgur.com/CvzCrPA.png";

// ──────────────────────────────────────────────────────────────
// Helpers (utils.py + embeds.get_msk_time_str)
// ──────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `Бот Discord | dd.mm.yyyy HH:mm:ss` in the host local timezone. */
export function footerText(now: Date = new Date()): string {
  const dd = pad2(now.getDate());
  const mm = pad2(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const HH = pad2(now.getHours());
  const MM = pad2(now.getMinutes());
  const SS = pad2(now.getSeconds());
  return `Бот Discord | ${dd}.${mm}.${yyyy} ${HH}:${MM}:${SS}`;
}

/** `dd.mm.yyyy HH:mm МСК` for compact audit footer. */
export function getMskTimeStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")} МСК`;
}

export function discordIdentity(displayName: string, username: string): string {
  return `${displayName} (${username})`;
}

/** Prefer the user's avatar; fall back to the bot footer icon. */
export function safeAvatarUrl(avatarUrl: string | null | undefined): string {
  const url = String(avatarUrl ?? "").trim();
  return url || BOT_FOOTER_ICON;
}

function fieldValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "—";
}

/** Non-inline fields stretch Discord embeds wider than description-only layouts. */
function detailFields(
  rows: ReadonlyArray<{ name: string; value: string }>,
): NonNullable<ClassicEmbed["fields"]> {
  return rows.map((row) => ({
    name: row.name,
    value: fieldValue(row.value),
    inline: false,
  }));
}

function withFooter(embed: Omit<ClassicEmbed, "type" | "footer">, now?: Date): ClassicEmbed {
  return {
    type: "embed",
    ...embed,
    footer: { text: footerText(now), iconUrl: BOT_FOOTER_ICON },
  };
}

function withOrbitFooter(embed: Omit<ClassicEmbed, "type" | "footer">, now?: Date): ClassicEmbed {
  return {
    type: "embed",
    ...embed,
    footer: { text: `Бот Orbit | ${getMskTimeStr(now)}`, iconUrl: BOT_FOOTER_ICON },
  };
}

// ──────────────────────────────────────────────────────────────
// Actor / row shapes (plain data — no discord.js dependency)
// ──────────────────────────────────────────────────────────────

export type LegacyActor = {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
};

export type LegacyFineRow = {
  fineNumber: string;
  faction: string;
  fio: string;
  passport: string;
  article: string;
  amount: string | number;
  paymentDeadlineText: string;
  createdByDisplayName: string;
  createdByUsername: string;
};

// ──────────────────────────────────────────────────────────────
// Builders (embeds.py)
// ──────────────────────────────────────────────────────────────

export function makeDocumentEmbed(input: {
  actor: LegacyActor;
  faction: string;
  docNumber: string;
  description: string;
  notifiedPerson: string;
  forumLink: string;
  leaderText: string;
  deputyText: string;
  now?: Date;
}): ClassicEmbed {
  const { actor } = input;
  return withFooter(
    {
      title: `Новый документ от ${actor.displayName}`,
      color: COLOR_DEFAULT,
      fields: detailFields([
        { name: "Уведомляемая фракция", value: input.faction },
        { name: "Уведомляемое лицо", value: input.notifiedPerson },
        { name: "Номер документа", value: input.docNumber },
        { name: "Краткое описание", value: input.description },
        {
          name: "Ответственные",
          value: `${input.leaderText}, ${input.deputyText}, ${input.notifiedPerson}.`,
        },
        { name: "Ссылка на форум", value: spoilerLink(input.forumLink) },
      ]),
      author: {
        name: `Автор: ${actor.username}`,
        iconUrl: safeAvatarUrl(actor.avatarUrl),
      },
    },
    input.now,
  );
}

export function makeResponseEmbed(input: {
  docNumber: string;
  actor: LegacyActor;
  personalFile: string;
  video: string;
  comment: string;
  now?: Date;
}): ClassicEmbed {
  const { actor } = input;
  return withFooter(
    {
      title: `Ответ на Документ ${input.docNumber}`,
      color: COLOR_RESPONSE,
      fields: detailFields([
        { name: "Личное дело", value: normalizeLinkOrText(input.personalFile) },
        { name: "Видеофиксация", value: normalizeLinkOrText(input.video) },
        { name: "Комментарий", value: normalizeLinkOrText(input.comment) },
      ]),
      author: {
        name: `Автор ответа: ${actor.username}`,
        iconUrl: safeAvatarUrl(actor.avatarUrl),
      },
    },
    input.now,
  );
}

export function makeWantedEmbed(input: {
  actorName: string;
  actorUsername: string;
  actorAvatarUrl: string | null | undefined;
  fio: string;
  passport: string;
  orderNumber: string;
  article: string;
  termText: string;
  forumLink: string;
  closed?: boolean;
  closedBy?: string | null;
  evidenceLink?: string | null;
  now?: Date;
}): ClassicEmbed {
  const closed = Boolean(input.closed);
  const wrap = (text: string) => (closed ? `~~${text}~~` : text);

  const fields = detailFields([
    { name: "Издал ордер", value: wrap(input.actorName) },
    { name: "Разыскиваемый", value: wrap(input.fio) },
    { name: "Номер паспорта", value: wrap(input.passport) },
    { name: "Номер ордера", value: wrap(input.orderNumber) },
    { name: "Обвинения", value: wrap(input.article) },
    { name: "Срок заключения", value: wrap(input.termText) },
  ]);

  if (closed) {
    fields.push(
      ...detailFields([
        { name: "Статус", value: "Исполнено" },
        { name: "Исполнение зарегистрировал", value: input.closedBy ?? "—" },
        { name: "Доказательства", value: normalizeLinkOrText(input.evidenceLink) },
      ]),
    );
  } else if (input.forumLink) {
    fields.push({
      name: "Ссылка на форум",
      value: spoilerLink(input.forumLink),
      inline: false,
    });
  }

  return withFooter(
    {
      title: closed
        ? "Исполненный ордер правительства штата"
        : "Новый ордер от правительства штата",
      color: closed ? COLOR_WANTED_DONE : COLOR_WANTED,
      fields,
      author: {
        name: `Автор: ${input.actorUsername}`,
        iconUrl: safeAvatarUrl(input.actorAvatarUrl),
      },
    },
    input.now,
  );
}

export function makeWantedDoneEmbed(input: {
  actor: LegacyActor;
  wantedNumber: string;
  evidenceLink: string;
  now?: Date;
}): ClassicEmbed {
  const { actor } = input;
  return withFooter(
    {
      title: "Зарегистрировано исполнение ордера",
      color: COLOR_WANTED_DONE,
      fields: detailFields([
        {
          name: "Исполнение зарегистрировал",
          value: discordIdentity(actor.displayName, actor.username),
        },
        { name: "Номер ордера", value: input.wantedNumber },
        { name: "Доказательства исполнения", value: normalizeLinkOrText(input.evidenceLink) },
      ]),
      author: {
        name: `Автор: ${actor.username}`,
        iconUrl: safeAvatarUrl(actor.avatarUrl),
      },
    },
    input.now,
  );
}

export function makeFineEmbed(input: {
  actor: LegacyActor;
  faction: string;
  fineNumber: string;
  fio: string;
  passport: string;
  article: string;
  amount: string | number;
  paymentDeadlineText: string;
  now?: Date;
}): ClassicEmbed {
  const { actor } = input;
  return withFooter(
    {
      title: `Новый штраф от ${actor.displayName}`,
      color: COLOR_FINE,
      fields: detailFields([
        { name: "Уведомляемая фракция", value: input.faction },
        { name: "Номер штрафа", value: input.fineNumber },
        { name: "ФИО", value: input.fio },
        { name: "Паспорт", value: input.passport },
        { name: "Статья", value: input.article },
        { name: "Сумма штрафа", value: String(input.amount) },
        { name: "Срок оплаты", value: input.paymentDeadlineText },
      ]),
      author: {
        name: `Автор: ${actor.username}`,
        iconUrl: safeAvatarUrl(actor.avatarUrl),
      },
    },
    input.now,
  );
}

export function makeFinePaidEmbed(input: {
  fineNumber: string;
  fio: string;
  passport: string;
  amount: string | number;
  actor: LegacyActor;
  now?: Date;
}): ClassicEmbed {
  const { actor } = input;
  return withFooter(
    {
      title: "Штраф оплачен",
      color: COLOR_FINE_PAID,
      fields: detailFields([
        { name: "Номер штрафа", value: input.fineNumber },
        { name: "ФИО", value: input.fio },
        { name: "Паспорт", value: input.passport },
        { name: "Сумма", value: String(input.amount) },
        {
          name: "Оплату зарегистрировал",
          value: discordIdentity(actor.displayName, actor.username),
        },
      ]),
      author: {
        name: `Автор: ${actor.username}`,
        iconUrl: safeAvatarUrl(actor.avatarUrl),
      },
    },
    input.now,
  );
}

export function makeFineOverdueEmbed(input: {
  fine: LegacyFineRow;
  now?: Date;
}): ClassicEmbed {
  const { fine } = input;
  return withFooter(
    {
      title: "Неоплаченный штраф",
      color: COLOR_FINE_OVERDUE,
      fields: detailFields([
        { name: "Номер штрафа", value: fine.fineNumber },
        { name: "Фракция", value: fine.faction },
        { name: "ФИО", value: fine.fio },
        { name: "Паспорт", value: fine.passport },
        { name: "Статья", value: fine.article },
        { name: "Сумма штрафа", value: String(fine.amount) },
        { name: "Срок оплаты истёк", value: fine.paymentDeadlineText },
        {
          name: "Штраф выписал",
          value: `${fine.createdByDisplayName} (${fine.createdByUsername})`,
        },
      ]),
    },
    input.now,
  );
}

export function makeCompactAuditEmbed(input: {
  actionTitle: string;
  actorDisplayName: string;
  actorId: string;
  targetDisplayName: string;
  targetId: string;
  actorLabel: string;
  targetLabel: string;
  detailsText: string;
  targetAvatarUrl?: string | null;
  now?: Date;
}): ClassicEmbed {
  const fields: NonNullable<ClassicEmbed["fields"]> = [
    {
      name: input.actorLabel,
      value: `${input.actorDisplayName} | ${input.actorId}`,
      inline: false,
    },
    {
      name: input.targetLabel,
      value: `${input.targetDisplayName} | ${input.targetId}`,
      inline: false,
    },
  ];
  if (input.detailsText) {
    fields.push({ name: "\u200b", value: input.detailsText, inline: false });
  }

  return withOrbitFooter(
    {
      title: `Кадровый-Аудит ${input.actionTitle}`,
      color: COLOR_DEFAULT,
      fields,
      thumbnail: safeAvatarUrl(input.targetAvatarUrl),
    },
    input.now,
  );
}

export function makeSyncLogEmbed(input: {
  memberMention: string;
  displayName: string;
  username: string;
  userId: string;
  action: string;
  details: string;
  color: number;
  avatarUrl?: string | null;
  now?: Date;
}): ClassicEmbed {
  return withFooter(
    {
      title: `Синхронизация доступов: ${input.action}`,
      color: input.color,
      timestamp: true,
      fields: detailFields([
        { name: "Пользователь", value: input.memberMention },
        { name: "Discord", value: discordIdentity(input.displayName, input.username) },
        { name: "User ID", value: `\`${input.userId}\`` },
        { name: "Детали", value: input.details },
      ]),
      thumbnail: safeAvatarUrl(input.avatarUrl),
    },
    input.now,
  );
}

/** Labels for Mirror personnel event → legacy compact audit titles. */
export const PERSONNEL_AUDIT_META = {
  promotion: {
    actionTitle: "повышения",
    actorLabel: "Повысил:",
    targetLabel: "Повышаемый:",
  },
  dismissal: {
    actionTitle: "увольнения",
    actorLabel: "Уволил:",
    targetLabel: "Увольняемый:",
  },
  transfer: {
    actionTitle: "перевода (Отдел)",
    actorLabel: "Оформил перевод:",
    targetLabel: "Переведенный:",
  },
  reinstatement: {
    actionTitle: "восстановления",
    actorLabel: "Восстановил:",
    targetLabel: "Восстановленный:",
  },
  appointment: {
    actionTitle: "назначения",
    actorLabel: "Назначил:",
    targetLabel: "Назначенный:",
  },
} as const;

/** Format stored personnel details JSON into legacy compact-audit details line. */
export function formatPersonnelDetailsText(
  type: keyof typeof PERSONNEL_AUDIT_META,
  details: unknown,
): string {
  const d =
    typeof details === "object" && details !== null
      ? (details as Record<string, unknown>)
      : {};

  switch (type) {
    case "promotion": {
      const from = d.fromRank != null ? String(d.fromRank) : "—";
      const to = d.toRank != null ? String(d.toRank) : "—";
      const reason = d.comment != null ? String(d.comment) : "—";
      return `**Был:** ${from} | **Стал:** ${to} | **Причина:** ${reason}`;
    }
    case "dismissal": {
      const reason = d.reason != null ? String(d.reason) : "—";
      return `**Причина:** ${reason}`;
    }
    case "transfer": {
      const from = d.fromDepartment != null ? String(d.fromDepartment) : "—";
      const to = d.toDepartment != null ? String(d.toDepartment) : "—";
      return `**Был:** ${from} | **Стал:** ${to}`;
    }
    case "reinstatement": {
      const rank = d.comment != null ? String(d.comment) : "—";
      return `**Восстановлен на:** ${rank}`;
    }
    case "appointment": {
      const reason = d.position != null ? String(d.position) : d.comment != null ? String(d.comment) : "—";
      return `**Причина:** ${reason}`;
    }
    default:
      return "—";
  }
}
