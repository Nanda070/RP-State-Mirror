/**
 * Bot job handlers: Discord delivery for Stage 3 modules.
 * Prefer channel send via bot; fall back to webhook URL from settings.
 * Unconfigured targets succeed as deferred (no infinite retries).
 */
import {
  MessageFlags,
  ThreadAutoArchiveDuration,
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
  makeIcBlacklistEmbed,
  makeWantedDoneEmbed,
  makeWantedEmbed,
  materializeEmbedSpecButtons,
  recordSentMessage,
  resolveDocumentResponseDelivery,
  resolveDocumentResponseLocalDelivery,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFactionPingRoleId,
  resolveIcBlacklistDelivery,
  resolveWantedPingRoleIds,
  resolveFineDelivery,
  resolveFinePaidDelivery,
  resolveWantedDelivery,
  sameDeliveryChannel,
  readMediaFile,
  registrationKindLabel,
  resolveFactionLeaderRoleIds,
  setRegistrationReviewThread,
  setRegistrationReviewMessage,
  setTransferReviewMessage,
  toJsonValue,
  type ClassicEmbed,
  type DeliveryTarget,
  type EmbedSpec,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";
import { classicToEmbed, embedSpecToMessageOptions } from "./embed-payload.js";
import {
  buildRegistrationReview,
  editStoredReviewMessage,
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
    icBlacklistId?: string;
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
      icBlacklistId: link.icBlacklistId ?? null,
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

async function findLinkedIcBlacklistMessage(entryId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { icBlacklistId: entryId },
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

const icBlacklistPublish: JobHandler = async (payload, { client, log }) => {
  const entryId = String(payload.entryId ?? "");
  const entry = await prisma.icBlacklistEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error(`IC blacklist ${entryId} not found`);

  const target = await resolveIcBlacklistDelivery();
  const actor = await resolveAuthor(client, entry.createdByDiscordId);
  const classic = makeIcBlacklistEmbed({
    actorUsername: actor.username,
    actorAvatarUrl: actor.avatarUrl,
    fio: entry.fullName,
    passport: entry.staticId,
    reason: entry.reason,
    forumLink: entry.forumLink,
    number: entry.number,
  });
  const result = await sendEmbed(client, target, classic, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { icBlacklistId: entry.id });
  return { status: "sent", number: entry.number, messageId: result.messageId };
};

const icBlacklistEditClosed: JobHandler = async (payload, { client, log }) => {
  const entryId = String(payload.entryId ?? "");
  const entry = await prisma.icBlacklistEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error(`IC blacklist ${entryId} not found`);

  const link = await findLinkedIcBlacklistMessage(entry.id);
  const issuer = await resolveAuthor(client, entry.createdByDiscordId);
  let closedByUsername: string | null = null;
  if (entry.closedByDiscordId) {
    const closer = await resolveAuthor(client, entry.closedByDiscordId);
    closedByUsername = closer.username;
  }

  const classic = makeIcBlacklistEmbed({
    actorUsername: issuer.username,
    actorAvatarUrl: issuer.avatarUrl,
    fio: entry.fullName,
    passport: entry.staticId,
    reason: entry.reason,
    forumLink: entry.forumLink,
    number: entry.number,
    closed: true,
    closeReason: entry.closeReason,
    closedByUsername,
  });
  const embed = classicToEmbed(classic);

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ content: "~~IC Черный Список~~", embeds: [embed] });
        return { status: "edited", number: entry.number, messageId: message.id };
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit ic blacklist message; publishing new");
    }
  }

  const target = await resolveIcBlacklistDelivery();
  const result = await sendEmbed(client, target, classic, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { icBlacklistId: entry.id });
  return { status: "sent", number: entry.number, messageId: result.messageId };
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

