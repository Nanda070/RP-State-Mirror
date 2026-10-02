import { AdminLevel, RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { getSetting } from "./settings.js";

export const ADMIN_LEVEL_ORDER: readonly AdminLevel[] = [
  AdminLevel.SUPER_ADMIN,
  AdminLevel.SENIOR_ADMIN,
  AdminLevel.ADMIN,
  AdminLevel.HELPER,
];

export interface FactionIdentity {
  code: string;
  name: string;
  color: string | null;
  isLeader: boolean;
  isDeputy: boolean;
  rank: number | null;
  departments: string[];
}

export interface Identity {
  discordUserId: string;
  isSuperAdmin: boolean;
  adminLevel: AdminLevel | null;
  factions: FactionIdentity[];
  permissions: string[];
}

export interface ResolveIdentityOptions {
  superAdminUserIds: readonly string[];
}

function highestLevel(levels: AdminLevel[]): AdminLevel | null {
  for (const level of ADMIN_LEVEL_ORDER) {
    if (levels.includes(level)) return level;
  }
  return null;
}

function isAdminLevel(value: string): value is AdminLevel {
  return (ADMIN_LEVEL_ORDER as readonly string[]).includes(value);
}

/**
 * Derives who a user is from the stored role snapshot and the role mappings
 * configured in the dashboard. Only roles currently held on active guilds count.
 */
export async function resolveIdentity(discordUserId: string, options: ResolveIdentityOptions): Promise<Identity> {
  const isSuperAdmin = options.superAdminUserIds.includes(discordUserId);

  const memberships = await prisma.guildMember.findMany({
    where: { userDiscordId: discordUserId, isPresent: true, guild: { status: RecordStatus.ACTIVE } },
    include: { guild: true },
  });

  const heldRoles = new Set(memberships.flatMap((m) => m.roleIds.map((roleId) => `${m.guildId}:${roleId}`)));
  const allRoleIds = [...new Set(memberships.flatMap((m) => m.roleIds))];

  const mappings =
    allRoleIds.length === 0
      ? []
      : (
          await prisma.roleMapping.findMany({
            where: { roleDiscordId: { in: allRoleIds }, guild: { status: RecordStatus.ACTIVE } },
            include: { guild: true },
          })
        ).filter((m) => heldRoles.has(`${m.guildId}:${m.roleDiscordId}`));

  const mainGuildId = await getSetting("core.mainGuildId");
  const mappedLevels = mappings
    .filter((m) => m.kind === RoleMappingKind.ADMIN_LEVEL && m.guild.discordId === mainGuildId)
    .map((m) => m.value)
    .filter(isAdminLevel);
  const adminLevel = isSuperAdmin ? AdminLevel.SUPER_ADMIN : highestLevel(mappedLevels);

  const factions = await prisma.faction.findMany({
    where: { status: RecordStatus.ACTIVE, guildId: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  const factionIdentities: FactionIdentity[] = [];
  for (const faction of factions) {
    const own = mappings.filter(
      (m) => m.guildId === faction.guildId && (m.factionId === null || m.factionId === faction.id),
    );
    const kinds = new Set(own.map((m) => m.kind));
    const isLeader = kinds.has(RoleMappingKind.FACTION_LEADER);
    const isDeputy = kinds.has(RoleMappingKind.FACTION_DEPUTY);
    if (!kinds.has(RoleMappingKind.FACTION_MEMBER) && !isLeader && !isDeputy) continue;

    const ranks = own
      .filter((m) => m.kind === RoleMappingKind.RANK)
      .map((m) => Number.parseInt(m.value, 10))
      .filter(Number.isFinite);
    const departments = [
      ...new Set(own.filter((m) => m.kind === RoleMappingKind.DEPARTMENT).map((m) => m.value)),
    ].sort();

    factionIdentities.push({
      code: faction.code,
      name: faction.name,
      color: faction.color,
      isLeader,
      isDeputy,
      rank: ranks.length > 0 ? Math.max(...ranks) : null,
      departments,
    });
  }

  const permissions = [
    ...new Set(mappings.filter((m) => m.kind === RoleMappingKind.PERMISSION).map((m) => m.value)),
  ].sort();

  return { discordUserId, isSuperAdmin, adminLevel, factions: factionIdentities, permissions };
}
