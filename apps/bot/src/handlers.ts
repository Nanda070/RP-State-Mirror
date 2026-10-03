/**
 * Bot job handlers: Discord delivery for Stage 3 modules.
 * Prefer channel send via bot; fall back to webhook URL from settings.
 * Unconfigured targets succeed as deferred (no infinite retries).
 */
import {
  EmbedBuilder,
  MessageFlags,
  type Client,
  type ColorResolvable,
  type TextChannel,
} from "discord.js";
import { prisma, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  PERSONNEL_EVENT_LABELS_RU,
  checkDiscordLimits,
  deliveryConfigured,
  embedSpecSchema,
  formatRoleMentions,
  getSetting,
  materializeEmbedSpecButtons,
  normalizeLinkOrText,
  spoilerLink,
  recordSentMessage,
  resolveDocumentResponseDelivery,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFactionSeniorRoleId,
  resolveFineDelivery,
  resolveWantedDelivery,
  type DeliveryTarget,
  type EmbedSpec,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";
import { embedSpecToMessageOptions } from "./embed-payload.js";
import type { JobHandler } from "./worker.js";

/** Legacy embeds.py COLOR_DEFAULT / COLOR_RESPONSE */
const COLOR_DOC = 0x89_89_a8;
const COLOR_DOC_RESPONSE = 0x8b_6f_47;
const COLOR_WANTED = 0xef_44_44;
const COLOR_WANTED_CLOSED = 0x22_c5_5e;
const COLOR_FINE = 0xf5_9e_0b;
const COLOR_FINE_PAID = 0x22_c5_5e;
const COLOR_PERSONNEL = 0xa8_55_f7;

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

async function sendEmbed(
  client: Client,
  target: DeliveryTarget,
  embed: EmbedBuilder,
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

  const embedJson = embed.toJSON();
  const spec: EmbedSpec = {
    version: 1,
    embeds: [
      {
        type: "embed",
        title: embedJson.title ?? undefined,
        description: embedJson.description ?? undefined,
        color: typeof embedJson.color === "number" ? embedJson.color : undefined,
        fields: embedJson.fields?.map((f) => ({
          name: f.name,
          value: f.value,
          inline: f.inline,
        })),
        timestamp: Boolean(embedJson.timestamp),
      },
    ],
  };

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

async function resolveAuthorNames(
  client: Client,
  discordId: string,
): Promise<{ displayName: string; username: string }> {
  try {
    const user = await client.users.fetch(discordId);
    return { displayName: user.displayName || user.username, username: user.username };
  } catch {
    return { displayName: discordId, username: discordId };
  }
}

const documentSend: JobHandler = async (payload, { client, log }) => {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const target = await resolveFactionDocumentDelivery(doc.factionCode);
  const { displayName, username } = await resolveAuthorNames(client, doc.authorDiscordId);

  // Match legacy make_document_embed (описание → content; subject is truncated for registry).
  const description = [
    `**Уведомляемая фракция:** ${doc.factionCode}`,
    `**Уведомляемое лицо:** ${doc.notifiedPerson}`,
    `**Номер документа:** ${doc.number}`,
    `**Краткое описание:** ${doc.content}`,
    `**Ответственные:** ${doc.leaderText}, ${doc.deputyText}, ${doc.notifiedPerson}.`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLOR_DOC as ColorResolvable)
    .setTitle(`Новый документ от ${displayName}`.slice(0, 256))
    .setDescription(description.slice(0, 4096))
    .addFields({
      name: "Ссылка на форум",
      value: spoilerLink(doc.forumLink.slice(0, 1000)),
      inline: false,
    })
    .setAuthor({ name: `Автор: ${username}`.slice(0, 256) })
    .setTimestamp(doc.createdAt);

  const seniorRoleId = await resolveFactionSeniorRoleId(doc.factionCode);
  const mention = seniorRoleId ? formatRoleMentions([seniorRoleId]) : "";
  const content = mention
    ? `Новый документ из правительства. ${mention} незамедлительно исполнить.`
    : "Новый документ из правительства.";

  const result = await sendEmbed(client, target, embed, log, {
    content,
    mentionRoleIds: seniorRoleId ? [seniorRoleId] : [],
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { documentId: doc.id });
  return { status: "sent", documentNumber: doc.number, messageId: result.messageId };
};

const documentResponseSend: JobHandler = async (payload, { client, log }) => {
  const responseId = String(payload.responseId ?? "");
  const response = await prisma.documentResponse.findUnique({
    where: { id: responseId },
    include: { document: true },
  });
  if (!response) throw new Error(`Document response ${responseId} not found`);

  // Legacy RESPONSE_WEBHOOK → GOV documents channel (not the target faction).
  const target = await resolveDocumentResponseDelivery();
  const { username } = await resolveAuthorNames(client, response.authorDiscordId);
  const authorId = response.document.authorDiscordId;

  // Match legacy make_response_embed; content pings original /пост author.
  const description = [
    `**Личное дело:** ${normalizeLinkOrText(response.personalFile)}`,
    `**Видеофиксация:** ${normalizeLinkOrText(response.video)}`,
    `**Комментарий:** ${normalizeLinkOrText(response.content)}`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLOR_DOC_RESPONSE as ColorResolvable)
    .setTitle(`Ответ на Документ ${response.document.number}`)
    .setDescription(description.slice(0, 4096))
    .setAuthor({ name: `Автор ответа: ${username}`.slice(0, 256) })
    .setTimestamp(response.createdAt);

  const result = await sendEmbed(client, target, embed, log, {
    content: `<@${authorId}>`,
    mentionUserIds: [authorId],
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { responseId: response.id, documentId: response.documentId });
  return { status: "sent", documentNumber: response.document.number, messageId: result.messageId };
};

function wantedDescriptionLines(wanted: {
  issuedByDiscordId: string;
  characterName: string;
  staticId: string;
  number: string;
  reason: string;
  termText: string;
}): string[] {
  return [
    `Издал ордер: <@${wanted.issuedByDiscordId}>`,
    `Разыскиваемый: **${wanted.characterName}**`,
    `Номер паспорта: **${wanted.staticId}**`,
    `Номер ордера: **${wanted.number}**`,
    `Обвинения: **${wanted.reason}**`,
    `Срок заключения: **${wanted.termText}**`,
  ];
}

const wantedPublish: JobHandler = async (payload, { client, log }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const target = await resolveWantedDelivery();
  const pingRoleIds = await getSetting("wanted.pingRoleIds");
  const content = formatRoleMentions(pingRoleIds);

  const embed = new EmbedBuilder()
    .setColor(COLOR_WANTED as ColorResolvable)
    .setTitle("Новый ордер от правительства штата")
    .setDescription(wantedDescriptionLines(wanted).join("\n").slice(0, 4096))
    .addFields({
      name: "Ссылка на форум",
      value: `||${wanted.forumLink.slice(0, 1000)}||`,
      inline: false,
    })
    .setTimestamp(wanted.createdAt);

  const result = await sendEmbed(client, target, embed, log, {
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
  const struck = wantedDescriptionLines(wanted)
    .map((line) => `~~${line}~~`)
    .join("\n");
  const statusBlock = [
    "",
    "**Статус:** Исполнено",
    `**Исполнение зарегистрировал:** ${
      wanted.closedByDiscordId ? `<@${wanted.closedByDiscordId}>` : "—"
    }`,
    `**Доказательства:** ${normalizeLinkOrText(wanted.evidence ?? "")}`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLOR_WANTED_CLOSED as ColorResolvable)
    .setTitle("Исполненный ордер правительства штата")
    .setDescription((struck + statusBlock).slice(0, 4096))
    .setTimestamp(new Date());

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ embeds: [embed] });
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
  const result = await sendEmbed(client, target, embed, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const finePublish: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  const target = await resolveFineDelivery();
  const pingRoleIds = await getSetting("fines.pingRoleIds");
  const description = [
    `**Уведомляемая фракция:** ${fine.factionCode}`,
    `**Номер штрафа:** ${fine.number}`,
    `**ФИО:** ${fine.characterName}`,
    `**Паспорт:** ${fine.staticId}`,
    `**Статья:** ${fine.reason}`,
    `**Сумма штрафа:** ${fine.amount.toLocaleString("ru-RU")} ₽`,
    `**Срок оплаты:** ${fine.paymentDeadlineText}`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLOR_FINE as ColorResolvable)
    .setTitle("Новый штраф")
    .setDescription(description.slice(0, 4096))
    .setAuthor({ name: `Автор: <@${fine.issuedByDiscordId}>`.slice(0, 256) })
    .setTimestamp(fine.createdAt);

  const chpContent = formatRoleMentions(pingRoleIds);
  const result = await sendEmbed(client, target, embed, log, {
    ...(chpContent ? { content: chpContent } : {}),
    mentionRoleIds: pingRoleIds,
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });

  // Legacy: fine went to the faction webhook with leader_role_id.
  // Mirror keeps the registry on ЧП and additionally notifies faction senior staff
  // when documents delivery + seniorRoleId are configured.
  const seniorRoleId = await resolveFactionSeniorRoleId(fine.factionCode);
  const factionTarget = await resolveFactionDocumentDelivery(fine.factionCode);
  if (seniorRoleId && deliveryConfigured(factionTarget)) {
    const mention = formatRoleMentions([seniorRoleId]);
    const factionContent = `Новый штраф из правительства. ${mention} требуется исполнение и контроль оплаты.`;
    try {
      const factionResult = await sendEmbed(client, factionTarget, embed, log, {
        content: factionContent,
        mentionRoleIds: [seniorRoleId],
      });
      if (factionResult.status === "sent") {
        await persistSend(factionResult, { fineId: fine.id });
      }
    } catch (error) {
      log.warn({ err: error, fineId: fine.id }, "faction fine notice failed; ЧП publish kept");
    }
  }

  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const fineEditPaid: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  const link = await findLinkedFineMessage(fine.id);
  const description = [
    `**Номер штрафа:** ${fine.number}`,
    `**ФИО:** ${fine.characterName}`,
    `**Паспорт:** ${fine.staticId}`,
    `**Сумма:** ${fine.amount.toLocaleString("ru-RU")} ₽`,
    `**Оплату зарегистрировал:** ${
      fine.paidByDiscordId ? `<@${fine.paidByDiscordId}>` : "—"
    }`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLOR_FINE_PAID as ColorResolvable)
    .setTitle("Штраф оплачен")
    .setDescription(description.slice(0, 4096))
    .setTimestamp(fine.paidAt ?? new Date());

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ embeds: [embed] });
        return { status: "edited", fineNumber: fine.number, messageId: message.id };
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit fine message; publishing new");
    }
  }

  const target = await resolveFineDelivery();
  const result = await sendEmbed(client, target, embed, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const personnelPublish: JobHandler = async (payload, { client, log }) => {
  const personnelEventId = String(payload.personnelEventId ?? "");
  const event = await prisma.personnelEvent.findUnique({ where: { id: personnelEventId } });
  if (!event) throw new Error(`Personnel event ${personnelEventId} not found`);

  const type = event.type as PersonnelEventType;
  const label = PERSONNEL_EVENT_LABELS_RU[type] ?? event.type;
  const detailsText =
    typeof event.details === "object" && event.details !== null
      ? JSON.stringify(event.details, null, 2).slice(0, 1024)
      : String(event.details ?? "—");

  const target = await resolveFactionPersonnelDelivery(event.factionCode);
  const embed = new EmbedBuilder()
    .setColor(COLOR_PERSONNEL as ColorResolvable)
    .setTitle(`Кадровый аудит — ${label}`)
    .addFields(
      { name: "Сотрудник", value: `${event.subjectName} (<@${event.subjectDiscordId}>)` },
      { name: "Фракция", value: event.factionCode, inline: true },
      { name: "Оформил", value: `<@${event.actorDiscordId}>`, inline: true },
      { name: "Детали", value: detailsText || "—" },
    )
    .setTimestamp(event.createdAt);

  const result = await sendEmbed(client, target, embed, log);
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
]);
