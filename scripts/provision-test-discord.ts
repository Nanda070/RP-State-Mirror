/**
 * Idempotent Discord + DB provision for local/end-to-end testing.
 *
 * - Creates standard roles/channels on every guild the bot is in
 * - Special-cases the ЧП (incident) guild
 * - Writes core/faction/module settings and role mappings into Postgres
 * - Syncs guild/role/channel snapshots so dashboard pickers work
 *
 * Usage (from repo root, after `pnpm -r build`):
 *   pnpm provision:test-discord
 *
 * Secrets come only from root `.env` (never committed).
 */
import { AuditActorType, RoleMappingKind, prisma } from "../packages/db/dist/index.js";
import {
  listActiveFactions,
  seedFoundation,
  setMainAndIncidentGuilds,
  setSetting,
  syncGuildChannels,
  syncGuildRoles,
  updateFactionDeliverySettings,
  upsertGuild,
  upsertRoleMapping,
  type AuditContext,
  type ChannelSnapshot,
  type RoleSnapshot,
} from "../packages/core/dist/index.js";

const INCIDENT_GUILD_ID = "1555745886435418115";
const API = "https://discord.com/api/v10";

const STANDARD_ROLES = ["Лидер", "Зам Лидера", "Старший Состав", "Фракция"] as const;
const STANDARD_CHANNELS = ["Кадровый Аудит", "Логи", "Документы"] as const;
const CP_CHANNELS = ["федеральный розыск", "Пост", "черный список", "перевод"] as const;
/** Roles created only on the ЧП (incident) guild. */
const CP_ROLES = ["Координатор"] as const;

const ADMIN_ROLE_CANDIDATES: ReadonlyArray<{ names: string[]; value: string }> = [
  { names: ["главный админ", "главный администратор", "super admin", "супер админ"], value: "SUPER_ADMIN" },
  { names: ["старший админ", "старший администратор", "senior admin"], value: "SENIOR_ADMIN" },
  { names: ["админ", "администратор", "admin"], value: "ADMIN" },
  { names: ["хелпер", "helper", "помощник"], value: "HELPER" },
];

const PERM_MANAGE_CHANNELS = 1n << 4n;
const PERM_MANAGE_ROLES = 1n << 28n;
const PERM_ADMINISTRATOR = 1n << 3n;

const CTX: AuditContext = {
  actorType: AuditActorType.SYSTEM,
  source: "provision-test-discord",
};

type DiscordGuild = { id: string; name: string; icon: string | null; permissions?: string };
type DiscordRole = {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  permissions: string;
};
type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  position?: number;
};
type DiscordMember = {
  roles: string[];
  user: { id: string; bot?: boolean };
};
type DiscordUser = { id: string; username: string; bot?: boolean };

