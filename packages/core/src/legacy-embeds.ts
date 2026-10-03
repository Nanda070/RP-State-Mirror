/**
 * Legacy Discord embed builders ported 1:1 from embeds.py / utils.py.
 * Outbound bot job delivery should use these shapes (colors, fields, spoilers).
 *
 * Layout: prefer a single `description` with `**Label:** value` lines (legacy /
 * GitHub-like width) over a tall stack of non-inline fields. Forum links stay
 * as a field when the Python bot did the same.
 */
import type { ClassicEmbed } from "./embeds.js";
import { formatMoney, normalizeLinkOrText, spoilerLink } from "./text.js";

// ──────────────────────────────────────────────────────────────
// Colors (embeds.py)
// ──────────────────────────────────────────────────────────────

export const COLOR_DEFAULT = 0x89_89_a8;
export const COLOR_RESPONSE = 0x8b_6f_47;
export const COLOR_WANTED = 0x6e_6b_73;
export const COLOR_WANTED_DONE = 0x5a_8f_63;
/** Government IC blacklist publish color (15158332). */
export const COLOR_IC_BLACKLIST = 15_158_332;
export const COLOR_IC_BLACKLIST_CLOSED = 0x5a_8f_63;
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
      description: [
        `**Уведомляемая фракция:** ${input.faction}`,
        `**Уведомляемое лицо:** ${input.notifiedPerson}`,
        `**Номер документа:** ${input.docNumber}`,
        `**Краткое описание:** ${input.description}`,
        `**Ответственные:** ${input.leaderText}, ${input.deputyText}, ${input.notifiedPerson}.`,
      ].join("\n"),
      fields: [
        {
          name: "Ссылка на форум",
          value: spoilerLink(input.forumLink),
          inline: false,
        },
      ],
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
      description: [
        `**Личное дело:** ${normalizeLinkOrText(input.personalFile)}`,
        `**Видеофиксация:** ${normalizeLinkOrText(input.video)}`,
        `**Комментарий:** ${normalizeLinkOrText(input.comment)}`,
      ].join("\n"),
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
  const lines = [
    `Издал ордер: ${input.actorName}`,
    `Разыскиваемый: **${input.fio}**`,
    `Номер паспорта: **${input.passport}**`,
    `Номер ордера: **${input.orderNumber}**`,
    `Обвинения: **${input.article}**`,
    `Срок заключения: **${input.termText}**`,
  ];

  let description: string;
  if (closed) {
    const struck = lines.map((line) => `~~${line}~~`).join("\n");
    const status = [
      "",
      "",
      "**Статус:** Исполнено",
      `**Исполнение зарегистрировал:** ${input.closedBy ?? "—"}`,
      `**Доказательства:** ${normalizeLinkOrText(input.evidenceLink)}`,
    ].join("\n");
    description = struck + status;
  } else {
    description = lines.join("\n");
  }

  const fields: NonNullable<ClassicEmbed["fields"]> = [];
  if (input.forumLink && !closed) {
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
      description,
      ...(fields.length > 0 ? { fields } : {}),
      author: {
        name: `Автор: ${input.actorUsername}`,
        iconUrl: safeAvatarUrl(input.actorAvatarUrl),
      },
    },
    input.now,
  );
}

export function makeIcBlacklistEmbed(input: {
  actorUsername: string;
  actorAvatarUrl?: string | null;
  fio: string;
  passport: string;
  reason: string;
  forumLink: string;
  number: string;
  closed?: boolean;
  closeReason?: string | null;
  closedByUsername?: string | null;
  now?: Date;
}): ClassicEmbed {
  const closed = Boolean(input.closed);
  const evidence = normalizeLinkOrText(input.forumLink);
  const lines = [
    `**Имя Фамилия:** ${input.fio}`,
    `**Номер Паспорта:** ${input.passport}`,
    `**Причина:** ${input.reason}`,
    `**Доказательства:** ${evidence}`,
    `**Статус:** ${closed ? "Снят" : "Активен"}`,
    `**Номер:** ${input.number}`,
  ];
  if (closed) {
    lines.push(`**Причина снятия:** ${normalizeLinkOrText(input.closeReason)}`);
    if (input.closedByUsername) {
      lines.push(`**Снял:** ${input.closedByUsername}`);
    }
  }
  return withFooter(
    {
      title: closed
        ? "IC Черный Список снят Правительством штата"
        : "Новый IC Черный Список от Правительства штата",
      color: closed ? COLOR_IC_BLACKLIST_CLOSED : COLOR_IC_BLACKLIST,
      description: lines.join("\n"),
      author: {
        name: `Издал ордер: ${input.actorUsername}`,
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
      description: [
        `Исполнение зарегистрировал: **${discordIdentity(actor.displayName, actor.username)}**`,
        `Номер ордера: **${input.wantedNumber}**`,
        `Доказательства исполнения: ${normalizeLinkOrText(input.evidenceLink)}`,
      ].join("\n"),
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
      description: [
        `**Уведомляемая фракция:** ${input.faction}`,
        `**Номер штрафа:** ${input.fineNumber}`,
        `**ФИО:** ${input.fio}`,
        `**Паспорт:** ${input.passport}`,
        `**Статья:** ${input.article}`,
        `**Сумма штрафа:** ${formatMoney(input.amount)}`,
        `**Срок оплаты:** ${input.paymentDeadlineText}`,
      ].join("\n"),
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
      description: [
        `**Номер штрафа:** ${input.fineNumber}`,
        `**ФИО:** ${input.fio}`,
        `**Паспорт:** ${input.passport}`,
        `**Сумма:** ${formatMoney(input.amount)}`,
        `**Оплату зарегистрировал:** ${discordIdentity(actor.displayName, actor.username)}`,
      ].join("\n"),
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
      description: [
        `**Номер штрафа:** ${fine.fineNumber}`,
        `**Фракция:** ${fine.faction}`,
        `**ФИО:** ${fine.fio}`,
        `**Паспорт:** ${fine.passport}`,
        `**Статья:** ${fine.article}`,
        `**Сумма штрафа:** ${formatMoney(fine.amount)}`,
        `**Срок оплаты истёк:** ${fine.paymentDeadlineText}`,
        `**Штраф выписал:** ${fine.createdByDisplayName} (${fine.createdByUsername})`,
      ].join("\n"),
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
      description: [
        `**Пользователь:** ${input.memberMention}`,
        `**Discord:** ${discordIdentity(input.displayName, input.username)}`,
        `**User ID:** \`${input.userId}\``,
        "",
        input.details,
      ].join("\n"),
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
