/**
 * Bot job handlers: Discord delivery for Stage 3 modules.
 * Prefer channel send via bot; fall back to webhook URL from settings.
 * Unconfigured targets succeed as deferred (no infinite retries).
 */
import {
  MessageFlags,
  type Client,
  type TextChannel,
} from "discord.js";
import { prisma, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  PERSONNEL_AUDIT_META,
  checkDiscordLimits,
  discordIdentity,
  embedSpecSchema,
  formatPersonnelDetailsText,
  formatRoleMentions,
  getSetting,
  makeCompactAuditEmbed,
  makeDocumentEmbed,
  makeFineEmbed,
  makeFinePaidEmbed,
  makeResponseEmbed,
  makeWantedDoneEmbed,
  makeWantedEmbed,
  materializeEmbedSpecButtons,
  recordSentMessage,
  resolveDocumentResponseDelivery,
  resolveDocumentResponseLocalDelivery,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFactionPingRoleId,
  resolveWantedPingRoleIds,
  resolveFineDelivery,
  resolveFinePaidDelivery,
  resolveWantedDelivery,
  sameDeliveryChannel,
  setRegistrationReviewMessage,
  setTransferReviewMessage,
  type ClassicEmbed,
  type DeliveryTarget,
  type EmbedSpec,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";
import { classicToEmbed, embedSpecToMessageOptions } from "./embed-payload.js";
import {
  fetchReviewChannel,
  loadRegistration,
  loadTransfer,
  renderRegistrationReview,
  renderTransferReview,
} from "./stage4-review.js";
import type { JobHandler } from "./worker.js";

type EmbedSendResult =
  | { status: "sent"; messageId: string; channelId: string; guildId: string; spec: EmbedSpec }
  | { status: "deferred"; reason: string };

type SendEmbedOptions = {
  content?: string | null;
  /** Role snowflakes allowed to ping (parsed from content mentions). */
  mentionRoleIds?: readonly string[];
  /** User snowflakes allowed to ping (e.g. document author on /ответ). */
  mentionUserIds?: readonly string[];
};

/** Wrap a single classic embed as an EmbedSpec for sent-message persistence. */
function classicEmbedToSpec(embed: ClassicEmbed): EmbedSpec {
  return { version: 1, embeds: [embed] };
}

async function sendEmbed(
  client: Client,
  target: DeliveryTarget,
  classic: ClassicEmbed,
  log: Logger,
  options: SendEmbedOptions = {},
): Promise<EmbedSendResult> {
  if (target.kind === "unconfigured") {
    return { status: "deferred", reason: target.reason };
  }

  const content = options.content?.trim() || undefined;
  const mentionRoleIds = [...new Set(options.mentionRoleIds ?? [])].filter((id) =>
    /^\d{17,20}$/.test(id),
  );
  const mentionUserIds = [...new Set(options.mentionUserIds ?? [])].filter((id) =>
    /^\d{17,20}$/.test(id),
  );

  const embed = classicToEmbed(classic);
  const spec = classicEmbedToSpec(classic);

  if (target.kind === "channel") {
    const guild = await client.guilds.fetch(target.guildDiscordId);
    const channel = (await guild.channels.fetch(target.channelDiscordId)) as TextChannel | null;
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Канал ${target.channelDiscordId} недоступен`);
    }
    const message = await channel.send({
      ...(content ? { content } : {}),
      embeds: [embed],
      allowedMentions: { parse: [], roles: mentionRoleIds, users: mentionUserIds },
    });
    return {
      status: "sent",
      messageId: message.id,
      channelId: channel.id,
      guildId: guild.id,
      spec,
    };
  }

  const webhookUrl = new URL(target.webhookUrl);
  webhookUrl.searchParams.set("wait", "true");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed.toJSON()],
      allowed_mentions: { parse: [], roles: mentionRoleIds, users: mentionUserIds },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook failed: ${response.status} ${body}`);
  }
  const data = (await response.json()) as { id?: string; channel_id?: string };
  const messageId = data.id;
  const channelId = data.channel_id ?? target.channelDiscordId ?? "unknown";
  if (!messageId) {
    log.warn("webhook response missing message id");
    return {
      status: "sent",
      messageId: `webhook-${Date.now()}`,
      channelId,
      guildId: target.guildDiscordId ?? "unknown",
      spec,
    };
  }
  return {
    status: "sent",
    messageId,
    channelId,
    guildId: target.guildDiscordId ?? "unknown",
    spec,
  };
}

