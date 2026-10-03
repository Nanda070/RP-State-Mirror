/**
 * Resolve Discord delivery targets for module messages.
 * Channels/webhooks come from settings — never hardcoded IDs.
 */
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { z } from "zod";
import { snowflakeSchema } from "./env.js";
import { getSetting, migrateLegacyRegistrationChannels } from "./settings.js";

export const factionDeliverySettingsSchema = z
  .object({
    documentsChannelId: snowflakeSchema.optional(),
    personnelChannelId: snowflakeSchema.optional(),
    documentsWebhookUrl: z.string().url().optional(),
    personnelWebhookUrl: z.string().url().optional(),
    /** Discord role on the faction guild pinged for documents / faction-bound notices («старший состав»). */
    seniorRoleId: snowflakeSchema.optional(),
  })
  .passthrough();

export type FactionDeliverySettings = z.infer<typeof factionDeliverySettingsSchema>;

/** Build Discord role mention string; empty if no ids. */
export function formatRoleMentions(roleIds: readonly string[]): string {
  return roleIds
    .filter((id) => /^\d{17,20}$/.test(id))
    .map((id) => `<@&${id}>`)
    .join(" ");
}

/**
 * Senior staff («старший состав») role for a faction, from faction.settings.seniorRoleId.
 * Used as a fallback ping when no faction-code / FACTION_MEMBER role is available.
 */
export async function resolveFactionSeniorRoleId(factionCode: string): Promise<string | null> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) return null;
  const settings = parseFactionSettings(faction.settings);
  return settings.seniorRoleId ?? null;
}

/** Leader role Discord ids for a faction; falls back to seniorRoleId. */
export async function resolveFactionLeaderRoleIds(factionCode: string): Promise<string[]> {
  const code = factionCode.toUpperCase();
  const faction = await prisma.faction.findFirst({
    where: { code, status: RecordStatus.ACTIVE },
    select: { id: true, guildId: true, settings: true },
  });
  if (!faction) return [];
  const snowflake = (id: string) => /^\d{17,20}$/.test(id);
  const byFaction = await prisma.roleMapping.findMany({
    where: { status: RecordStatus.ACTIVE, kind: RoleMappingKind.FACTION_LEADER, factionId: faction.id },
    select: { roleDiscordId: true },
  });
  const ids = [...new Set(byFaction.map((m) => m.roleDiscordId).filter(snowflake))];
  if (ids.length > 0) return ids;
  if (faction.guildId) {
    const byGuild = await prisma.roleMapping.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        kind: RoleMappingKind.FACTION_LEADER,
        guildId: faction.guildId,
        factionId: null,
      },
      select: { roleDiscordId: true },
    });
    const guildIds = [...new Set(byGuild.map((m) => m.roleDiscordId).filter(snowflake))];
    if (guildIds.length > 0) return guildIds;
  }
  const senior = parseFactionSettings(faction.settings).seniorRoleId;
  return senior && snowflake(senior) ? [senior] : [];
}

/**
 * Roles to ping when posting a transfer application (§4.8).
 * Uses `transfers.pingRoleIds` and keeps only roles present on the ЧП guild
 * (`core.incidentGuildId`) — never GOV, never missing roles (`@unknown-role`).
 */