const registrationReview: JobHandler = async (payload, { client, log }) => {
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
  const photo = registration.evidenceFileIds[0] ? await readMediaFile(registration.evidenceFileIds[0]) : null;
  const pingRoleIds = await getSetting("registrations.coordinatorRoleIds");
  const message = await channel.send({
    ...renderRegistrationReview(registration, {
      imageUrl: photo ? `attachment://${photo.attachmentName}` : null,
    }),
    ...(pingRoleIds.length > 0 ? { content: formatRoleMentions(pingRoleIds) } : {}),
    allowedMentions: { parse: [], roles: [...pingRoleIds] },
    files: photo ? [{ attachment: photo.body, name: photo.attachmentName }] : [],
  });
  await setRegistrationReviewMessage(registrationId, {
    guildId: incidentGuildId,
    channelId: channel.id,
    messageId: message.id,
  });

  let threadId: string | null = null;
  try {
    const plate = registration.plate ? ` · ${registration.plate}` : "";
    const thread = await message.startThread({
      name: `${registration.kind === "VEHICLE" ? "ТС" : "Униформа"} · ${registration.character.staticId}${plate}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    threadId = thread.id;
    await setRegistrationReviewThread(registrationId, thread.id);
  } catch (error) {
    log.warn({ err: error, registrationId }, "registration thread was not created (Create Public Threads permission?)");
  }
  return { status: "sent", messageId: message.id, threadId, registrationId };
};

async function sendDirectMessage(client: Client, discordId: string, content: string, log: Logger): Promise<boolean> {
  try {
    const user = await client.users.fetch(discordId);
    await user.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    log.info({ err: error, discordId }, "direct message not delivered (DMs closed?)");
    return false;
  }
}

async function postToThread(client: Client, threadId: string | null, content: string, log: Logger) {
  if (!threadId) return false;
  try {
    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) return false;
    if (thread.archived) await thread.setArchived(false);
    await thread.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    log.warn({ err: error, threadId }, "failed to post to review thread");
    return false;
  }
}

const registrationDecided: JobHandler = async (payload, { client, log }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  const what = `регистрацию ${registrationKindLabel(registration.kind)}${registration.plate ? ` (${registration.plate})` : ""}`;
  const who = `персонаж ${registration.character.name}, статик ${registration.character.staticId}`;
  if (registration.decision === "REJECTED") {
    const thread = await postToThread(
      client,
      registration.reviewThreadId,
      `**Отказ.** Решение принял: <@${registration.decidedByDiscordId}>\n**Причина:** ${registration.rejectionReason ?? "—"}`,
      log,
    );
    const dm = await sendDirectMessage(
      client,
      registration.character.user.discordId,
      `Ваша заявка на ${what} (${who}) отклонена.\n**Причина:** ${registration.rejectionReason ?? "—"}`,
      log,
    );
    return { status: "sent", decision: "REJECTED", thread, dm };
  }
  if (registration.decision === "APPROVED") {
    const until = registration.expiresAt?.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) ?? "—";
    const thread = await postToThread(
      client,
      registration.reviewThreadId,
      `**Одобрено.** Решение принял: <@${registration.decidedByDiscordId}>. Действует до ${until}.`,
      log,
    );
    const dm = await sendDirectMessage(
      client,
      registration.character.user.discordId,
      `Ваша заявка на ${what} (${who}) одобрена. Регистрация действует до ${until}.`,
      log,
    );
    return { status: "sent", decision: "APPROVED", thread, dm };
  }
  return { status: "skipped", reason: "pending" };
};

const registrationExpired: JobHandler = async (payload, { client, log }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  let edited = false;
  try {
    edited = await editStoredReviewMessage(client, registration, await buildRegistrationReview(registration));
  } catch (error) {
    log.warn({ err: error, registrationId }, "failed to edit expired registration card");
  }
  const dm = await sendDirectMessage(
    client,
    registration.character.user.discordId,
    `Срок регистрации ${registrationKindLabel(registration.kind)}${registration.plate ? ` (${registration.plate})` : ""} для персонажа ${registration.character.name} истёк. При необходимости подайте заявку заново.`,
    log,
  );
  return { status: "sent", edited, dm };
};

const transferReview: JobHandler = async (payload, { client, log }) => {
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
  const photo = transfer.documentFileIds[0] ? await readMediaFile(transfer.documentFileIds[0]) : null;
  const leaderRoles = [
    ...(await resolveFactionLeaderRoleIds(transfer.fromFactionCode)),
    ...(await resolveFactionLeaderRoleIds(transfer.toFactionCode)),
  ];
  const pingRoleIds = [...new Set(leaderRoles)];
  const message = await channel.send({
    ...renderTransferReview(transfer, {
      imageUrl: photo ? `attachment://${photo.attachmentName}` : null,
    }),
    ...(pingRoleIds.length > 0 ? { content: formatRoleMentions(pingRoleIds) } : {}),
    allowedMentions: { parse: [], roles: pingRoleIds },
    files: photo ? [{ attachment: photo.body, name: photo.attachmentName }] : [],
  });
  await setTransferReviewMessage(transferId, { guildId, channelId: channel.id, messageId: message.id });
  if (pingRoleIds.length === 0) {
    log.warn({ transferId }, "transfer review posted without leader role pings");
  }
  return { status: "sent", messageId: message.id, transferId, pinged: pingRoleIds.length };
};

