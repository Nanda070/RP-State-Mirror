/**
 * Stage 4.11 staff utilities: faction membership overlaps and invite targets.
 */
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { getSetting } from "./settings.js";

export type FactionOverlap = {
  discordUserId: string;
  username: string | null;
  factions: string[];
};

/**
 * Users who currently hold FACTION_MEMBER/LEADER/DEPUTY mappings for 2+ ACTIVE factions.
 */
export async function findFactionOverlaps(limit = 50): Promise<FactionOverlap[]> {
  const factions = await prisma.faction.findMany({
    where: { status: RecordStatus.ACTIVE, guildId: { not: null } },
    select: { id: true, code: true, guildId: true },
  });
  if (factions.length < 2) return [];

  const factionById = new Map(factions.map((f) => [f.id, f]));
  const factionByGuildId = new Map(factions.map((f) => [f.guildId!, f]));

  const mappings = await prisma.roleMapping.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      kind: {
        in: [RoleMappingKind.FACTION_MEMBER, RoleMappingKind.FACTION_LEADER, RoleMappingKind.FACTION_DEPUTY],
      },
      guildId: { in: factions.map((f) => f.guildId!) },
    },
    select: { roleDiscordId: true, guildId: true, factionId: true },
  });

  const roleToFactionCodes = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const faction = mapping.factionId
      ? factionById.get(mapping.factionId)
      : factionByGuildId.get(mapping.guildId);
    if (!faction) continue;
    const key = `${mapping.guildId}:${mapping.roleDiscordId}`;
    const set = roleToFactionCodes.get(key) ?? new Set<string>();
    set.add(faction.code);
    roleToFactionCodes.set(key, set);
  }

  const members = await prisma.guildMember.findMany({
    where: {
      isPresent: true,
      guildId: { in: factions.map((f) => f.guildId!) },
      guild: { status: RecordStatus.ACTIVE },
    },
    select: { userDiscordId: true, username: true, guildId: true, roleIds: true },
  });

  const byUser = new Map<string, { username: string | null; factions: Set<string> }>();
  for (const member of members) {
    for (const roleId of member.roleIds) {
      const mapped = roleToFactionCodes.get(`${member.guildId}:${roleId}`);
      if (!mapped) continue;
      const current = byUser.get(member.userDiscordId) ?? {
        username: member.username,
        factions: new Set<string>(),
      };
      for (const code of mapped) current.factions.add(code);
      if (!current.username) current.username = member.username;
      byUser.set(member.userDiscordId, current);
    }
  }

  return [...byUser.entries()]
    .filter(([, value]) => value.factions.size >= 2)
    .map(([discordUserId, value]) => ({
      discordUserId,
      username: value.username,
      factions: [...value.factions].sort(),
    }))
    .sort((a, b) => b.factions.length - a.factions.length || a.discordUserId.localeCompare(b.discordUserId))
    .slice(0, limit);
}

export type InviteGuildChoice = { discordId: string; name: string; label: string };

/** Guilds allowed for /инвайт-админ: setting list, else main + faction guilds. */
export async function listInviteGuilds(): Promise<InviteGuildChoice[]> {
  const configured = await getSetting("invites.guildIds");
  if (configured.length > 0) {
    const guilds = await prisma.guild.findMany({
      where: { discordId: { in: configured }, status: RecordStatus.ACTIVE },
      select: { discordId: true, name: true },
    });
    const byId = new Map(guilds.map((g) => [g.discordId, g]));
    return configured
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .map((g) => ({ discordId: g.discordId, name: g.name, label: g.name.slice(0, 100) }));
  }

  const mainGuildId = await getSetting("core.mainGuildId");
  const or = [
    ...(mainGuildId ? [{ discordId: mainGuildId }] : []),
    { factions: { some: { status: RecordStatus.ACTIVE } } },
  ];
  const guilds = await prisma.guild.findMany({
    where: { status: RecordStatus.ACTIVE, OR: or },
    select: { discordId: true, name: true },
    orderBy: { name: "asc" },
  });
  return guilds.map((g) => ({ discordId: g.discordId, name: g.name, label: g.name.slice(0, 100) }));
}
