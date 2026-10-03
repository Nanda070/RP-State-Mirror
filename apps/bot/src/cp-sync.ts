/**
 * Apply ЧП role sync for a Discord user (legacy evaluate_member_access).
 */
import {
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  getCpSyncConfig,
  loadCpFactionLinks,
  makeSyncLogEmbed,
  planCpSync,
  writeAuditEvent,
  type Logger,
} from "@mirror/core";
import { AuditActorType, prisma, RecordStatus } from "@mirror/db";
import { classicToEmbed } from "./embed-payload.js";

async function safeFetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function sendCpLog(
  client: Client,
  incidentGuildId: string,
  logChannelId: string | null,
  member: GuildMember,
  action: string,
  details: string,
  color: number,
) {
  if (!logChannelId) return;
  try {
    const guild = await client.guilds.fetch(incidentGuildId);
    const channel = (await guild.channels.fetch(logChannelId)) as TextChannel | null;
    if (!channel?.isTextBased()) return;
    const classic = makeSyncLogEmbed({
      memberMention: member.toString(),
      displayName: member.displayName,
      username: member.user.username,
      userId: member.id,
      action,
      details,
      color,
      avatarUrl: member.displayAvatarURL({ size: 256 }),
    });
    await channel.send({ embeds: [classicToEmbed(classic)] });
  } catch {
    // Logging must never break sync.
  }
}

export async function evaluateMemberCpAccess(
  client: Client,
  userDiscordId: string,
  log: Logger,
): Promise<void> {
  const config = await getCpSyncConfig();
  if (!config.enabled || !config.incidentGuildId) return;

  const incidentGuild = await client.guilds.fetch(config.incidentGuildId).catch(() => null);
  if (!incidentGuild) return;

  const member = await safeFetchMember(incidentGuild, userDiscordId);
  if (!member || member.user.bot) return;
  if (member.id === incidentGuild.ownerId) return;

  const { links, managedTargetRoleIds } = await loadCpFactionLinks(config.incidentGuildId);
  if (links.length === 0 || managedTargetRoleIds.length === 0) {
    log.debug("cp sync: no faction/ЧП role links configured");
    return;
  }

  const memberships = new Map<string, string[]>();
  const guildIds = [...new Set(links.map((l) => l.factionGuildDiscordId))];
  for (const guildId of guildIds) {
    const g = await client.guilds.fetch(guildId).catch(() => null);
    if (!g) {
      memberships.set(guildId, []);
      continue;
    }
    const m = await safeFetchMember(g, userDiscordId);
    memberships.set(
      guildId,
      m ? m.roles.cache.filter((r) => r.id !== g.id).map((r) => r.id) : [],
    );
  }

  const incidentRoleIds = member.roles.cache.filter((r) => r.id !== incidentGuild.id).map((r) => r.id);
  const plan = planCpSync({
    userDiscordId,
    isBot: false,
    isOwner: false,
    excludedRoleIds: config.excludedRoleIds,
    incidentRoleIds,
    memberships,
    links,
    managedTargetRoleIds,
  });

  if (plan.kind === "skip" || plan.kind === "noop") return;

  if (plan.kind === "kick") {
    try {
      await member
        .send(
          "Доступ аннулирован. Вы исключены из сервера ЧП, так как не состоите ни в одной официальной фракции.",
        )
        .catch(() => undefined);
      await member.kick("Автоматическая синхронизация: потеряны фракционные роли.");
      await writeAuditEvent({
        actorType: AuditActorType.BOT,
        source: "cp.sync",
        guildId: config.incidentGuildId,
        action: "cp.member_kicked",
        entityType: "discord_guild_member",
        entityId: `${config.incidentGuildId}:${userDiscordId}`,
        after: { reason: plan.reason },
      });
      await sendCpLog(
        client,
        config.incidentGuildId,
        config.logChannelId,
        member,
        "KICK",
        "**Причина:** Потеряны все фракционные роли.\nУчастник исключен из ЧП.",
        COLOR_ERROR,
      );
      log.info({ userId: userDiscordId }, "cp sync kick");
    } catch (error) {
      log.error({ err: error, userId: userDiscordId }, "cp sync kick failed");
    }
    return;
  }

  try {
    const toAdd = plan.addRoleIds
      .map((id) => incidentGuild.roles.cache.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const toRemove = plan.removeRoleIds
      .map((id) => incidentGuild.roles.cache.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (toAdd.length) await member.roles.add(toAdd, "Синхронизация ЧП");
    if (toRemove.length) await member.roles.remove(toRemove, "Синхронизация ЧП");

    await writeAuditEvent({
      actorType: AuditActorType.BOT,
      source: "cp.sync",
      guildId: config.incidentGuildId,
      action: "cp.roles_updated",
      entityType: "discord_guild_member",
      entityId: `${config.incidentGuildId}:${userDiscordId}`,
      after: {
        added: toAdd.map((r) => r.id),
        removed: toRemove.map((r) => r.id),
      },
    });

    const lines: string[] = [];
    if (toAdd.length) lines.push(`**Выданы роли:** ${toAdd.map((r) => r.toString()).join(", ")}`);
    if (toRemove.length) lines.push(`**Сняты роли:** ${toRemove.map((r) => r.toString()).join(", ")}`);
    await sendCpLog(
      client,
      config.incidentGuildId,
      config.logChannelId,
      member,
      "UPDATE",
      lines.join("\n"),
      COLOR_SUCCESS,
    );
    log.info(
      { userId: userDiscordId, added: toAdd.length, removed: toRemove.length },
      "cp sync update",
    );
  } catch (error) {
    log.error({ err: error, userId: userDiscordId }, "cp sync role update failed");
  }
}

function gatewayRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: { retry_after?: unknown } }).data;
  const seconds = data?.retry_after;
  return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : null;
}

async function fetchGuildMembersWithRetry(guild: Guild, log: Logger) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await guild.members.fetch();
    } catch (error) {
      const retryAfter = gatewayRetryAfterSeconds(error);
      if (retryAfter == null || attempt === 3) throw error;
      const waitMs = Math.ceil((retryAfter + 1) * 1000);
      log.warn({ guildId: guild.id, attempt, waitMs }, "members.fetch rate limited; waiting");
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error("members.fetch: retries exhausted");
}

/** Reconcile all present members of the incident guild (hourly). */
export async function reconcileCpAccess(client: Client, log: Logger) {
  const config = await getCpSyncConfig();
  if (!config.enabled || !config.incidentGuildId) return;

  const guild = await client.guilds.fetch(config.incidentGuildId).catch(() => null);
  if (!guild) return;

  // After startup sync the cache is usually warm — avoid a second opcode-8 fetch that rate-limits.
  const members =
    guild.members.cache.size > 1 ? guild.members.cache : await fetchGuildMembersWithRetry(guild, log);
  let processed = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    await evaluateMemberCpAccess(client, member.id, log);
    processed += 1;
  }
  log.info({ processed, guildId: config.incidentGuildId }, "cp sync reconcile done");
}

/** Whether a guild discord id is a faction server or the incident guild (for event triggers). */
export async function isCpRelevantGuild(guildDiscordId: string): Promise<boolean> {
  const incidentGuildId = (await getCpSyncConfig()).incidentGuildId;
  if (guildDiscordId === incidentGuildId) return true;
  const factionGuild = await prisma.faction.findFirst({
    where: {
      status: RecordStatus.ACTIVE,
      guild: { discordId: guildDiscordId, status: RecordStatus.ACTIVE },
    },
    select: { id: true },
  });
  return Boolean(factionGuild);
}
