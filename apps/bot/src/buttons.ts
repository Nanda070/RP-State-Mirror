/**
 * Persistent button engine: custom_id = mirror:<action>:<id>.
 */
import {
  MessageFlags,
  type ButtonInteraction,
  type Client,
} from "discord.js";
import {
  getButtonAction,
  parseCustomId,
  writeAuditEvent,
  type Logger,
} from "@mirror/core";
import { AuditActorType } from "@mirror/db";

const COOLDOWN_MS = 3_000;
const recentClicks = new Map<string, number>();

function cooldownKey(userId: string, actionId: string) {
  return `${userId}:${actionId}`;
}

function underCooldown(userId: string, actionId: string): boolean {
  const key = cooldownKey(userId, actionId);
  const last = recentClicks.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  recentClicks.set(key, Date.now());
  return false;
}

async function handleRoleToggle(interaction: ButtonInteraction, params: Record<string, unknown>, log: Logger) {
  const roleDiscordId = String(params.roleDiscordId ?? "");
  if (!/^\d{17,20}$/.test(roleDiscordId)) {
    await interaction.reply({ content: "Кнопка настроена некорректно (роль).", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Кнопка работает только на сервере.", flags: MessageFlags.Ephemeral });
    return;
  }

  const role = await interaction.guild.roles.fetch(roleDiscordId).catch(() => null);
  const me = interaction.guild.members.me;
  if (!role || !me) {
    await interaction.reply({ content: "Роль недоступна.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (role.managed || role.position >= me.roles.highest.position) {
    await interaction.reply({
      content: "Не могу выдать или снять эту роль (иерархия / managed).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const has = member.roles.cache.has(role.id);
  if (has) {
    await member.roles.remove(role, "Mirror: кнопка role.toggle");
  } else {
    await member.roles.add(role, "Mirror: кнопка role.toggle");
  }

  await writeAuditEvent({
    actorType: AuditActorType.USER,
    source: "discord.button",
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    action: has ? "button.role_removed" : "button.role_added",
    entityType: "discord_role",
    entityId: role.id,
    after: { userDiscordId: interaction.user.id, roleName: role.name },
  });

  await interaction.reply({
    content: has ? `Роль **${role.name}** снята.` : `Роль **${role.name}** выдана.`,
    flags: MessageFlags.Ephemeral,
  });
  log.info({ userId: interaction.user.id, roleId: role.id, removed: has }, "role.toggle");
}

async function handleCallback(interaction: ButtonInteraction, params: Record<string, unknown>) {
  const message = typeof params.message === "string" && params.message.trim()
    ? params.message.trim().slice(0, 500)
    : "Кнопка нажата.";
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  _client: Client,
  log: Logger,
) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (underCooldown(interaction.user.id, parsed.id)) {
    await interaction.reply({ content: "Подождите пару секунд.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const stored = await getButtonAction(parsed.id);
  if (!stored) {
    await interaction.reply({
      content: "Кнопка устарела или отключена.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const params =
    typeof stored.params === "object" && stored.params !== null && !Array.isArray(stored.params)
      ? (stored.params as Record<string, unknown>)
      : {};

  const action = stored.action || parsed.action;
  if (action === "role.toggle") {
    await handleRoleToggle(interaction, params, log);
  } else if (action === "callback") {
    await handleCallback(interaction, params);
  } else {
    await interaction.reply({
      content: `Неизвестное действие кнопки: ${action}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  return true;
}
