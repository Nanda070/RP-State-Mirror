/**
 * «Вызов адвоката» in Discord: the call message with «Принять вызов / Отменить», the window the
 * panel button opens, and the thread under the call. Checks and the record live in core
 * (`lawyer-calls.ts`); here is what people see.
 *
 * The buttons carry the call itself (`mirror:lawyer.accept:<callId>`), so they keep working after
 * a restart without stored state. The bot posts the call right away, not through the job queue:
 * the person waits for an answer.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
} from "discord.js";
import { LawyerCallStatus, type LawyerCall } from "@mirror/db";
import {
  LAWYER_CALL_PLACES,
  UserError,
  acceptLawyerCall,
  cancelLawyerCall,
  createLawyerCall,
  getLawyerRoleIds,
  lawyerCallPlaceLabel,
  setLawyerCallMessage,
  type AuditContext,
  type Logger,
} from "@mirror/core";

export const LAWYER_CALL_THREAD_TEXT = "Ветка создана для связи между Адвокатом и Сотрудником";

const STATUS_COLOR: Record<LawyerCallStatus, number> = {
  PENDING: 0xfaa61a,
  ACCEPTED: 0x57f287,
  CANCELLED: 0x747f8d,
};

function moscow(date: Date): string {
  return `${date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })} МСК`;
}

function roleMentions(roleIds: readonly string[]): string {
  return roleIds.map((id) => `<@&${id}>`).join(" ");
}

function statusLine(call: LawyerCall): string {
  if (call.status === LawyerCallStatus.ACCEPTED) {
    return `Принял: <@${call.acceptedByDiscordId}>${call.acceptedAt ? ` · ${moscow(call.acceptedAt)}` : ""}`;
  }
  if (call.status === LawyerCallStatus.CANCELLED) {
    return `Вызов отменён${call.cancelledAt ? ` · ${moscow(call.cancelledAt)}` : ""}`;
  }
  return "Ожидает адвоката";
}

export function lawyerCallEmbed(call: LawyerCall, lawyerRoleIds: readonly string[]): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(STATUS_COLOR[call.status])
    .setTitle("Вызов адвоката")
    .addFields(
      { name: "Место", value: lawyerCallPlaceLabel(call.place), inline: true },
      { name: "Время вызова", value: moscow(call.createdAt), inline: true },
      ...(lawyerRoleIds.length > 0 ? [{ name: "Адвокат", value: roleMentions(lawyerRoleIds), inline: true }] : []),
      { name: "Вызвал", value: `<@${call.callerDiscordId}>`, inline: true },
      { name: "ФИО", value: call.callerName.slice(0, 1024), inline: true },
      { name: "Статус", value: statusLine(call), inline: false },
    )
    .setTimestamp(call.createdAt);
}

/** «Принять вызов» blocks once the call is taken or cancelled; «Отменить» shows only while it waits. */
export function lawyerCallButtons(call: LawyerCall): ActionRowBuilder<ButtonBuilder>[] {
  const pending = call.status === LawyerCallStatus.PENDING;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mirror:lawyer.accept:${call.id}`)
      .setLabel("Принять вызов")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!pending),
  );
  if (pending) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`mirror:lawyer.cancel:${call.id}`).setLabel("Отменить").setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

/** The window behind the panel button: one list, the place. */
export function lawyerCallModal(customId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Вызов адвоката")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Место")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("place")
            .setPlaceholder("Куда вызвать адвоката")
            .setRequired(true)
            .addOptions(LAWYER_CALL_PLACES.map((place) => ({ label: place.label, value: place.value }))),
        ),
    );
}

export function lawyerCallPlaceFromModal(interaction: ModalSubmitInteraction): string {
  return interaction.fields.getStringSelectValues("place")[0] ?? "";
}

/** The call itself: record, message with the ping, thread under it. Same for the command and the window. */
export async function startLawyerCall(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  place: string,
  context: AuditContext,
  log: Logger,
) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = interaction.channel;
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new UserError("Вызов адвоката делается в текстовом канале сервера ЧП, не в ветке и не в ЛС.");
  }
  const callerName =
    (interaction.inCachedGuild() ? interaction.member.displayName : null) ??
    interaction.user.globalName ??
    interaction.user.username;

  const call = await createLawyerCall(
    {
      callerDiscordId: interaction.user.id,
      callerName,
      guildDiscordId: interaction.guildId,
      channelDiscordId: channel.id,
      place,
    },
    context,
  );
  const lawyerRoleIds = await getLawyerRoleIds();

  let message;
  try {
    message = await channel.send({
      content: `${roleMentions(lawyerRoleIds)} — вызов адвоката: ${lawyerCallPlaceLabel(call.place)}.`,
      embeds: [lawyerCallEmbed(call, lawyerRoleIds)],
      components: lawyerCallButtons(call),
      allowedMentions: { parse: [], roles: lawyerRoleIds },
    });
  } catch (error) {
    log.warn({ err: error, callId: call.id, channelId: channel.id }, "lawyer call: cannot post");
    // Nobody saw the call: close it, so it does not wait for a lawyer forever.
    await cancelLawyerCall(call.id, interaction.user.id, context).catch(() => undefined);
    throw new UserError("Бот не может писать в этот канал. Сообщите администрации.");
  }

  const thread = await message
    .startThread({
      name: `${lawyerCallPlaceLabel(call.place)} · ${callerName}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    })
    .catch((error: unknown) => {
      log.warn({ err: error, callId: call.id }, "lawyer call: cannot open the thread");
      return null;
    });
  if (thread) {
    await thread.send({ content: LAWYER_CALL_THREAD_TEXT, allowedMentions: { parse: [] } }).catch(() => undefined);
    await thread.members.add(interaction.user.id).catch(() => undefined);
  }
  await setLawyerCallMessage(call.id, { messageDiscordId: message.id, threadDiscordId: thread?.id ?? null });

  await interaction.editReply({
    content: thread ? `Вызов отправлен: ${message.url}` : `Вызов отправлен: ${message.url}\nВетку создать не удалось — нет прав.`,
  });
  log.info({ callId: call.id, place: call.place, messageId: message.id }, "lawyer call posted");
}