type GuildProvision = {
  guildId: string;
  guildName: string;
  roles: Record<string, string>;
  channels: Record<string, string>;
  permissionFailures: string[];
  createdRoles: string[];
  createdChannels: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in environment / .env`);
  return value;
}

function iconUrl(guild: DiscordGuild): string | null {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function discord<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; errorText: string }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "MirrorProvisionScript (local-dev, 1.0)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  if (res.status === 429) {
    const retry = Number((data as { retry_after?: number } | null)?.retry_after ?? 1);
    await new Promise((r) => setTimeout(r, Math.ceil(retry * 1000) + 50));
    return discord(token, method, path, body);
  }
  return { ok: res.ok, status: res.status, data, errorText: text };
}

function hasPerm(permissions: bigint, bit: bigint): boolean {
  return (permissions & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR || (permissions & bit) === bit;
}

/**
 * Prefer the permissions bitfield from GET /users/@me/guilds (invite grants).
 * Fall back to role OR from the bot member (Discord rejects members/@me — use snowflake).
 */
async function computeBotPermissions(
  token: string,
  guildId: string,
  roles: DiscordRole[],
  botUserId: string,
  guildListPermissions?: string,
): Promise<{ permissions: bigint; highestPosition: number }> {
  let permissions = guildListPermissions !== undefined ? BigInt(guildListPermissions) : 0n;
  let highestPosition = 0;

  const me = await discord<DiscordMember>(token, "GET", `/guilds/${guildId}/members/${botUserId}`);
  if (me.ok && me.data) {
    const roleById = new Map(roles.map((r) => [r.id, r]));
    for (const roleId of me.data.roles) {
      const role = roleById.get(roleId);
      if (!role) continue;
      permissions |= BigInt(role.permissions);
      if (role.position > highestPosition) highestPosition = role.position;
    }
    const everyone = roles.find((r) => r.id === guildId);
    if (everyone) permissions |= BigInt(everyone.permissions);
  }

  return { permissions, highestPosition };
}

async function ensureRole(
  token: string,
  guildId: string,
  name: string,
  roles: DiscordRole[],
  canManage: boolean,
  failures: string[],
  created: string[],
): Promise<{ id: string | null; roles: DiscordRole[] }> {
  const existing = roles.find((r) => normalizeName(r.name) === normalizeName(name));
  if (existing) return { id: existing.id, roles };

  if (!canManage) {
    failures.push(`role:${name}: нет права Manage Roles`);
    return { id: null, roles };
  }

  const createdRes = await discord<DiscordRole>(token, "POST", `/guilds/${guildId}/roles`, {
    name,
    mentionable: true,
  });
  if (!createdRes.ok || !createdRes.data) {
    failures.push(`role:${name}: HTTP ${createdRes.status} ${createdRes.errorText.slice(0, 200)}`);
    return { id: null, roles };
  }
  created.push(`${name}=${createdRes.data.id}`);
  return { id: createdRes.data.id, roles: [...roles, createdRes.data] };
}

async function ensureTextChannel(
  token: string,
  guildId: string,
  name: string,
  channels: DiscordChannel[],
  canManage: boolean,
  failures: string[],
  created: string[],
): Promise<{ id: string | null; channels: DiscordChannel[] }> {
  const existing = channels.find(
    (c) => (c.type === 0 || c.type === 5) && normalizeName(c.name) === normalizeName(name),
  );
  if (existing) return { id: existing.id, channels };

  if (!canManage) {
    failures.push(`channel:${name}: нет права Manage Channels`);
    return { id: null, channels };
  }

  const createdRes = await discord<DiscordChannel>(token, "POST", `/guilds/${guildId}/channels`, {
    name,
    type: 0,
  });
  if (!createdRes.ok || !createdRes.data) {
    failures.push(`channel:${name}: HTTP ${createdRes.status} ${createdRes.errorText.slice(0, 200)}`);
    return { id: null, channels };
  }
  created.push(`${name}=${createdRes.data.id}`);
  return { id: createdRes.data.id, channels: [...channels, createdRes.data] };
}

function toRoleSnapshots(roles: DiscordRole[], guildId: string): RoleSnapshot[] {
  return roles
    .filter((r) => r.id !== guildId)
    .map((r) => ({
      discordId: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      managed: r.managed,
    }));
}

function toChannelSnapshots(channels: DiscordChannel[]): ChannelSnapshot[] {
  return channels
    .filter((c) => c.type === 0 || c.type === 5)
    .map((c) => ({
      discordId: c.id,
      name: c.name,
      type: c.type,
      position: c.position ?? 0,
    }));
}

function matchFactionCode(guildName: string, codes: string[]): string | null {
  const upper = guildName.toUpperCase();
  const exact = codes.find((code) => upper === code || upper.includes(` ${code} `) || upper.startsWith(`${code} `) || upper.endsWith(` ${code}`) || upper.includes(`[${code}]`) || upper.includes(`(${code})`));
  if (exact) return exact;
  // Name contains code as a token-ish substring (e.g. "LSPD Test")
  for (const code of codes) {
    if (new RegExp(`(?:^|[^A-Z0-9])${code}(?:[^A-Z0-9]|$)`, "i").test(guildName)) return code;
  }
  return null;
}

function pickMainGuild(guilds: DiscordGuild[], incidentId: string): DiscordGuild | null {
  const candidates = guilds.filter((g) => g.id !== incidentId);
  if (candidates.length === 0) return null;
  const byName = candidates.find((g) => /tubeworld|tube world|main|admin|главн|hub|центр/i.test(g.name));
  if (byName) return byName;
  // Prefer a guild that is not an obvious faction code name
  const nonFaction = candidates.find((g) => !/^(GOV|FIB|LSPD|LSSD|SASPA|ARMY|EMS|WN)\b/i.test(g.name));
  return nonFaction ?? candidates[0] ?? null;
}

async function provisionGuildStructure(
  token: string,
  guild: DiscordGuild,
  botUserId: string,
  extraRoles: string[],
  extraChannels: string[],
): Promise<{ provision: GuildProvision; roles: DiscordRole[]; channels: DiscordChannel[] }> {
  const provision: GuildProvision = {
    guildId: guild.id,
    guildName: guild.name,
    roles: {},
    channels: {},
    permissionFailures: [],
    createdRoles: [],
    createdChannels: [],
  };

  const rolesRes = await discord<DiscordRole[]>(token, "GET", `/guilds/${guild.id}/roles`);
  const channelsRes = await discord<DiscordChannel[]>(token, "GET", `/guilds/${guild.id}/channels`);
  if (!rolesRes.ok || !rolesRes.data) {
    provision.permissionFailures.push(`list roles: HTTP ${rolesRes.status}`);
    return { provision, roles: [], channels: [] };
  }
  if (!channelsRes.ok || !channelsRes.data) {
    provision.permissionFailures.push(`list channels: HTTP ${channelsRes.status}`);
    return { provision, roles: rolesRes.data, channels: [] };
  }

  let roles = rolesRes.data;
  let channels = channelsRes.data;
  const { permissions } = await computeBotPermissions(
    token,
    guild.id,
    roles,
    botUserId,
    guild.permissions,
  );
  const canRoles = hasPerm(permissions, PERM_MANAGE_ROLES);
  const canChannels = hasPerm(permissions, PERM_MANAGE_CHANNELS);

  if (!canRoles) provision.permissionFailures.push("нет права Manage Roles (создание ролей пропущено, поиск по имени всё равно выполняется)");
  if (!canChannels) provision.permissionFailures.push("нет права Manage Channels (создание каналов пропущено, поиск по имени всё равно выполняется)");

  const roleNames = [...STANDARD_ROLES, ...extraRoles];
  for (const name of roleNames) {
    const result = await ensureRole(token, guild.id, name, roles, canRoles, provision.permissionFailures, provision.createdRoles);
    roles = result.roles;
    if (result.id) provision.roles[name] = result.id;
  }

  const channelNames = [...STANDARD_CHANNELS, ...extraChannels];
  for (const name of channelNames) {
    const result = await ensureTextChannel(
      token,
      guild.id,
      name,
      channels,
      canChannels,
      provision.permissionFailures,
      provision.createdChannels,
    );
    channels = result.channels;
    if (result.id) provision.channels[name] = result.id;
  }

  return { provision, roles, channels };
}

async function mapAdminRolesOnMain(guildId: string, roles: DiscordRole[]): Promise<string[]> {
  const mapped: string[] = [];
  const usedRoleIds = new Set<string>();
  for (const candidate of ADMIN_ROLE_CANDIDATES) {
    const role = roles.find((r) => {
      if (usedRoleIds.has(r.id)) return false;
      const n = normalizeName(r.name);
      return candidate.names.some((alias) => n === alias || n.includes(alias));
    });
    if (!role) continue;
    usedRoleIds.add(role.id);
    await upsertRoleMapping(
      {
        guildDiscordId: guildId,
        roleDiscordId: role.id,
        kind: RoleMappingKind.ADMIN_LEVEL,
        value: candidate.value,
        factionCode: null,
      },
      CTX,
      { allowSuperAdminLevel: true },
    );
    mapped.push(`${candidate.value}←${role.name}(${role.id})`);
  }
  return mapped;
}

async function main() {
  const token = requireEnv("DISCORD_BOT_TOKEN");
  requireEnv("DATABASE_URL");

  const seed = await seedFoundation({
    superAdminUserIds: (process.env.SUPER_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  console.log("seed:", seed);

  const meRes = await discord<DiscordUser>(token, "GET", "/users/@me");
  if (!meRes.ok || !meRes.data) {
    throw new Error(`Failed to fetch bot user: HTTP ${meRes.status} ${meRes.errorText}`);
  }
  const botUserId = meRes.data.id;

  const guildsRes = await discord<DiscordGuild[]>(token, "GET", "/users/@me/guilds?limit=200");
  if (!guildsRes.ok || !guildsRes.data) {
    throw new Error(`Failed to list guilds: HTTP ${guildsRes.status} ${guildsRes.errorText}`);
  }
  const guilds = guildsRes.data;
  console.log(`bot: ${meRes.data.username} (${botUserId})`);
  console.log(
    "bot guilds:",
    guilds.map((g) => `${g.name} (${g.id})`).join(", ") || "(none)",
  );

  const incidentGuild = guilds.find((g) => g.id === INCIDENT_GUILD_ID);
  if (!incidentGuild) {
    console.warn(`WARN: ЧП guild ${INCIDENT_GUILD_ID} not in bot guild list — will still set incidentGuildId in DB`);
  }

  const factions = await listActiveFactions();
  const factionCodes = factions.map((f) => f.code);

  const mainGuild = pickMainGuild(guilds, INCIDENT_GUILD_ID);
  if (!mainGuild) {
    console.warn("WARN: no non-ЧП guild found for core.mainGuildId");
  } else {
    console.log(`main guild candidate: ${mainGuild.name} (${mainGuild.id})`);
  }

  await setMainAndIncidentGuilds(mainGuild?.id ?? null, INCIDENT_GUILD_ID, CTX);

  const provisions: GuildProvision[] = [];
  const roleCache = new Map<string, DiscordRole[]>();
  const channelCache = new Map<string, DiscordChannel[]>();

  for (const guild of guilds) {
    const isCp = guild.id === INCIDENT_GUILD_ID;
    const extraRoles = isCp ? [...CP_ROLES, ...factionCodes] : [];
    const extraChannels = isCp ? [...CP_CHANNELS] : [];
    // Faction guilds also get a role named by faction code (FIB → @FIB) for doc/fine pings.
    const factionCodeForGuild = !isCp
      ? factionCodes.find((code) => matchFactionCode(guild.name, [code]))
      : undefined;
    const guildExtraRoles = [
      ...extraRoles,
      ...(factionCodeForGuild && !extraRoles.includes(factionCodeForGuild)
        ? [factionCodeForGuild]
        : []),
    ];
    const { provision, roles, channels } = await provisionGuildStructure(
      token,
      guild,
      botUserId,
      guildExtraRoles,
      extraChannels,
    );
    provisions.push(provision);
    roleCache.set(guild.id, roles);
    channelCache.set(guild.id, channels);

    await upsertGuild({ discordId: guild.id, name: guild.name, iconUrl: iconUrl(guild) });
    await syncGuildRoles(guild.id, toRoleSnapshots(roles, guild.id));
    await syncGuildChannels(guild.id, toChannelSnapshots(channels));
    console.log(
      `synced ${guild.name}: roles=${roles.length}, textChannels=${toChannelSnapshots(channels).length}, createdRoles=${provision.createdRoles.length}, createdChannels=${provision.createdChannels.length}`,
    );
  }

  // Faction ↔ guild mapping
  const nonCpGuilds = guilds
    .filter((g) => g.id !== INCIDENT_GUILD_ID)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const assignedGuildIds = new Set<string>();
  const factionGuildMap = new Map<string, string>();

  for (const faction of factions) {
    const byCode = nonCpGuilds.find(
      (g) => !assignedGuildIds.has(g.id) && matchFactionCode(g.name, [faction.code]),
    );
    if (byCode) {
      factionGuildMap.set(faction.code, byCode.id);
      assignedGuildIds.add(byCode.id);
    }
  }

  // Remaining factions → remaining guilds in sort order (skip main hub if possible)
  const leftoverFactions = factions.filter((f) => !factionGuildMap.has(f.code));
  const leftoverGuilds = nonCpGuilds.filter((g) => !assignedGuildIds.has(g.id) && g.id !== mainGuild?.id);
  const overflowGuilds = nonCpGuilds.filter((g) => !assignedGuildIds.has(g.id) && !leftoverGuilds.includes(g));
  const pool = [...leftoverGuilds, ...overflowGuilds];
  for (let i = 0; i < leftoverFactions.length; i++) {
    const faction = leftoverFactions[i]!;
    const guild = pool[i];
    if (!guild) {
      console.warn(`WARN: no guild left for faction ${faction.code}`);
      continue;
    }
    factionGuildMap.set(faction.code, guild.id);
    assignedGuildIds.add(guild.id);
  }

  const factionMappingNotes: string[] = [];
  for (const faction of factions) {
    const guildId = factionGuildMap.get(faction.code);
    if (!guildId) continue;
    const provision = provisions.find((p) => p.guildId === guildId);
    if (!provision) continue;

    await updateFactionDeliverySettings(
      {
        factionCode: faction.code,
        guildDiscordId: guildId,
        documentsChannelId: provision.channels["Документы"] ?? null,
        personnelChannelId: provision.channels["Кадровый Аудит"] ?? null,
        seniorRoleId: provision.roles["Старший Состав"] ?? null,
      },
      CTX,
    );

    const leader = provision.roles["Лидер"];
    const deputy = provision.roles["Зам Лидера"];
    const member = provision.roles["Фракция"];
    // Dashboard uses value "true" for FACTION_* kinds (faction is via factionCode).
    if (leader) {
      await upsertRoleMapping(
        {
          guildDiscordId: guildId,
          roleDiscordId: leader,
          kind: RoleMappingKind.FACTION_LEADER,
          value: "true",
          factionCode: faction.code,
        },
        CTX,
      );
    }
    if (deputy) {
      await upsertRoleMapping(
        {
          guildDiscordId: guildId,
          roleDiscordId: deputy,
          kind: RoleMappingKind.FACTION_DEPUTY,
          value: "true",
          factionCode: faction.code,
        },
        CTX,
      );
    }
    if (member) {
      await upsertRoleMapping(
        {
          guildDiscordId: guildId,
          roleDiscordId: member,
          kind: RoleMappingKind.FACTION_MEMBER,
          value: "true",
          factionCode: faction.code,
        },
        CTX,
      );
    }

    // CP target on incident guild: per-faction role (code name) preferred; else shared Фракция.
    // Unique key is (roleDiscordId, kind, value) — use faction code as value for CP targets
    // so one shared role can still be linked per faction without colliding.
    const cpProvision = provisions.find((p) => p.guildId === INCIDENT_GUILD_ID);
    const cpTargetByCode = cpProvision?.roles[faction.code];
    const cpTargetShared = cpProvision?.roles["Фракция"];
    const cpTarget = cpTargetByCode ?? cpTargetShared ?? null;
    if (cpTarget) {
      await upsertRoleMapping(
        {
          guildDiscordId: INCIDENT_GUILD_ID,
          roleDiscordId: cpTarget,
          kind: RoleMappingKind.FACTION_MEMBER,
          value: cpTargetByCode ? "true" : faction.code,
          factionCode: faction.code,
        },
        CTX,
      );
    }

    const guildName = provision.guildName;
    factionMappingNotes.push(
      `${faction.code} → ${guildName} (${guildId}); docs=${provision.channels["Документы"] ?? "-"}; personnel=${provision.channels["Кадровый Аудит"] ?? "-"}; senior=${provision.roles["Старший Состав"] ?? "-"}; cpTarget=${cpTarget ?? "-"}`,
    );
  }

  // Module settings on ЧП
  const cp = provisions.find((p) => p.guildId === INCIDENT_GUILD_ID);
  const wantedChannelId = cp?.channels["федеральный розыск"] ?? null;
  const finesChannelId = cp?.channels["Пост"] ?? null;
  const logChannelId = cp?.channels["Логи"] ?? null;
  const pingRoleId = cp?.roles["Фракция"] ?? null;
  const coordinatorRoleId = cp?.roles["Координатор"] ?? null;

  await setSetting("wanted.channelId", wantedChannelId, CTX);
  await setSetting("wanted.enabled", true, CTX);
  await setSetting("wanted.pingRoleIds", pingRoleId ? [pingRoleId] : [], CTX);
  await setSetting(
    "wanted.coordinatorRoleIds",
    coordinatorRoleId ? [coordinatorRoleId] : [],
    CTX,
  );
  await setSetting("fines.channelId", finesChannelId, CTX);
  await setSetting("fines.pingRoleIds", pingRoleId ? [pingRoleId] : [], CTX);
  await setSetting("cp.syncEnabled", true, CTX);
  await setSetting("cp.logChannelId", logChannelId, CTX);
  await setSetting("cp.excludedRoleIds", [], CTX);

  let adminMappings: string[] = [];
  if (mainGuild) {
    adminMappings = await mapAdminRolesOnMain(mainGuild.id, roleCache.get(mainGuild.id) ?? []);
  }

  const report = {
    mainGuildId: mainGuild?.id ?? null,
    mainGuildName: mainGuild?.name ?? null,
    incidentGuildId: INCIDENT_GUILD_ID,
    incidentGuildPresent: Boolean(incidentGuild),
    provisions: provisions.map((p) => ({
      guild: `${p.guildName} (${p.guildId})`,
      roles: p.roles,
      channels: p.channels,
      createdRoles: p.createdRoles,
      createdChannels: p.createdChannels,
      permissionFailures: p.permissionFailures,
    })),
    factionMappings: factionMappingNotes,
    settings: {
      "core.mainGuildId": mainGuild?.id ?? null,
      "core.incidentGuildId": INCIDENT_GUILD_ID,
      "wanted.channelId": wantedChannelId,
      "wanted.pingRoleIds": pingRoleId ? [pingRoleId] : [],
      "wanted.coordinatorRoleIds": coordinatorRoleId ? [coordinatorRoleId] : [],
      "fines.channelId": finesChannelId,
      "fines.pingRoleIds": pingRoleId ? [pingRoleId] : [],
      "cp.syncEnabled": true,
      "cp.logChannelId": logChannelId,
      "cp.excludedRoleIds": [],
    },
    adminMappings,
  };

  console.log("\n=== PROVISION REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("provision failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
