/**
 * Stage 4 review messages: one renderer for the delivery job, button clicks and modals,
 * so decisions append to the application instead of replacing it and buttons lock.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type MessageEditOptions,
  type TextChannel,
} from "discord.js";
import { prisma } from "@mirror/db";
import {
  mediaExtension,
  makeRegistrationReviewEmbed,
  makeTransferReviewEmbed,
  type RegistrationReviewButtons,
  type TransferReviewButtons,
} from "@mirror/core";
import { classicToEmbed } from "./embed-payload.js";

export type ReviewMessagePayload = Required<Pick<MessageEditOptions, "embeds" | "components">>;

export function loadRegistration(id: string) {
  return prisma.registration.findUnique({ where: { id } });
}

export function loadTransfer(id: string) {
  return prisma.transfer.findUnique({ where: { id }, include: { character: true } });
}

type LoadedRegistration = NonNullable<Awaited<ReturnType<typeof loadRegistration>>>;
type LoadedTransfer = NonNullable<Awaited<ReturnType<typeof loadTransfer>>>;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Name under which a media file is attached to the review message (`attachment://<name>` in embeds). */
export async function mediaAttachmentName(mediaFileId: string | undefined): Promise<string | null> {
  if (!mediaFileId) return null;
  const file = await prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
  return file ? `${file.id}.${mediaExtension(file.contentType)}` : null;
}

/** Re-render for edits: the photo stays attached to the original message, so the embed keeps referencing it. */
export async function buildRegistrationReview(registration: LoadedRegistration): Promise<ReviewMessagePayload> {
  const name = await mediaAttachmentName(registration.evidenceFileIds[0]);
  return renderRegistrationReview(registration, { imageUrl: name ? `attachment://${name}` : null });
}

export async function buildTransferReview(transfer: LoadedTransfer): Promise<ReviewMessagePayload> {
  const name = await mediaAttachmentName(transfer.documentFileIds[0]);
  return renderTransferReview(transfer, { imageUrl: name ? `attachment://${name}` : null });
}

export function renderRegistrationReview(
  registration: LoadedRegistration,
  options: { imageUrl?: string | null } = {},
): ReviewMessagePayload {
  const payload = jsonRecord(registration.payload);
  const embed = makeRegistrationReviewEmbed({
    kind: registration.kind,
    staticId: registration.staticId,
    applicantDiscordId: registration.applicantDiscordId,
    payload,
    decision: registration.decision,
    decidedByDiscordId: registration.decidedByDiscordId,
    rejectionReason: registration.rejectionReason,
    expiresAt: registration.expiresAt,
    expired: registration.status === "EXPIRED",
    imageUrl: options.imageUrl ?? null,
  });
  const buttons = jsonRecord(registration.reviewButtons) as Partial<RegistrationReviewButtons>;
  const pending = registration.decision === "PENDING" && registration.status === "ACTIVE";
  const components =
    pending && buttons.approve && buttons.reject
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(buttons.approve).setLabel("Одобрить").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(buttons.reject).setLabel("Отказать").setStyle(ButtonStyle.Danger),
          ),
        ]
      : [];
  return { embeds: [classicToEmbed(embed)], components };
}

export function renderTransferReview(
  transfer: LoadedTransfer,
  options: { imageUrl?: string | null } = {},
): ReviewMessagePayload {
  const embed = makeTransferReviewEmbed({
    characterName: transfer.character.name,
    staticId: transfer.character.staticId,
    applicantDiscordId: transfer.createdByDiscordId,
    fromFactionCode: transfer.fromFactionCode,
    toFactionCode: transfer.toFactionCode,
    fromRank: transfer.fromRank,
    toRank: transfer.toRank,
    documents: transfer.documentFileIds,
    sourceDecision: transfer.sourceDecision,
    targetDecision: transfer.targetDecision,
    sourceDecidedByDiscordId: transfer.sourceDecidedByDiscordId,
    targetDecidedByDiscordId: transfer.targetDecidedByDiscordId,
    status: transfer.status,
    rejectionReason: transfer.rejectionReason,
    imageUrl: options.imageUrl ?? null,
  });
  const buttons = jsonRecord(transfer.reviewButtons) as Partial<TransferReviewButtons>;
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (
    transfer.status === "PENDING" &&
    buttons.sourceApprove &&
    buttons.sourceReject &&
    buttons.targetApprove &&
    buttons.targetReject
  ) {
    const sourceDone = transfer.sourceDecision !== "PENDING";
    const targetDone = transfer.targetDecision !== "PENDING";
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buttons.sourceApprove)
          .setLabel(`${transfer.fromFactionCode}: одобрить`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(sourceDone),
        new ButtonBuilder()
          .setCustomId(buttons.sourceReject)
          .setLabel(`${transfer.fromFactionCode}: отказать`)
          .setStyle(ButtonStyle.Danger)
          .setDisabled(sourceDone),
        new ButtonBuilder()
          .setCustomId(buttons.targetApprove)
          .setLabel(`${transfer.toFactionCode}: одобрить`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(targetDone),
        new ButtonBuilder()
          .setCustomId(buttons.targetReject)
          .setLabel(`${transfer.toFactionCode}: отказать`)
          .setStyle(ButtonStyle.Danger)
          .setDisabled(targetDone),
      ),
    );
  }
  return { embeds: [classicToEmbed(embed)], components };
}

export async function fetchReviewChannel(client: Client, guildId: string, channelId: string) {
  const guild = await client.guilds.fetch(guildId);
  const channel = (await guild.channels.fetch(channelId)) as TextChannel | null;
  if (!channel?.isTextBased()) throw new Error(`Канал ${channelId} недоступен`);
  return channel;
}

/** Edits a stored review message (used when the decision did not come from the message itself). */
export async function editStoredReviewMessage(
  client: Client,
  location: { reviewGuildId: string | null; reviewChannelId: string | null; reviewMessageId: string | null },
  payload: ReviewMessagePayload,
): Promise<boolean> {
  if (!location.reviewGuildId || !location.reviewChannelId || !location.reviewMessageId) return false;
  const channel = await fetchReviewChannel(client, location.reviewGuildId, location.reviewChannelId);
  const message = await channel.messages.fetch(location.reviewMessageId);
  await message.edit(payload);
  return true;
}