async function persistSend(
  result: Extract<EmbedSendResult, { status: "sent" }>,
  link: {
    documentId?: string;
    responseId?: string;
    wantedId?: string;
    fineId?: string;
    personnelId?: string;
  },
) {
  const sent = await recordSentMessage({
    guildDiscordId: result.guildId,
    channelDiscordId: result.channelId,
    messageDiscordId: result.messageId,
    spec: result.spec,
  });
  await prisma.sentMessageLink.create({
    data: {
      sentMessageId: sent.id,
      documentId: link.documentId ?? null,
      responseId: link.responseId ?? null,
      wantedId: link.wantedId ?? null,
      fineId: link.fineId ?? null,
      personnelId: link.personnelId ?? null,
    },
  });
  return sent;
}

async function findLinkedMessage(wantedId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { wantedId },
    include: { sentMessage: true },
    orderBy: { createdAt: "desc" },
  });
}

async function findLinkedFineMessage(fineId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { fineId },
    include: { sentMessage: true },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveAuthor(
  client: Client,
  discordId: string,
): Promise<{ displayName: string; username: string; avatarUrl: string }> {
  try {
    const user = await client.users.fetch(discordId);
    return {
      displayName: user.displayName || user.username,
      username: user.username,
      avatarUrl: user.displayAvatarURL({ size: 256 }),
    };
  } catch {
    return { displayName: discordId, username: discordId, avatarUrl: "" };
  }
}

const documentSend: JobHandler = async (payload, { client, log }) => {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const target = await resolveFactionDocumentDelivery(doc.factionCode);
  const actor = await resolveAuthor(client, doc.authorDiscordId);

  const classic = makeDocumentEmbed({
    actor,
    faction: doc.factionCode,
    docNumber: doc.number,
    description: doc.content,
    notifiedPerson: doc.notifiedPerson,
    forumLink: doc.forumLink,
    leaderText: doc.leaderText,
    deputyText: doc.deputyText,
  });

  const pingRoleId = await resolveFactionPingRoleId(doc.factionCode);
  const mention = pingRoleId ? formatRoleMentions([pingRoleId]) : "";
  const content = mention
    ? `Новый документ из правительства. ${mention} незамедлительно исполнить.`
    : "Новый документ из правительства.";

  const result = await sendEmbed(client, target, classic, log, {
    content,
    mentionRoleIds: pingRoleId ? [pingRoleId] : [],
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { documentId: doc.id });
  return { status: "sent", documentNumber: doc.number, messageId: result.messageId };
};

const documentResponseSend: JobHandler = async (payload, { client, log }) => {
  const responseId = String(payload.responseId ?? "");
  const sourceGuildDiscordId =
    typeof payload.sourceGuildDiscordId === "string" ? payload.sourceGuildDiscordId : null;
  const response = await prisma.documentResponse.findUnique({
    where: { id: responseId },
    include: { document: true },
  });
  if (!response) throw new Error(`Document response ${responseId} not found`);

  // Dual delivery (legacy): GOV documents + documents channel of the guild where /ответ ran.
  const govTarget = await resolveDocumentResponseDelivery();
  const localTarget = await resolveDocumentResponseLocalDelivery(sourceGuildDiscordId);
  const actor = await resolveAuthor(client, response.authorDiscordId);
  const authorId = response.document.authorDiscordId;
  const responderId = response.authorDiscordId;
  const docNumber = response.document.number;

  const classic = makeResponseEmbed({
    docNumber,
    actor,
    personalFile: response.personalFile,
    video: response.video,
    comment: response.content,
  });

  const govResult = await sendEmbed(client, govTarget, classic, log, {
    content: `<@${authorId}>`,
    mentionUserIds: [authorId],
  });
  if (govResult.status === "deferred" && localTarget.kind === "unconfigured") {
    return govResult;
  }
  if (govResult.status === "sent") {
    await persistSend(govResult, { responseId: response.id, documentId: response.documentId });
  }

  let localMessageId: string | null = null;
  const shouldSendLocal =
    localTarget.kind !== "unconfigured" && !sameDeliveryChannel(govTarget, localTarget);
  if (shouldSendLocal) {
    const localContent = [
      `Ответ на документ **${docNumber}**`,
      `Автор документа: <@${authorId}>`,
      `Ответил: <@${responderId}>`,
    ].join(" · ");
    const localResult = await sendEmbed(client, localTarget, classic, log, {
      content: localContent,
      mentionUserIds: [authorId, responderId],
    });
    if (localResult.status === "sent") {
      await persistSend(localResult, { responseId: response.id, documentId: response.documentId });
      localMessageId = localResult.messageId;
    } else if (govResult.status === "deferred") {
      return localResult;
    }
  }

  if (govResult.status === "deferred" && !localMessageId) {
    return govResult;
  }
  return {
    status: "sent",
    documentNumber: docNumber,
    messageId: govResult.status === "sent" ? govResult.messageId : localMessageId,
    localMessageId,
    govDeferred: govResult.status === "deferred" ? govResult.reason : null,
  };
};

const wantedPublish: JobHandler = async (payload, { client, log }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const target = await resolveWantedDelivery();
  // Ping every ЧП faction role except WN — not the legacy shared «Фракция» role.
  const pingRoleIds = await resolveWantedPingRoleIds();
  const content = formatRoleMentions(pingRoleIds);
  const actor = await resolveAuthor(client, wanted.issuedByDiscordId);

  const classic = makeWantedEmbed({
    actorName: actor.displayName,
    actorUsername: actor.username,
    actorAvatarUrl: actor.avatarUrl,
    fio: wanted.characterName,
    passport: wanted.staticId,
    orderNumber: wanted.number,
    article: wanted.reason,
    termText: wanted.termText,
    forumLink: wanted.forumLink,
  });

  const result = await sendEmbed(client, target, classic, log, {
    ...(content ? { content } : {}),
    mentionRoleIds: pingRoleIds,
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const wantedEditClosed: JobHandler = async (payload, { client, log }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const link = await findLinkedMessage(wanted.id);
  const issuer = await resolveAuthor(client, wanted.issuedByDiscordId);
  let closedBy = "—";
  let closer = issuer;
  if (wanted.closedByDiscordId) {
    closer = await resolveAuthor(client, wanted.closedByDiscordId);
    closedBy = discordIdentity(closer.displayName, closer.username);
  }

  const classic = makeWantedEmbed({
    actorName: issuer.displayName,
    actorUsername: issuer.username,
    actorAvatarUrl: issuer.avatarUrl,
    fio: wanted.characterName,
    passport: wanted.staticId,
    orderNumber: wanted.number,
    article: wanted.reason,
    termText: wanted.termText,
    forumLink: wanted.forumLink,
    closed: true,
    closedBy,
    evidenceLink: wanted.evidence ?? "",
  });
  const embed = classicToEmbed(classic);

  const doneEmbed = makeWantedDoneEmbed({
    actor: closer,
    wantedNumber: wanted.number,
    evidenceLink: wanted.evidence ?? "",
  });

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ content: "~~Федеральный розыск~~", embeds: [embed] });
        // Legacy also posts make_wanted_done_embed as a follow-up.
        const doneResult = await sendEmbed(
          client,
          {
            kind: "channel",
            guildDiscordId: guild.id,
            channelDiscordId: channel.id,
          },
          doneEmbed,
          log,
        );
        if (doneResult.status === "sent") {
          await persistSend(doneResult, { wantedId: wanted.id });
        }
        return {
          status: "edited",
          wantedNumber: wanted.number,
          messageId: message.id,
        };
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit wanted message; publishing new");
    }
  }

  const target = await resolveWantedDelivery();
  const result = await sendEmbed(client, target, classic, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  const doneResult = await sendEmbed(client, target, doneEmbed, log);
  if (doneResult.status === "sent") {
    await persistSend(doneResult, { wantedId: wanted.id });
  }
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const finePublish: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  // Legacy + product: /штраф goes only to the selected faction documents channel (like /пост), not ЧП.
  const target = await resolveFineDelivery(fine.factionCode);
  const actor = await resolveAuthor(client, fine.issuedByDiscordId);

  const classic = makeFineEmbed({
    actor,
    faction: fine.factionCode,
    fineNumber: fine.number,
    fio: fine.characterName,
    passport: fine.staticId,
    article: fine.reason,
    amount: fine.amount,
    paymentDeadlineText: fine.paymentDeadlineText,
  });

  const pingRoleId = await resolveFactionPingRoleId(fine.factionCode);
  const mention = pingRoleId ? formatRoleMentions([pingRoleId]) : "";
  const content = mention
    ? `Новый штраф из правительства. ${mention} требуется исполнение и контроль оплаты.`
    : "Новый штраф из правительства.";

  const result = await sendEmbed(client, target, classic, log, {
    content,
    mentionRoleIds: pingRoleId ? [pingRoleId] : [],
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const fineEditPaid: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  const link = await findLinkedFineMessage(fine.id);
  const actor = fine.paidByDiscordId
    ? await resolveAuthor(client, fine.paidByDiscordId)
    : { displayName: "—", username: "—", avatarUrl: "" };

  const classic = makeFinePaidEmbed({
    fineNumber: fine.number,
    fio: fine.characterName,
    passport: fine.staticId,
    amount: fine.amount,
    actor,
  });
  const embed = classicToEmbed(classic);

  // Best-effort: update the original faction fine message if we still have a link.
  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ embeds: [embed] });
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit fine message; continuing with GOV notice");
    }
  }

  // Paid notice → GOV documents channel (same place as /ответ), not ЧП.
  const target = await resolveFinePaidDelivery();
  const result = await sendEmbed(client, target, classic, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const personnelPublish: JobHandler = async (payload, { client, log }) => {
  const personnelEventId = String(payload.personnelEventId ?? "");
  const event = await prisma.personnelEvent.findUnique({ where: { id: personnelEventId } });
  if (!event) throw new Error(`Personnel event ${personnelEventId} not found`);

  const type = event.type as PersonnelEventType;
  const meta = PERSONNEL_AUDIT_META[type as keyof typeof PERSONNEL_AUDIT_META];
  if (!meta) {
    throw new Error(`Unknown personnel event type: ${event.type}`);
  }

  const actor = await resolveAuthor(client, event.actorDiscordId);
  const targetUser = await resolveAuthor(client, event.subjectDiscordId);
  const detailsText = formatPersonnelDetailsText(
    type as keyof typeof PERSONNEL_AUDIT_META,
    event.details,
  );

  const classic = makeCompactAuditEmbed({
    actionTitle: meta.actionTitle,
    actorDisplayName: actor.displayName,
    actorId: event.actorDiscordId,
    targetDisplayName: event.subjectName || targetUser.displayName,
    targetId: event.subjectDiscordId,
    actorLabel: meta.actorLabel,
    targetLabel: meta.targetLabel,
    detailsText,
    targetAvatarUrl: targetUser.avatarUrl,
  });

  const target = await resolveFactionPersonnelDelivery(event.factionCode);
  const result = await sendEmbed(client, target, classic, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { personnelId: event.id });
  return { status: "sent", personnelEventId: event.id, messageId: result.messageId };
};

const messageDesignSend: JobHandler = async (payload, { client, log }) => {
  const designId = String(payload.designId ?? "");
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const design = await prisma.messageDesign.findUnique({ where: { id: designId } });
  if (!design || design.status !== RecordStatus.ACTIVE) {
    throw new Error(`Design ${designId} not found`);
  }

  const parsed = embedSpecSchema.parse(design.spec);
  const violations = checkDiscordLimits(parsed);
  if (violations.length > 0) {
    throw new Error(violations.map((v) => v.message).join("; "));
  }
  const ready = await materializeEmbedSpecButtons(parsed);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${channelDiscordId} недоступен`);
  }

  const message = await channel.send(options);
  await recordSentMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
    designId: design.id,
    spec: ready,
  });
  log.info({ designId, messageId: message.id, channelId: channel.id }, "message design sent");
  return { status: "sent", messageId: message.id, channelId: channel.id };
};

const messageDesignResend: JobHandler = async (payload, { client, log }) => {
  const sentMessageId = String(payload.sentMessageId ?? "");
  const sent = await prisma.sentMessage.findUnique({ where: { id: sentMessageId } });
  if (!sent || sent.status !== RecordStatus.ACTIVE) {
    throw new Error(`Sent message ${sentMessageId} not found`);
  }

  const parsed = embedSpecSchema.parse(sent.spec);
  const ready = await materializeEmbedSpecButtons(parsed);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(sent.guildDiscordId);
  const channel = (await guild.channels.fetch(sent.channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${sent.channelDiscordId} недоступен`);
  }

  try {
    const existing = await channel.messages.fetch(sent.messageDiscordId);
    const editPayload: {
      content?: string | null;
      embeds?: typeof options.embeds;
      components?: typeof options.components;
      flags?: MessageFlags.IsComponentsV2;
    } = {
      content: options.content ?? null,
    };
    if (options.embeds) editPayload.embeds = options.embeds;
    if (options.components) editPayload.components = options.components;
    if (ready.version === 2) editPayload.flags = MessageFlags.IsComponentsV2;
    await existing.edit(editPayload);
    await recordSentMessage({
      guildDiscordId: guild.id,
      channelDiscordId: channel.id,
      messageDiscordId: existing.id,
      ...(sent.designId ? { designId: sent.designId } : {}),
      spec: ready,
    });
    log.info({ sentMessageId, messageId: existing.id }, "message design resent (edit)");
    return { status: "edited", messageId: existing.id };
  } catch {
    const message = await channel.send(options);
    await recordSentMessage({
      guildDiscordId: guild.id,
      channelDiscordId: channel.id,
      messageDiscordId: message.id,
      ...(sent.designId ? { designId: sent.designId } : {}),
      spec: ready,
    });
    log.info({ sentMessageId, messageId: message.id }, "message design resent (new)");
    return { status: "sent", messageId: message.id };
  }
};