async function fetchThread(client: Client, threadId: string | null) {
  if (!threadId) return null;
  const channel = await client.channels.fetch(threadId).catch(() => null);
  return channel?.isThread() ? channel : null;
}

function interactionRoleIds(interaction: ButtonInteraction): string[] {
  if (!interaction.member) return [];
  return Array.isArray(interaction.member.roles) ? interaction.member.roles : [...interaction.member.roles.cache.keys()];
}

/** «Принять вызов»: the message shows who took it and when, the thread greets both sides. */
export async function handleLawyerAccept(
  interaction: ButtonInteraction,
  callId: string,
  context: AuditContext,
  log: Logger,
) {
  await interaction.deferUpdate();
  const call = await acceptLawyerCall(callId, { discordId: interaction.user.id, roleIds: interactionRoleIds(interaction) }, context);
  await interaction.editReply({ embeds: [lawyerCallEmbed(call, await getLawyerRoleIds())], components: lawyerCallButtons(call) });

  const thread = await fetchThread(interaction.client, call.threadDiscordId);
  if (thread) {
    await thread.members.add(interaction.user.id).catch(() => undefined);
    await thread
      .send({
        content: `<@${interaction.user.id}> принял вызов. <@${call.callerDiscordId}>, ожидайте адвоката.`,
        allowedMentions: { parse: [], users: [interaction.user.id, call.callerDiscordId] },
      })
      .catch((error: unknown) => log.warn({ err: error, callId }, "lawyer call: cannot write to the thread"));
  }
  await interaction
    .followUp({ content: thread ? `Вы приняли вызов. Связь — в ветке ${thread.toString()}.` : "Вы приняли вызов.", flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
  log.info({ callId, lawyer: interaction.user.id }, "lawyer call accepted");
}

/** «Отменить»: the caller withdraws the call while nobody has taken it; the thread is closed. */
export async function handleLawyerCancel(
  interaction: ButtonInteraction,
  callId: string,
  context: AuditContext,
  log: Logger,
) {
  await interaction.deferUpdate();
  const call = await cancelLawyerCall(callId, interaction.user.id, context);
  await interaction.editReply({ embeds: [lawyerCallEmbed(call, await getLawyerRoleIds())], components: lawyerCallButtons(call) });

  const thread = await fetchThread(interaction.client, call.threadDiscordId);
  if (thread) {
    await thread.send({ content: "Вызов отменён.", allowedMentions: { parse: [] } }).catch(() => undefined);
    await thread.setArchived(true, "Вызов адвоката отменён").catch(() => undefined);
  }
  await interaction.followUp({ content: "Вызов отменён.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
  log.info({ callId }, "lawyer call cancelled");
}