export async function resolveTransferPingRoleIds(
  _guildDiscordId?: string,
): Promise<string[]> {
  const [configured, incidentGuildDiscordId] = await Promise.all([
    getSetting("transfers.pingRoleIds"),
    getSetting("core.incidentGuildId"),
  ]);
  if (configured.length === 0 || !incidentGuildDiscordId) return [];

  const snowflake = (id: string) => /^\d{17,20}$/.test(id);
  const candidates = [...new Set(configured.filter(snowflake))];
  if (candidates.length === 0) return [];

  const guild = await prisma.guild.findFirst({
    where: { discordId: incidentGuildDiscordId, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  if (!guild) return [];

  const existing = await prisma.discordRole.findMany({
    where: {
      guildId: guild.id,
      status: RecordStatus.ACTIVE,
      discordId: { in: candidates },
    },
    select: { discordId: true },
  });
  const present = new Set(existing.map((role) => role.discordId));
  return candidates.filter((id) => present.has(id));
}

/**
 * Role to ping for faction-bound notices (/пост, /штраф).
 * Prefers a Discord role named like the faction code (FIB → @FIB) on the faction guild,
 * then seniorRoleId (legacy leader), then a FACTION_MEMBER mapping whose role name
 * matches the code, then any FACTION_MEMBER on the faction guild.
 * Avoids the shared generic «Фракция» ping used previously via fines.pingRoleIds on ЧП.
 */
export async function resolveFactionPingRoleId(factionCode: string): Promise<string | null> {
  const code = factionCode.toUpperCase();
  const faction = await prisma.faction.findFirst({
    where: { code, status: RecordStatus.ACTIVE },
    include: { guild: true },
  });
  if (!faction) return null;

  if (faction.guildId) {
    const byCodeName = await prisma.discordRole.findFirst({
      where: {
        guildId: faction.guildId,
        status: RecordStatus.ACTIVE,
        name: { equals: code, mode: "insensitive" },
      },
      select: { discordId: true },
    });
    if (byCodeName) return byCodeName.discordId;
  }

  const settings = parseFactionSettings(faction.settings);
  if (settings.seniorRoleId) return settings.seniorRoleId;

  const memberMappings = await prisma.roleMapping.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      kind: RoleMappingKind.FACTION_MEMBER,
      factionId: faction.id,
    },
    select: { roleDiscordId: true, guildId: true },
  });
  if (memberMappings.length > 0) {
    const roleIds = memberMappings.map((m) => m.roleDiscordId);
    const named = await prisma.discordRole.findFirst({
      where: {
        discordId: { in: roleIds },
        status: RecordStatus.ACTIVE,
        name: { equals: code, mode: "insensitive" },
      },
      select: { discordId: true },
    });
    if (named) return named.discordId;

    if (faction.guildId) {
      const onFaction = memberMappings.find((m) => m.guildId === faction.guildId);
      if (onFaction) return onFaction.roleDiscordId;
    }
    return memberMappings[0]?.roleDiscordId ?? null;
  }

  return null;
}

export type DeliveryTarget =
  | {
      kind: "channel";
      guildDiscordId: string;
      channelDiscordId: string;
    }
  | {
      kind: "webhook";
      webhookUrl: string;
      guildDiscordId: string | null;
      channelDiscordId: string | null;
    }
  | {
      kind: "unconfigured";
      reason: string;
    };

function parseFactionSettings(raw: unknown): FactionDeliverySettings {
  const result = factionDeliverySettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}

async function factionWithGuild(factionCode: string) {
  return prisma.faction.findFirst({
    where: { code: factionCode.toUpperCase(), status: RecordStatus.ACTIVE },
    include: { guild: true },
  });
}

export async function resolveFactionDocumentDelivery(factionCode: string): Promise<DeliveryTarget> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) {
    return { kind: "unconfigured", reason: `Фракция ${factionCode} не найдена` };
  }
  const settings = parseFactionSettings(faction.settings);
  const guildDiscordId = faction.guild?.discordId ?? null;

  if (settings.documentsChannelId && guildDiscordId) {
    return {
      kind: "channel",
      guildDiscordId,
      channelDiscordId: settings.documentsChannelId,
    };
  }
  if (settings.documentsWebhookUrl) {
    return {
      kind: "webhook",
      webhookUrl: settings.documentsWebhookUrl,
      guildDiscordId,
      channelDiscordId: null,
    };
  }
  return {
    kind: "unconfigured",
    reason: "Канал или вебхук документов для фракции ещё не настроен",
  };
}

/**
 * Legacy RESPONSE_WEBHOOK: `/ответ` is delivered to GOV's documents channel
 * (same destination as GOV faction `documentsChannelId` / webhook), not the
 * target faction of the original `/пост`.
 */
export async function resolveDocumentResponseDelivery(): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery("GOV");
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: "Канал или вебхук документов GOV ещё не настроен (сюда уходят ответы /ответ)",
    };
  }
  return target;
}

/**
 * Resolve the ACTIVE faction bound to a Discord guild (for `/ответ` local copy).
 */
