/**
 * The message with a form answer in the delivery channel. When the form asks for a decision the
 * message carries «Одобрить / Отказать»; once the decision is made it shows who decided and loses
 * the buttons. One renderer for the first post and for the edit, so the two cannot drift apart.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { DecisionStatus, RecordStatus, prisma } from "@mirror/db";
import { FORM_DECISION_LABELS_RU, formatFormValue, type ClassicEmbed } from "@mirror/core";

export async function loadFormSubmission(id: string) {
  return prisma.formSubmission.findUnique({
    where: { id },
    include: { form: { include: { fields: { orderBy: { position: "asc" } } } } },
  });
}

export type LoadedFormSubmission = NonNullable<Awaited<ReturnType<typeof loadFormSubmission>>>;

const DECISION_COLOR: Record<DecisionStatus, number> = {
  PENDING: 0x5865f2,
  APPROVED: 0x57f287,
  REJECTED: 0xed4245,
};

function moscow(date: Date): string {
  return `${date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })} МСК`;
}

function decisionText(submission: LoadedFormSubmission): string | null {
  if (!submission.decision) return null;
  if (submission.decision === DecisionStatus.PENDING) return FORM_DECISION_LABELS_RU.PENDING;
  const head = [
    FORM_DECISION_LABELS_RU[submission.decision],
    submission.decidedByDiscordId ? `<@${submission.decidedByDiscordId}>` : null,
    submission.decidedAt ? moscow(submission.decidedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return submission.rejectionReason ? `${head}\nПричина: ${submission.rejectionReason}`.slice(0, 1024) : head;
}

export function formSubmissionEmbed(submission: LoadedFormSubmission): ClassicEmbed {
  const { form } = submission;
  const values = (submission.values ?? {}) as Record<string, unknown>;
  // Archived fields are shown only when this (older) answer actually has a value for them.
  const fields = form.fields
    .filter((field) => field.status === RecordStatus.ACTIVE || field.key in values)
    .map((field) => ({
      name: field.label.slice(0, 256),
      value: formatFormValue(values[field.key]).slice(0, 1024),
      inline: false,
    }));
  const decision = decisionText(submission);
  return {
    type: "embed",
    title: `Ответ: ${form.name}`.slice(0, 256),
    description: form.description?.slice(0, 4096) || undefined,
    color: submission.decision ? DECISION_COLOR[submission.decision] : 0x5865f2,
    fields: [
      {
        name: "Автор",
        value: submission.authorDiscordId
          ? `<@${submission.authorDiscordId}> (${submission.authorDiscordId})`
          : submission.source === "web"
            ? "с сайта, без входа"
            : "аноним",
        inline: true,
      },
      { name: "ID ответа", value: submission.id, inline: true },
      ...(decision ? [{ name: "Решение", value: decision, inline: false }] : []),
      // Discord allows 25 fields in an embed.
      ...fields.slice(0, decision ? 22 : 23),
    ],
    timestamp: true,
  };
}

/** «Одобрить / Отказать» while the answer waits; nothing once it is decided. */
export function formSubmissionButtons(submission: LoadedFormSubmission): ActionRowBuilder<ButtonBuilder>[] {
  if (submission.decision !== DecisionStatus.PENDING) return [];
  const buttons = (submission.reviewButtons ?? {}) as { approve?: unknown; reject?: unknown };
  if (typeof buttons.approve !== "string" || typeof buttons.reject !== "string") return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buttons.approve).setLabel("Одобрить").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buttons.reject).setLabel("Отказать").setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** What the author reads in direct messages; the form's own texts replace the standard ones. */
export function formDecisionDm(submission: LoadedFormSubmission): string | null {
  const { form } = submission;
  if (submission.decision === DecisionStatus.APPROVED) {
    return form.approvedDmText?.trim() || `Ваш ответ на форму «${form.name}» одобрен.`;
  }
  if (submission.decision === DecisionStatus.REJECTED) {
    const text = form.rejectedDmText?.trim() || `По вашему ответу на форму «${form.name}» — отказ.`;
    return submission.rejectionReason ? `${text}\n**Причина:** ${submission.rejectionReason}` : text;
  }
  return null;
}