const transferDecided: JobHandler = async (payload, { client, log }) => {
  const transferId = String(payload.transferId ?? "");
  const transfer = await loadTransfer(transferId);
  if (!transfer) throw new Error(`Transfer ${transferId} not found`);
  if (transfer.status === "REJECTED") {
    const dm = await sendDirectMessage(
      client,
      transfer.createdByDiscordId,
      `Заявка на перевод **${transfer.fromFactionCode} → ${transfer.toFactionCode}** (статик ${transfer.character.staticId}) отклонена.\n**Причина:** ${transfer.rejectionReason ?? "—"}`,
      log,
    );
    return { status: "sent", decision: "REJECTED", dm };
  }
  if (transfer.status === "APPROVED") {
    const text = await getSetting("transfers.approvalDmText");
    const dm = await sendDirectMessage(
      client,
      transfer.createdByDiscordId,
      `${text}\n\nПеревод: **${transfer.fromFactionCode} → ${transfer.toFactionCode}**, персонаж ${transfer.character.name} (${transfer.character.staticId}).`,
      log,
    );
    return { status: "sent", decision: "APPROVED", dm };
  }
  return { status: "skipped", reason: "pending" };
};

const rolePanelPublish: JobHandler = async (payload, { client, log }) => {
  const panelId = String(payload.rolePanelId ?? "");
  const panel = await prisma.rolePanel.findUnique({ where: { id: panelId } });
  if (!panel || panel.status !== RecordStatus.ACTIVE) {
    return { status: "skipped", reason: "panel not found or not active" };
  }
  const spec = embedSpecSchema.parse(panel.spec);
  const materializedSpec = await materializeEmbedSpecButtons(spec);

  const channel = await client.channels.fetch(panel.channelDiscordId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Канал ${panel.channelDiscordId} не найден или недоступен`);
  }

  const messageOptions = embedSpecToMessageOptions(materializedSpec);
  let message = null;
  if (panel.messageDiscordId && "messages" in channel) {
    const existing = await channel.messages.fetch(panel.messageDiscordId).catch(() => null);
    if (existing) {
      message = await existing.edit(messageOptions as Parameters<typeof existing.edit>[0]);
    }
  }
  if (!message) {
    message = await channel.send(messageOptions);
  }

  await prisma.rolePanel.update({
    where: { id: panel.id },
    data: {
      messageDiscordId: message.id,
      spec: toJsonValue(materializedSpec),
    },
  });

  await recordSentMessage({
    guildDiscordId: panel.guildDiscordId,
    channelDiscordId: panel.channelDiscordId,
    messageDiscordId: message.id,
    spec: materializedSpec,
  });

  log.info({ panelId: panel.id, messageId: message.id }, "role panel published");
  return { status: "sent", panelId: panel.id, messageId: message.id };
};

const rolePanelArchive: JobHandler = async (payload, { client, log }) => {
  const panelId = String(payload.rolePanelId ?? "");
  const panel = await prisma.rolePanel.findUnique({ where: { id: panelId } });
  if (!panel || !panel.messageDiscordId) {
    return { status: "skipped", reason: "panel not found or message not published" };
  }
  try {
    const channel = await client.channels.fetch(panel.channelDiscordId).catch(() => null);
    if (channel && channel.isTextBased() && "messages" in channel) {
      const message = await channel.messages.fetch(panel.messageDiscordId).catch(() => null);
      if (message) {
        await message.edit({ components: [] });
      }
    }
    log.info({ panelId }, "role panel archived and components removed");
    return { status: "archived", panelId };
  } catch (error) {
    log.warn({ err: error, panelId }, "failed to clean up archived role panel message");
    return { status: "deferred", reason: String(error) };
  }
};

const feedbackTicketNotify: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return { status: "skipped", reason: "ticket not found" };

  const notifyChannelId = await getSetting("feedback.notifyChannelId");
  if (!notifyChannelId || typeof notifyChannelId !== "string") {
    return { status: "deferred", reason: "feedback.notifyChannelId is not configured" };
  }

  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Канал обратной связи ${notifyChannelId} недоступен`);
  }

  const initialContent = ticket.messages[0]?.content ?? "—";
  const embed: ClassicEmbed = {
    type: "embed",
    title: `Новое обращение: ${ticket.category}`,
    description: initialContent,
    color: 0x5865f2,
    fields: [
      { name: "Автор", value: `<@${ticket.authorDiscordId}> (${ticket.authorDiscordId})`, inline: true },
      { name: "Статус", value: ticket.status, inline: true },
      { name: "ID тикета", value: ticket.id, inline: true },
    ],
    timestamp: true,
  };

  const message = await channel.send({ embeds: [classicToEmbed(embed)] });
  log.info({ ticketId, messageId: message.id }, "feedback ticket notification sent");
  return { status: "sent", ticketId, messageId: message.id };
};

