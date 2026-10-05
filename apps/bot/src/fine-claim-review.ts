/**
 * «Я оплатил»: the button a fined person presses, and the message with their report that the
 * staff confirms or declines. One renderer for the first post and for the edit after the decision.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { DecisionStatus } from "@mirror/db";
import { formatMoney, type getFinePaymentClaim } from "@mirror/core";

/** The button carries the fine itself, so it works under any message of the bot without stored state. */
export function finePaidButton(fineId: string, label = "Я оплатил"): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`mirror:fine.claim:${fineId}`).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Success);
}

export function finePaidRow(fineId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(finePaidButton(fineId));
}

export type LoadedFineClaim = NonNullable<Awaited<ReturnType<typeof getFinePaymentClaim>>>;

const DECISION_COLOR: Record<DecisionStatus, number> = {
  PENDING: 0xfaa61a,
  APPROVED: 0x57f287,
  REJECTED: 0xed4245,
};

function moscow(date: Date): string {
  return `${date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })} МСК`;
}

function decisionLine(claim: LoadedFineClaim): string {
  if (claim.decision === DecisionStatus.PENDING) return "Ждёт подтверждения";
  const head = [
    claim.decision === DecisionStatus.APPROVED ? "Оплата подтверждена" : "Отклонено",
    claim.decidedByDiscordId ? `<@${claim.decidedByDiscordId}>` : null,
    claim.decidedAt ? moscow(claim.decidedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return claim.rejectionReason ? `${head}\nПричина: ${claim.rejectionReason}`.slice(0, 1024) : head;
}

/** `imageName`: the first screenshot as attached to the message (`attachment://<name>`). */
export function fineClaimEmbed(claim: LoadedFineClaim, imageName: string | null): EmbedBuilder {
  const { fine } = claim;
  const embed = new EmbedBuilder()
    .setColor(DECISION_COLOR[claim.decision])
    .setTitle(`Оплата штрафа ${fine.number}`)
    .addFields(
      { name: "Гражданин", value: `${fine.characterName} · паспорт \`${fine.staticId}\``, inline: true },
      { name: "Сумма", value: formatMoney(fine.amount), inline: true },
      { name: "Сообщил", value: `<@${claim.claimantDiscordId}> (${claim.claimantDiscordId})`, inline: false },
      ...(claim.comment ? [{ name: "Комментарий", value: claim.comment.slice(0, 1024), inline: false }] : []),
      { name: "Решение", value: decisionLine(claim), inline: false },
    )
    .setTimestamp(claim.createdAt);
  if (imageName) embed.setImage(`attachment://${imageName}`);
  return embed;
}

/** «Подтвердить оплату / Отклонить» while the report waits; nothing once it is decided. */
export function fineClaimButtons(claim: LoadedFineClaim): ActionRowBuilder<ButtonBuilder>[] {
  if (claim.decision !== DecisionStatus.PENDING) return [];
  const buttons = (claim.reviewButtons ?? {}) as { approve?: unknown; reject?: unknown };
  if (typeof buttons.approve !== "string" || typeof buttons.reject !== "string") return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buttons.approve).setLabel("Подтвердить оплату").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buttons.reject).setLabel("Отклонить").setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** What the reporter reads in direct messages once the staff has decided. */
export function fineClaimDm(claim: LoadedFineClaim): string | null {
  if (claim.decision === DecisionStatus.APPROVED) return `Оплата штрафа **${claim.fine.number}** подтверждена.`;
  if (claim.decision === DecisionStatus.REJECTED) {
    return [
      `Сообщение об оплате штрафа **${claim.fine.number}** отклонено.`,
      claim.rejectionReason ? `**Причина:** ${claim.rejectionReason}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return null;
}
