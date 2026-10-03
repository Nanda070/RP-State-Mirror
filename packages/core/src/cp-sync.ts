/**
 * ЧП (incident guild) role sync planner.
 *
 * Source of truth: faction membership roles on faction guilds
 * (FACTION_MEMBER / LEADER / DEPUTY mappings).
 * Target: FACTION_MEMBER mappings on the incident guild for the same faction
 * (roles granted on ЧП — legacy MAIN_ROLE_ID).
 *
 * Gated by setting `cp.syncEnabled`. Excluded incident roles skip the member.
 */
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { getSetting } from "./settings.js";

const SOURCE_KINDS: RoleMappingKind[] = [
  RoleMappingKind.FACTION_MEMBER,
  RoleMappingKind.FACTION_LEADER,
  RoleMappingKind.FACTION_DEPUTY,
];

export interface CpFactionLink {
  factionCode: string;
  factionGuildDiscordId: string;
  sourceRoleIds: string[];
  targetRoleIds: string[];
}

export type CpSyncPlan =
  | { kind: "skip"; reason: string }
  | { kind: "kick"; reason: string }
  | { kind: "update"; addRoleIds: string[]; removeRoleIds: string[] }
  | { kind: "noop" };

export interface PlanCpSyncInput {
  userDiscordId: string;
  isBot: boolean;
  isOwner: boolean;
  excludedRoleIds: readonly string[];
  incidentRoleIds: readonly string[];
  /** Present memberships: guild discord id → role ids. */
  memberships: ReadonlyMap<string, readonly string[]>;
  links: readonly CpFactionLink[];
  /** All managed target role ids on the incident guild. */
  managedTargetRoleIds: readonly string[];
  /**
   * Faction guilds whose membership could not be read (guild unavailable, request failed).
   * «Could not read» is not «is not a member»: with any unknown the member is left alone,
   * because the missing guild might be the only one that gives them access.
   */
  unknownGuildIds?: readonly string[];
}

export function planCpSync(input: PlanCpSyncInput): CpSyncPlan {
  if (input.isBot) return { kind: "skip", reason: "bot" };
  if (input.isOwner) return { kind: "skip", reason: "owner" };
  if (input.unknownGuildIds && input.unknownGuildIds.length > 0) {
    return { kind: "skip", reason: "membership_unknown" };
  }

  const incidentRoles = new Set(input.incidentRoleIds);
  if (input.excludedRoleIds.some((id) => incidentRoles.has(id))) {
    return { kind: "skip", reason: "excluded_role" };
  }

  const desired = new Set<string>();
  for (const link of input.links) {
    const roles = input.memberships.get(link.factionGuildDiscordId) ?? [];
    const hasSource = link.sourceRoleIds.some((id) => roles.includes(id));
    if (hasSource) {
      for (const target of link.targetRoleIds) desired.add(target);
    }
  }

  if (desired.size === 0) {
    return { kind: "kick", reason: "no_faction_roles" };
  }

  const managed = new Set(input.managedTargetRoleIds);
  const addRoleIds = [...desired].filter((id) => !incidentRoles.has(id));
  const removeRoleIds = [...managed].filter((id) => incidentRoles.has(id) && !desired.has(id));

  if (addRoleIds.length === 0 && removeRoleIds.length === 0) {
    return { kind: "noop" };
  }
  return { kind: "update", addRoleIds, removeRoleIds };
}

/**
 * Load faction ↔ ЧП role links from active role mappings.
 * Target roles must live on the incident guild; source roles on faction guilds.
 */
export async function loadCpFactionLinks(incidentGuildDiscordId: string): Promise<{
  links: CpFactionLink[];
  managedTargetRoleIds: string[];
}> {
  const mappings = await prisma.roleMapping.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      factionId: { not: null },
      kind: { in: [...SOURCE_KINDS] },
      guild: { status: RecordStatus.ACTIVE },
      faction: { status: RecordStatus.ACTIVE },
    },
    include: {
      guild: { select: { discordId: true } },
      faction: { select: { code: true } },
    },
  });

  const byFaction = new Map<
    string,
    {
      factionCode: string;
      sources: Map<string, Set<string>>;
      targets: Set<string>;
    }
  >();

  for (const m of mappings) {
    if (!m.faction) continue;
    let entry = byFaction.get(m.faction.code);
    if (!entry) {
      entry = { factionCode: m.faction.code, sources: new Map(), targets: new Set() };
      byFaction.set(m.faction.code, entry);
    }
    if (m.guild.discordId === incidentGuildDiscordId) {
      if (m.kind === RoleMappingKind.FACTION_MEMBER) {
        entry.targets.add(m.roleDiscordId);
      }
    } else if (SOURCE_KINDS.includes(m.kind)) {
      let set = entry.sources.get(m.guild.discordId);
      if (!set) {
        set = new Set();
        entry.sources.set(m.guild.discordId, set);
      }
      set.add(m.roleDiscordId);
    }
  }

  const links: CpFactionLink[] = [];
  const managedTargetRoleIds = new Set<string>();

  for (const entry of byFaction.values()) {
    if (entry.targets.size === 0 || entry.sources.size === 0) continue;
    for (const target of entry.targets) managedTargetRoleIds.add(target);
    for (const [factionGuildDiscordId, sourceRoleIds] of entry.sources) {
      links.push({
        factionCode: entry.factionCode,
        factionGuildDiscordId,
        sourceRoleIds: [...sourceRoleIds],
        targetRoleIds: [...entry.targets],
      });
    }
  }

  return { links, managedTargetRoleIds: [...managedTargetRoleIds] };
}

export async function isCpSyncEnabled(): Promise<boolean> {
  return getSetting("cp.syncEnabled");
}

/** A full pass may always kick this many members, whatever the percentage says. */
export const CP_KICK_FLOOR = 3;

/**
 * Most members one full pass may kick. A pass that wants to kick more is almost certainly looking
 * at broken input (a mapping removed by mistake, a faction guild that dropped out), so its kicks
 * are held back for a human to confirm.
 */
export function cpKickLimit(memberCount: number, maxKickPercent: number): number {
  return Math.max(CP_KICK_FLOOR, Math.floor((memberCount * maxKickPercent) / 100));
}

export async function getCpSyncConfig() {
  const [enabled, incidentGuildId, excludedRoleIds, logChannelId, maxKickPercent, dryRun] = await Promise.all([
    getSetting("cp.syncEnabled"),
    getSetting("core.incidentGuildId"),
    getSetting("cp.excludedRoleIds"),
    getSetting("cp.logChannelId"),
    getSetting("cp.maxKickPercent"),
    getSetting("cp.dryRun"),
  ]);
  return { enabled, incidentGuildId, excludedRoleIds, logChannelId, maxKickPercent, dryRun };
}
