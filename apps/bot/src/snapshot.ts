import type { Guild, GuildMember, Role } from "discord.js";
import type { GuildSnapshot, MemberSnapshot, RoleSnapshot } from "@mirror/core";

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
  };
}

/** Roles of a guild without the implicit @everyone role. */
export function guildRoles(guild: Guild): RoleSnapshot[] {
  return guild.roles.cache.filter((role) => role.id !== guild.id).map(toRoleSnapshot);
}