const feedbackReplySend: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const messageId = String(payload.messageId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({ where: { id: ticketId } });
  const message = await prisma.feedbackMessage.findUnique({ where: { id: messageId } });
  if (!ticket || !message) return { status: "skipped", reason: "ticket or message not found" };

  const dm = await sendDirectMessage(
    client,
    ticket.authorDiscordId,
    `Вам поступил ответ по обращению **«${ticket.category}»**:\n\n${message.content}`,
    log,
  );
  log.info({ ticketId, dm }, "feedback reply DM delivered");
  return { status: "sent", dm, ticketId };
};

const feedbackClosedSend: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { status: "skipped", reason: "ticket not found" };

  const dm = await sendDirectMessage(
    client,
    ticket.authorDiscordId,
    `Ваше обращение **«${ticket.category}»** было закрыто администрацией.`,
    log,
  );
  log.info({ ticketId, dm }, "feedback closed DM delivered");
  return { status: "sent", dm, ticketId };
};

const formSubmissionDeliver: JobHandler = async (payload, { client, log }) => {
  const submissionId = String(payload.submissionId ?? "");
  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { form: { include: { fields: { orderBy: { position: "asc" } } } } },
  });
  if (!submission) return { status: "skipped", reason: "submission not found" };

  const form = submission.form;
  if (!form.webhookUrl && !form.deliveryChannelId) {
    return { status: "skipped", reason: "no delivery target" };
  }

  const values = (submission.values ?? {}) as Record<string, unknown>;
  const fields = form.fields.map((field) => ({
    name: field.label.slice(0, 256),
    value: String(values[field.key] ?? "—").slice(0, 1024) || "—",
    inline: false,
  }));
  const classic: ClassicEmbed = {
    type: "embed",
    title: `Ответ: ${form.name}`.slice(0, 256),
    description: form.description?.slice(0, 4096) || undefined,
    color: 0x5865f2,
    fields: [
      {
        name: "Автор",
        value: submission.authorDiscordId
          ? `<@${submission.authorDiscordId}> (${submission.authorDiscordId})`
          : "аноним",
        inline: true,
      },
      { name: "ID ответа", value: submission.id, inline: true },
      ...fields.slice(0, 23),
    ],
    timestamp: true,
  };

  const results: Array<{ via: string; status: string; messageId?: string | undefined }> = [];

  if (form.deliveryChannelId) {
    const channel = await client.channels.fetch(form.deliveryChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error(`Канал доставки формы ${form.deliveryChannelId} недоступен`);
    }
    const message = await channel.send({ embeds: [classicToEmbed(classic)] });
    results.push({ via: "channel", status: "sent", messageId: message.id });
  }

  if (form.webhookUrl) {
    const target: DeliveryTarget = {
      kind: "webhook",
      webhookUrl: form.webhookUrl,
      channelDiscordId: form.deliveryChannelId,
      guildDiscordId: null,
    };
    const sent = await sendEmbed(client, target, classic, log);
    results.push({
      via: "webhook",
      status: sent.status,
      ...(sent.status === "sent" ? { messageId: sent.messageId } : {}),
    });
    if (sent.status === "deferred") {
      return { status: "deferred", reason: sent.reason, results };
    }
  }

  log.info({ submissionId, results }, "form submission delivered");
  return { status: "sent", submissionId, results };
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
  [MODULE_JOB_TYPES.REGISTRATION_DECIDED, registrationDecided],
  [MODULE_JOB_TYPES.REGISTRATION_EXPIRED, registrationExpired],
  [MODULE_JOB_TYPES.TRANSFER_REVIEW, transferReview],
  [MODULE_JOB_TYPES.TRANSFER_DECIDED, transferDecided],
  [MODULE_JOB_TYPES.ROLE_PANEL_PUBLISH, rolePanelPublish],
  [MODULE_JOB_TYPES.ROLE_PANEL_ARCHIVE, rolePanelArchive],
  [MODULE_JOB_TYPES.FEEDBACK_TICKET_NOTIFY, feedbackTicketNotify],
  [MODULE_JOB_TYPES.FEEDBACK_REPLY_SEND, feedbackReplySend],
  [MODULE_JOB_TYPES.FEEDBACK_CLOSED_SEND, feedbackClosedSend],
  [MODULE_JOB_TYPES.FORM_SUBMISSION_DELIVER, formSubmissionDeliver],
  [MODULE_JOB_TYPES.IC_BLACKLIST_PUBLISH, icBlacklistPublish],
  [MODULE_JOB_TYPES.IC_BLACKLIST_EDIT_CLOSED, icBlacklistEditClosed],
]);