const registrationReview: JobHandler = async (payload, { client }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  // Idempotent: a retry after a successful post must not post a second copy.
  if (registration.reviewMessageId) {
    return { status: "skipped", reason: "already posted", messageId: registration.reviewMessageId };
  }

  const incidentGuildId = await getSetting("core.incidentGuildId");
  const channelId = await getSetting("registrations.channelId");
  if (!incidentGuildId || !channelId) return { status: "deferred", reason: "Канал заявок ЧП не настроен." };

  const channel = await fetchReviewChannel(client, incidentGuildId, channelId);
  const message = await channel.send(renderRegistrationReview(registration));
  await setRegistrationReviewMessage(registrationId, {
    guildId: incidentGuildId,
    channelId: channel.id,
    messageId: message.id,
  });
  return { status: "sent", messageId: message.id, registrationId };
};

const transferReview: JobHandler = async (payload, { client }) => {
  const transferId = String(payload.transferId ?? "");
  const transfer = await loadTransfer(transferId);
  if (!transfer) throw new Error(`Transfer ${transferId} not found`);
  if (transfer.reviewMessageId) {
    return { status: "skipped", reason: "already posted", messageId: transfer.reviewMessageId };
  }
  const channelId = await getSetting("transfers.channelId");
  const guildId = await getSetting("core.incidentGuildId");
  if (!guildId || !channelId) return { status: "deferred", reason: "Канал переводов не настроен." };

  const channel = await fetchReviewChannel(client, guildId, channelId);
  const message = await channel.send(renderTransferReview(transfer));
  await setTransferReviewMessage(transferId, { guildId, channelId: channel.id, messageId: message.id });
  return { status: "sent", messageId: message.id, transferId };
};