export async function resolveFactionCodeByGuildDiscordId(
  guildDiscordId: string,
): Promise<string | null> {
  const guild = await prisma.guild.findFirst({
    where: { discordId: guildDiscordId, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  if (!guild) return null;
  const faction = await prisma.faction.findFirst({
    where: { guildId: guild.id, status: RecordStatus.ACTIVE },
    select: { code: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return faction?.code ?? null;
}

/**
 * Local `/ответ` copy: documents channel of the faction guild where the command
 * was used. Returns unconfigured when the guild is not bound to a faction.
 */
export async function resolveDocumentResponseLocalDelivery(
  sourceGuildDiscordId: string | null | undefined,
): Promise<DeliveryTarget> {
  if (!sourceGuildDiscordId) {
    return {
      kind: "unconfigured",
      reason: "Команда /ответ вызвана вне сервера фракции — локальная копия не отправлена",
    };
  }
  const code = await resolveFactionCodeByGuildDiscordId(sourceGuildDiscordId);
  if (!code) {
    return {
      kind: "unconfigured",
      reason: "Сервер вызова /ответ не привязан к фракции — локальная копия не отправлена",
    };
  }
  const target = await resolveFactionDocumentDelivery(code);
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: `Канал документов фракции ${code} ещё не настроен (локальная копия /ответ)`,
    };
  }
  return target;
}

/** True when both targets point at the same Discord channel (avoid duplicate send). */
export function sameDeliveryChannel(a: DeliveryTarget, b: DeliveryTarget): boolean {
  if (a.kind === "channel" && b.kind === "channel") {
    return a.guildDiscordId === b.guildDiscordId && a.channelDiscordId === b.channelDiscordId;
  }
  if (a.kind === "webhook" && b.kind === "webhook") {
    return a.webhookUrl === b.webhookUrl;
  }
  return false;
}

export async function resolveFactionPersonnelDelivery(factionCode: string): Promise<DeliveryTarget> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) {
    return { kind: "unconfigured", reason: `Фракция ${factionCode} не найдена` };
  }
  const settings = parseFactionSettings(faction.settings);
  const guildDiscordId = faction.guild?.discordId ?? null;

  if (settings.personnelChannelId && guildDiscordId) {
    return {
      kind: "channel",
      guildDiscordId,
      channelDiscordId: settings.personnelChannelId,
    };
  }
  if (settings.personnelWebhookUrl) {
    return {
      kind: "webhook",
      webhookUrl: settings.personnelWebhookUrl,
      guildDiscordId,
      channelDiscordId: null,
    };
  }
  return {
    kind: "unconfigured",
    reason: "Канал или вебхук кадрового аудита для фракции ещё не настроен",
  };
}

export async function resolveWantedDelivery(): Promise<DeliveryTarget> {
  const [channelId, incidentGuildId] = await Promise.all([
    getSetting("wanted.channelId"),
    getSetting("core.incidentGuildId"),
  ]);
  if (!channelId || !incidentGuildId) {
    return {
      kind: "unconfigured",
      reason: "Канал розыска или сервер ЧП ещё не настроены",
    };
  }
  return {
    kind: "channel",
    guildDiscordId: incidentGuildId,
    channelDiscordId: channelId,
  };
}

/** Registration review channel on ЧП — vehicle and uniform use separate settings. */
export async function resolveRegistrationDelivery(
  kind: "VEHICLE" | "UNIFORM",
): Promise<DeliveryTarget> {
  await migrateLegacyRegistrationChannels();
  const channelKey =
    kind === "VEHICLE" ? "registrations.vehicleChannelId" : "registrations.uniformChannelId";
  const [channelId, incidentGuildId] = await Promise.all([
    getSetting(channelKey),
    getSetting("core.incidentGuildId"),
  ]);
  if (!channelId || !incidentGuildId) {
    const label = kind === "VEHICLE" ? "регистрации ТС" : "регистрации формы (униформы)";
    return {
      kind: "unconfigured",
      reason: `Канал ${label} или сервер ЧП ещё не настроены`,
    };
  }
  return {
    kind: "channel",
    guildDiscordId: incidentGuildId,
    channelDiscordId: channelId,
  };
}

export async function resolveIcBlacklistDelivery(): Promise<DeliveryTarget> {
  const [channelId, incidentGuildId] = await Promise.all([
    getSetting("icBlacklist.channelId"),
    getSetting("core.incidentGuildId"),
  ]);
  if (!channelId || !incidentGuildId) {
    return {
      kind: "unconfigured",
      reason: "Канал IC чёрного списка или сервер ЧП ещё не настроены",
    };
  }
  return {
    kind: "channel",
    guildDiscordId: incidentGuildId,
    channelDiscordId: channelId,
  };
}

/**
 * Faction codes never mentioned on federal wanted announcements (ЧП).
 * WN (Weazel News) is media, not a state agency for розыск pings.
 */
export const WANTED_PING_EXCLUDED_FACTION_CODES = ["WN"] as const;

const SHARED_FACTION_ROLE_NAME = "фракция";

/**
 * Roles to ping when publishing federal wanted on ЧП.
 * All ACTIVE factions' FACTION_MEMBER roles on the incident guild, except WN.
 * Skips the legacy shared «Фракция» role; falls back to a role named like the
 * faction code (LSPD → @LSPD) when needed.
 */
export async function resolveWantedPingRoleIds(): Promise<string[]> {
  const incidentGuildDiscordId = await getSetting("core.incidentGuildId");
  if (!incidentGuildDiscordId) return [];

  const incidentGuild = await prisma.guild.findFirst({
    where: { discordId: incidentGuildDiscordId, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  if (!incidentGuild) return [];

  const excluded = new Set(
    WANTED_PING_EXCLUDED_FACTION_CODES.map((code) => code.toUpperCase()),
  );

  const [factions, mappings, roles] = await Promise.all([
    prisma.faction.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true },
    }),
    prisma.roleMapping.findMany({
      where: { status: RecordStatus.ACTIVE, kind: RoleMappingKind.FACTION_MEMBER, guildId: incidentGuild.id },
      select: { roleDiscordId: true, factionId: true },
    }),
    // Every role of the incident guild: needed both for mapped roles and for the «role named as the code» fallback.
    prisma.discordRole.findMany({
      where: { guildId: incidentGuild.id, status: RecordStatus.ACTIVE },
      select: { discordId: true, name: true },
    }),
  ]);
  const roleById = new Map(roles.map((role) => [role.discordId, role]));
  const roleByName = new Map(roles.map((role) => [role.name.trim().toLowerCase(), role]));

  const roleIds: string[] = [];
  const seen = new Set<string>();

  for (const faction of factions) {
    const code = faction.code.toUpperCase();
    if (excluded.has(code)) continue;

    let addedFromMapping = false;
    for (const mapping of mappings) {
      if (mapping.factionId !== faction.id) continue;
      const role = roleById.get(mapping.roleDiscordId);
      if (!role) continue;
      if (role.name.trim().toLowerCase() === SHARED_FACTION_ROLE_NAME) continue;
      if (seen.has(role.discordId)) continue;
      seen.add(role.discordId);
      roleIds.push(role.discordId);
      addedFromMapping = true;
    }
    if (addedFromMapping) continue;

    const byCodeName = roleByName.get(code.toLowerCase());
    if (byCodeName && !seen.has(byCodeName.discordId)) {
      seen.add(byCodeName.discordId);
      roleIds.push(byCodeName.discordId);
    }
  }

  return roleIds;
}

/**
 * Primary `/штраф` publish: selected faction's documents channel (same as `/пост`).
 * Does **not** use `fines.channelId` on ЧП.
 */
export async function resolveFineDelivery(factionCode: string): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery(factionCode);
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: `Канал или вебхук документов для фракции ${factionCode.toUpperCase()} ещё не настроен (сюда уходят штрафы /штраф)`,
    };
  }
  return target;
}

/**
 * `/штраф-оплачено` notice: GOV documents channel (same destination as `/ответ`).
 */
export async function resolveFinePaidDelivery(): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery("GOV");
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: "Канал или вебхук документов GOV ещё не настроен (сюда уходят уведомления об оплате штрафа)",
    };
  }
  return target;
}

export function deliveryConfigured(target: DeliveryTarget): boolean {
  return target.kind !== "unconfigured";
}

export function deliveryDeferredMessage(target: DeliveryTarget): string {
  if (target.kind === "unconfigured") {
    return `${target.reason}. Запись сохранена — сообщение отправится после настройки.`;
  }
  return "Сообщение поставлено в очередь на отправку.";
}
