import { ChannelType, type Guild, type GuildBasedChannel, type GuildMember, type Role } from "discord.js";
import type { ChannelSnapshot, GuildSnapshot, MemberSnapshot, RoleSnapshot } from "@mirror/core";

const TEXT_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

export function toGuildSnapshot(guild: Guild): GuildSnapshot {
  return { discordId: guild.id, name: guild.name, iconUrl: guild.iconURL() };
}

export function toRoleSnapshot(role: Role): RoleSnapshot {
  return {
    discordId: role.id,
    name: role.name,
    color: role.colors.primaryColor,
    position: role.position,
    managed: role.managed,
  };
}

export function toChannelSnapshot(channel: GuildBasedChannel): ChannelSnapshot | null {
  if (!TEXT_CHANNEL_TYPES.has(channel.type)) return null;
  return {
    discordId: channel.id,
    name: channel.name,
    type: channel.type,
    position: "position" in channel ? channel.position : 0,
  };
}

export function toMemberSnapshot(member: GuildMember): MemberSnapshot {
  return {
    userDiscordId: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    nickname: member.nickname,
    avatarUrl: member.user.displayAvatarURL({ size: 256 }),
    guildAvatarUrl: member.avatar ? member.displayAvatarURL({ size: 256 }) : null,
    roleIds: member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => role.id),
    joinedAt: member.joinedAt,
    publicFlags: member.user.flags?.bitfield ?? null,
    avatarDecorationUrl: member.user.avatarDecorationURL({ size: 160 }) ?? null,
  };
}

/** Roles of a guild without the implicit @everyone role. */
export function guildRoles(guild: Guild): RoleSnapshot[] {
  return guild.roles.cache.filter((role) => role.id !== guild.id).map(toRoleSnapshot);
}

/** Text/announcement channels for dashboard pickers. */
export function guildChannels(guild: Guild): ChannelSnapshot[] {
  return guild.channels.cache
    .map((ch) => toChannelSnapshot(ch))
    .filter((ch): ch is ChannelSnapshot => ch !== null);
}