export const jobHandlers = new Map<string, JobHandler>([
  [
    "system.ping",
    async (_payload, { client }) => ({
      pong: true,
      botUserId: client.user?.id ?? null,
      guilds: client.guilds.cache.size,
      at: new Date().toISOString(),
    }),
  ],
  [MODULE_JOB_TYPES.DOCUMENT_SEND, documentSend],
  [MODULE_JOB_TYPES.DOCUMENT_RESPONSE_SEND, documentResponseSend],
  [MODULE_JOB_TYPES.WANTED_PUBLISH, wantedPublish],
  [MODULE_JOB_TYPES.WANTED_EDIT_CLOSED, wantedEditClosed],
  [MODULE_JOB_TYPES.FINE_PUBLISH, finePublish],
  [MODULE_JOB_TYPES.FINE_EDIT_PAID, fineEditPaid],
  [MODULE_JOB_TYPES.PERSONNEL_PUBLISH, personnelPublish],
  [MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND, messageDesignSend],
  [MODULE_JOB_TYPES.MESSAGE_DESIGN_RESEND, messageDesignResend],
  [MODULE_JOB_TYPES.REGISTRATION_REVIEW, registrationReview],
  [MODULE_JOB_TYPES.TRANSFER_REVIEW, transferReview],
]);
