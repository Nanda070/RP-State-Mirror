/**
 * Bot job handlers: Discord delivery for Stage 3 modules.
 * Prefer channel send via bot; fall back to webhook URL from settings.
 * Unconfigured targets succeed as deferred (no infinite retries).
 */
import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type TextChannel,
} from "discord.js";
import { prisma, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  PERSONNEL_EVENT_LABELS_RU,
  recordSentMessage,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFineDelivery,
  resolveWantedDelivery,
  type DeliveryTarget,
  type EmbedSpec,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";
import type { JobHandler } from "./worker.js";

const COLOR_DOC = 0x3b_82_f6;
const COLOR_WANTED = 0xef_44_44;
const COLOR_WANTED_CLOSED = 0x22_c5_5e;
const COLOR_FINE = 0xf5_9e_0b;
const COLOR_FINE_PAID = 0x22_c5_5e;
const COLOR_PERSONNEL = 0xa8_55_f7;

type EmbedSendResult =
  | { status: "sent"; messageId: string; channelId: string; guildId: string; spec: EmbedSpec }
  | { status: "deferred"; reason: string };

async function sendEmbed(
  client: Client,
  target: DeliveryTarget,
  embed: EmbedBuilder,
  log: Logger,
): Promise<EmbedSendResult> {
  if (target.kind === "unconfigured") {
    return { status: "deferred", reason: target.reason };
  }

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
    const message = await channel.send({ embeds: [embed] });
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
    body: JSON.stringify({ embeds: [embed.toJSON()] }),
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

const documentSend: JobHandler = async (payload, { client, log }) => {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const target = await resolveFactionDocumentDelivery(doc.factionCode);
  const embed = new EmbedBuilder()
    .setColor(COLOR_DOC as ColorResolvable)
    .setTitle(`Документ ${doc.number}`)
    .setDescription(doc.content.slice(0, 4096))
    .addFields(
      { name: "Тема", value: doc.subject.slice(0, 1024) },
      { name: "Фракция", value: doc.factionCode, inline: true },
      { name: "Автор", value: `<@${doc.authorDiscordId}>`, inline: true },
    )
    .setTimestamp(doc.createdAt);

  const result = await sendEmbed(client, target, embed, log);
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

  const target = await resolveFactionDocumentDelivery(response.document.factionCode);
  const embed = new EmbedBuilder()
    .setColor(COLOR_DOC as ColorResolvable)
    .setTitle(`Ответ на ${response.document.number}`)
    .setDescription(response.content.slice(0, 4096))
    .addFields(
      { name: "Документ", value: response.document.number, inline: true },
      { name: "Автор ответа", value: `<@${response.authorDiscordId}>`, inline: true },
    )
    .setTimestamp(response.createdAt);

  const result = await sendEmbed(client, target, embed, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { responseId: response.id, documentId: response.documentId });
  return { status: "sent", documentNumber: response.document.number, messageId: result.messageId };
};

const wantedPublish: JobHandler = async (payload, { client, log }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const target = await resolveWantedDelivery();
  const embed = new EmbedBuilder()
    .setColor(COLOR_WANTED as ColorResolvable)
    .setTitle(`Розыск ${wanted.number}`)
    .setDescription(wanted.reason.slice(0, 4096))
    .addFields(
      { name: "Статик", value: wanted.staticId, inline: true },
      { name: "ФИО", value: wanted.characterName.slice(0, 1024), inline: true },
      { name: "Объявил", value: `<@${wanted.issuedByDiscordId}>`, inline: true },
    )
    .setTimestamp(wanted.createdAt);

  const result = await sendEmbed(client, target, embed, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const wantedEditClosed: JobHandler = async (payload, { client, log }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const link = await findLinkedMessage(wanted.id);
  const embed = new EmbedBuilder()
    .setColor(COLOR_WANTED_CLOSED as ColorResolvable)
    .setTitle(`Розыск ${wanted.number} — исполнено`)
    .setDescription(wanted.reason.slice(0, 2000))
    .addFields(
      { name: "Статик", value: wanted.staticId, inline: true },
      { name: "ФИО", value: wanted.characterName.slice(0, 1024), inline: true },
      {
        name: "Доказательства",
        value: (wanted.evidence ?? "—").slice(0, 1024),
      },
      {
        name: "Закрыл",
        value: wanted.closedByDiscordId ? `<@${wanted.closedByDiscordId}>` : "—",
        inline: true,
      },
    )
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
  const embed = new EmbedBuilder()
    .setColor(COLOR_FINE as ColorResolvable)
    .setTitle(`Штраф ${fine.number}`)
    .setDescription(fine.reason.slice(0, 4096))
    .addFields(
      { name: "Статик", value: fine.staticId, inline: true },
      { name: "ФИО", value: fine.characterName.slice(0, 1024), inline: true },
      { name: "Сумма", value: `${fine.amount.toLocaleString("ru-RU")} ₽`, inline: true },
      { name: "Фракция", value: fine.factionCode, inline: true },
      { name: "Выдал", value: `<@${fine.issuedByDiscordId}>`, inline: true },
    )
    .setTimestamp(fine.createdAt);

  const result = await sendEmbed(client, target, embed, log);
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const fineEditPaid: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  const link = await findLinkedFineMessage(fine.id);
  const embed = new EmbedBuilder()
    .setColor(COLOR_FINE_PAID as ColorResolvable)
    .setTitle(`Штраф ${fine.number} — оплачен`)
    .setDescription(fine.reason.slice(0, 2000))
    .addFields(
      { name: "Статик", value: fine.staticId, inline: true },
      { name: "Сумма", value: `${fine.amount.toLocaleString("ru-RU")} ₽`, inline: true },
      {
        name: "Отметил оплату",
        value: fine.paidByDiscordId ? `<@${fine.paidByDiscordId}>` : "—",
        inline: true,
      },
    )
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
]);
