/**
 * Legacy-style embeds for Stage 4 review messages (registrations, transfers).
 * Rendered from DB state, so re-rendering after a decision keeps the original
 * application text and appends the decision instead of overwriting it.
 */
import type { ClassicEmbed } from "./embeds.js";
import { BOT_FOOTER_ICON, COLOR_DEFAULT, COLOR_ERROR, COLOR_SUCCESS, footerText } from "./legacy-embeds.js";

export const COLOR_EXPIRED = 0x6e_6b_73;

type Decision = "PENDING" | "APPROVED" | "REJECTED";

export const DECISION_LABELS_RU: Record<Decision, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрено",
  REJECTED: "Отказано",
};

function mention(discordId: string | null | undefined): string {
  return discordId ? `<@${discordId}>` : "—";
}

function str(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || "—";
}

function withFooter(embed: Omit<ClassicEmbed, "type" | "footer">, now?: Date): ClassicEmbed {
  return { type: "embed", ...embed, footer: { text: footerText(now), iconUrl: BOT_FOOTER_ICON } };
}

export type RegistrationReviewInput = {
  kind: "VEHICLE" | "UNIFORM";
  characterName: string;
  staticId: string;
  applicantDiscordId: string | null;
  payload: Record<string, unknown>;
  decision: Decision;
  decidedByDiscordId: string | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  expired?: boolean;
  imageUrl?: string | null;
  now?: Date;
};

export function registrationKindLabel(kind: "VEHICLE" | "UNIFORM"): string {
  return kind === "VEHICLE" ? "ТС" : "униформы";
}

function registrationDataLines(input: RegistrationReviewInput): string[] {
  if (input.kind === "VEHICLE") {
    return [`**Модель:** ${str(input.payload.model)}`, `**Госномер:** ${str(input.payload.plate)}`];
  }
  return [`**Описание:** ${str(input.payload.description)}`];
}

/** Full application card (pending or rejected); approved/expired use the short card. */
export function makeRegistrationReviewEmbed(input: RegistrationReviewInput): ClassicEmbed {
  if (input.decision === "APPROVED") return makeRegistrationCardEmbed(input);
  const lines = [
    `**Персонаж:** ${input.characterName}`,
    `**Статик:** ${input.staticId}`,
    `**Заявитель:** ${mention(input.applicantDiscordId)}`,
    ...registrationDataLines(input),
    "",
    `**Статус:** ${DECISION_LABELS_RU[input.decision]}`,
  ];
  if (input.decision === "REJECTED") {
    lines.push(`**Решение принял:** ${mention(input.decidedByDiscordId)}`);
    lines.push(`**Причина отказа:** ${str(input.rejectionReason)}`);
  }
  return withFooter(
    {
      title: `Заявка на регистрацию ${registrationKindLabel(input.kind)}`,
      color: input.decision === "REJECTED" ? COLOR_ERROR : COLOR_DEFAULT,
      description: lines.join("\n"),
      ...(input.imageUrl ? { image: input.imageUrl } : {}),
    },
    input.now,
  );
}

/** Short card after approval (§4.5 step 5); also used for expiry edits. */
export function makeRegistrationCardEmbed(input: RegistrationReviewInput): ClassicEmbed {
  const expired = Boolean(input.expired);
  const lines = [
    `**Персонаж:** ${input.characterName} (${input.staticId})`,
    ...registrationDataLines(input),
    `**Одобрил:** ${mention(input.decidedByDiscordId)}`,
    expired
      ? "**Статус:** Неактуальна (истёк срок)"
      : `**Действует до:** ${input.expiresAt ? input.expiresAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "—"}`,
  ];
  return withFooter(
    {
      title: expired
        ? `Регистрация ${registrationKindLabel(input.kind)} истекла`
        : `Регистрация ${registrationKindLabel(input.kind)} одобрена`,
      color: expired ? COLOR_EXPIRED : COLOR_SUCCESS,
      description: lines.join("\n"),
      ...(input.imageUrl && !expired ? { thumbnail: input.imageUrl } : {}),
    },
    input.now,
  );
}

export type TransferReviewInput = {
  characterName: string;
  staticId: string;
  applicantDiscordId: string;
  fromFactionCode: string;
  toFactionCode: string;
  fromRank: number;
  toRank: number;
  documents: string[];
  sourceDecision: Decision;
  targetDecision: Decision;
  sourceDecidedByDiscordId: string | null;
  targetDecidedByDiscordId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CLOSED";
  rejectionReason: string | null;
  imageUrl?: string | null;
  now?: Date;
};

export function makeTransferReviewEmbed(input: TransferReviewInput): ClassicEmbed {
  const sideLine = (label: string, decision: Decision, actor: string | null) =>
    `**${label}:** ${DECISION_LABELS_RU[decision]}${decision === "PENDING" ? "" : ` (${mention(actor)})`}`;
  const lines = [
    `**Персонаж:** ${input.characterName}`,
    `**Статик:** ${input.staticId}`,
    `**Заявитель:** ${mention(input.applicantDiscordId)}`,
    `**Из:** ${input.fromFactionCode} · ранг ${input.fromRank}`,
    `**В:** ${input.toFactionCode} · ранг ${input.toRank}`,
    `**Документы:** ${input.documents.length > 0 ? input.documents.join(", ") : "—"}`,
    "",
    sideLine(`Решение ${input.fromFactionCode}`, input.sourceDecision, input.sourceDecidedByDiscordId),
    sideLine(`Решение ${input.toFactionCode}`, input.targetDecision, input.targetDecidedByDiscordId),
  ];
  if (input.status === "REJECTED") lines.push(`**Причина отказа:** ${str(input.rejectionReason)}`);
  const statusLabel =
    input.status === "APPROVED" ? "Одобрено" : input.status === "REJECTED" ? "Отказано" : input.status === "CLOSED" ? "Закрыто" : "На рассмотрении";
  lines.push(`**Статус:** ${statusLabel}`);
  return withFooter(
    {
      title: "Заявка на перевод между фракциями",
      color: input.status === "APPROVED" ? COLOR_SUCCESS : input.status === "REJECTED" ? COLOR_ERROR : COLOR_DEFAULT,
      description: lines.join("\n"),
      ...(input.imageUrl ? { image: input.imageUrl } : {}),
    },
    input.now,
  );
}
