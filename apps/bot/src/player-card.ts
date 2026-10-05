/**
 * `/профиль` and the «Досье» item of a member's context menu: one card, built in the core from
 * the same data as the profile page of the dashboard. Both answers are visible to the caller only.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { AuditActorType } from "@mirror/db";
import {
  buildPlayerCard,
  formatUserError,
  getDossierAccess,
  resolveIdentity,
  writeAuditEvent,
  type Logger,
  type PlayerCard,
} from "@mirror/core";

export const DOSSIER_COMMAND_NAME = "Досье";

export interface PlayerCardContext {
  superAdminUserIds: readonly string[];
  /** Dashboard address for the «open in the dashboard» link (`PUBLIC_BASE_URL`). */
  publicBaseUrl: string;
  log: Logger;
}

function cardEmbed(title: string, card: PlayerCard): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff6a1a)
    .setTitle(title)
    .setDescription(`<@${card.discordId}> · \`${card.discordId}\`\n${card.faction}`)
    .addFields(card.fields);
}

function memberRoleIds(interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction): string[] {
  if (!interaction.member || typeof interaction.member === "string") return [];
  return Array.isArray(interaction.member.roles)
    ? interaction.member.roles
    : [...interaction.member.roles.cache.keys()];
}

async function fail(
  interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction,
  error: unknown,
  log: Logger,
) {
  const message = formatUserError(error);
  log.warn({ err: error, command: interaction.commandName }, "player card failed");
  if (/Unknown interaction|already been acknowledged/i.test(message)) return;
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(`Ошибка: ${message}`);
    else await interaction.reply({ content: `Ошибка: ${message}`, flags: MessageFlags.Ephemeral });
  } catch {
    // Interaction token expired or already closed — nothing useful left to send.
  }
}

export async function handleProfileCommand(interaction: ChatInputCommandInteraction, ctx: PlayerCardContext) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const identity = await resolveIdentity(interaction.user.id, { superAdminUserIds: ctx.superAdminUserIds });
    // One's own IC blacklist record is shown on the profile page as well.
    const card = await buildPlayerCard(identity, { showBlacklist: true });
    await interaction.editReply({
      embeds: [cardEmbed("Профиль", card)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("Открыть в дашборде")
            .setURL(`${ctx.publicBaseUrl}/profile`),
        ),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await fail(interaction, error, ctx.log);
  }
}

export async function handleDossierCommand(interaction: UserContextMenuCommandInteraction, ctx: PlayerCardContext) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const viewer = await resolveIdentity(interaction.user.id, { superAdminUserIds: ctx.superAdminUserIds });
    const access = await getDossierAccess(viewer, memberRoleIds(interaction));
    if (!access.allowed) {
      await interaction.editReply("Досье доступно администраторам и ролям, которым разрешён поиск нашивок.");
      return;
    }
    const target = interaction.targetUser;
    if (target.bot) {
      await interaction.editReply("У бота досье нет.");
      return;
    }
    const identity = await resolveIdentity(target.id, { superAdminUserIds: ctx.superAdminUserIds });
    const card = await buildPlayerCard(identity, { showBlacklist: access.showBlacklist });
    await writeAuditEvent({
      actorType: AuditActorType.USER,
      source: "bot.context",
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      channelId: interaction.channelId,
      action: "dossier.viewed",
      entityType: "user",
      entityId: target.id,
      metadata: { discordUserId: interaction.user.id, command: DOSSIER_COMMAND_NAME },
    });
    const name = interaction.targetMember && "displayName" in interaction.targetMember
      ? interaction.targetMember.displayName
      : (target.globalName ?? target.username);
    await interaction.editReply({
      embeds: [cardEmbed(`Досье · ${name}`.slice(0, 256), card)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await fail(interaction, error, ctx.log);
  }
}
