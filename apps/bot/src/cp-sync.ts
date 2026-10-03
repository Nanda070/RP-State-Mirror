/**
 * Apply ЧП role sync for a Discord user (legacy evaluate_member_access).
 *
 * Safety rules:
 * - «Could not read membership» is never treated as «not a member»: if a faction guild is
 *   unavailable or a request fails, the member is left alone.
 * - A full pass that wants to kick more members than the configured limit kicks nobody and
 *   reports to the log channel instead.
 * - In dry-run mode nothing is changed; the bot only reports what it would do.
 */
import {
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  cpKickLimit,
  getCpSyncConfig,
  loadCpFactionLinks,
  makeSyncLogEmbed,
  planCpSync,
  writeAuditEvent,
  type CpFactionLink,
  type CpSyncPlan,
  type Logger,
} from "@mirror/core";
import { AuditActorType, prisma, RecordStatus } from "@mirror/db";
import { classicToEmbed } from "./embed-payload.js";

/** Discord API: Unknown Member / Unknown User — the only answers that mean «not on this server». */
const NOT_A_MEMBER_CODES = new Set([10007, 10013]);

function isNotAMember(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && NOT_A_MEMBER_CODES.has(code);
}

type RoleLookup = { known: true; roleIds: string[] | null } | { known: false };

function memberRoleIds(member: GuildMember): string[] {
  return member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => role.id);
}

/**
 * Roles of a user on a guild. `roleIds: null` — reliably not a member; `known: false` — could not tell.
 * The member cache is filled at startup and kept current by gateway events, so a miss in a complete
 * cache already means «not a member» and costs no request.
 */
async function lookupRoles(client: Client, guildId: string, userId: string): Promise<RoleLookup> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !guild.available) return { known: false };

  const cached = guild.members.cache.get(userId);
  if (cached) return { known: true, roleIds: memberRoleIds(cached) };
  if (guild.memberCount > 0 && guild.members.cache.size >= guild.memberCount) {
    return { known: true, roleIds: null };
  }
  try {
    return { known: true, roleIds: memberRoleIds(await guild.members.fetch(userId)) };
  } catch (error) {
    return isNotAMember(error) ? { known: true, roleIds: null } : { known: false };
  }
}

interface CpContext {
  incidentGuild: Guild;
  excludedRoleIds: readonly string[];
  logChannelId: string | null;
  maxKickPercent: number;
  dryRun: boolean;
  links: CpFactionLink[];
  managedTargetRoleIds: string[];
}

/** Settings and role links for one pass; null when sync is off or not configured. */
async function loadContext(client: Client, log: Logger): Promise<CpContext | null> {
  const config = await getCpSyncConfig();
  if (!config.enabled || !config.incidentGuildId) return null;

  const incidentGuild = client.guilds.cache.get(config.incidentGuildId);
  if (!incidentGuild || !incidentGuild.available) return null;

  const { links, managedTargetRoleIds } = await loadCpFactionLinks(config.incidentGuildId);
  if (links.length === 0 || managedTargetRoleIds.length === 0) {
    log.debug("cp sync: no faction/ЧП role links configured");
    return null;
  }
  return {
    incidentGuild,
    excludedRoleIds: config.excludedRoleIds,
    logChannelId: config.logChannelId,
    maxKickPercent: config.maxKickPercent,
    dryRun: config.dryRun,
    links,
    managedTargetRoleIds,
  };
}

async function planForMember(client: Client, ctx: CpContext, member: GuildMember): Promise<CpSyncPlan> {
  const memberships = new Map<string, string[]>();
  const unknownGuildIds: string[] = [];
  for (const guildId of new Set(ctx.links.map((link) => link.factionGuildDiscordId))) {
    const lookup = await lookupRoles(client, guildId, member.id);
    if (!lookup.known) unknownGuildIds.push(guildId);
    else memberships.set(guildId, lookup.roleIds ?? []);
  }
  return planCpSync({
    userDiscordId: member.id,
    isBot: member.user.bot,
    isOwner: member.id === ctx.incidentGuild.ownerId,
    excludedRoleIds: ctx.excludedRoleIds,
    incidentRoleIds: memberRoleIds(member),
    memberships,
    links: ctx.links,
    managedTargetRoleIds: ctx.managedTargetRoleIds,
    unknownGuildIds,
  });
}

async function logChannel(ctx: CpContext) {
  if (!ctx.logChannelId) return null;
  const channel = await ctx.incidentGuild.channels.fetch(ctx.logChannelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

async function sendMemberLog(ctx: CpContext, member: GuildMember, action: string, details: string, color: number) {
  try {
    const channel = await logChannel(ctx);
    if (!channel) return;
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

async function sendNotice(ctx: CpContext, text: string) {
  try {
    const channel = await logChannel(ctx);
    if (channel) await channel.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
  } catch {
    // Logging must never break sync.
  }
}

async function applyKick(ctx: CpContext, member: GuildMember, reason: string, log: Logger) {
  if (ctx.dryRun) {
    await sendMemberLog(
      ctx,
      member,
      "СУХОЙ ПРОГОН · KICK",
      "Был бы исключён: нет фракционных ролей. Изменения не выполнены.",
      COLOR_ERROR,
    );
    return;
  }
  try {
    await member
      .send("Доступ аннулирован. Вы исключены из сервера ЧП, так как не состоите ни в одной официальной фракции.")
      .catch(() => undefined);
    await member.kick("Автоматическая синхронизация: потеряны фракционные роли.");
    await writeAuditEvent({
      actorType: AuditActorType.BOT,
      source: "cp.sync",
      guildId: ctx.incidentGuild.id,
      action: "cp.member_kicked",
      entityType: "discord_guild_member",
      entityId: `${ctx.incidentGuild.id}:${member.id}`,
      after: { reason },
    });
    await sendMemberLog(
      ctx,
      member,
      "KICK",
      "**Причина:** Потеряны все фракционные роли.\nУчастник исключен из ЧП.",
      COLOR_ERROR,
    );
    log.info({ userId: member.id }, "cp sync kick");
  } catch (error) {
    log.error({ err: error, userId: member.id }, "cp sync kick failed");
  }
}

async function applyUpdate(
  ctx: CpContext,
  member: GuildMember,
  plan: Extract<CpSyncPlan, { kind: "update" }>,
  log: Logger,
) {
  const resolve = (ids: string[]) =>
    ids
      .map((id) => ctx.incidentGuild.roles.cache.get(id))
      .filter((role): role is NonNullable<typeof role> => Boolean(role));
  const toAdd = resolve(plan.addRoleIds);
  const toRemove = resolve(plan.removeRoleIds);
  if (toAdd.length === 0 && toRemove.length === 0) return;

  const lines: string[] = [];
  if (toAdd.length) lines.push(`**Выданы роли:** ${toAdd.map((role) => role.toString()).join(", ")}`);
  if (toRemove.length) lines.push(`**Сняты роли:** ${toRemove.map((role) => role.toString()).join(", ")}`);

  if (ctx.dryRun) {
    await sendMemberLog(
      ctx,
      member,
      "СУХОЙ ПРОГОН · UPDATE",
      `${lines.join("\n")}\nИзменения не выполнены.`,
      COLOR_SUCCESS,
    );
    return;
  }
  try {
    if (toAdd.length) await member.roles.add(toAdd, "Синхронизация ЧП");
    if (toRemove.length) await member.roles.remove(toRemove, "Синхронизация ЧП");
    await writeAuditEvent({
      actorType: AuditActorType.BOT,
      source: "cp.sync",
      guildId: ctx.incidentGuild.id,
      action: "cp.roles_updated",
      entityType: "discord_guild_member",
      entityId: `${ctx.incidentGuild.id}:${member.id}`,
      after: { added: toAdd.map((role) => role.id), removed: toRemove.map((role) => role.id) },
    });
    await sendMemberLog(ctx, member, "UPDATE", lines.join("\n"), COLOR_SUCCESS);
    log.info({ userId: member.id, added: toAdd.length, removed: toRemove.length }, "cp sync update");
  } catch (error) {
    log.error({ err: error, userId: member.id }, "cp sync role update failed");
  }
}

/** Re-evaluates one user after a role or membership event. */
export async function evaluateMemberCpAccess(client: Client, userDiscordId: string, log: Logger): Promise<void> {
  const ctx = await loadContext(client, log);
  if (!ctx) return;

  const lookup = await lookupRoles(client, ctx.incidentGuild.id, userDiscordId);
  if (!lookup.known || lookup.roleIds === null) return;
  const member = ctx.incidentGuild.members.cache.get(userDiscordId);
  if (!member) return;

  const plan = await planForMember(client, ctx, member);
  if (plan.kind === "skip" && plan.reason === "membership_unknown") {
    log.warn({ userId: userDiscordId }, "cp sync: membership could not be read, member left as is");
  }
  if (plan.kind === "kick") await applyKick(ctx, member, plan.reason, log);
  else if (plan.kind === "update") await applyUpdate(ctx, member, plan, log);
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

/**
 * Reconciles every member of the incident guild (at startup and hourly).
 * All plans are computed first, so the pass can refuse to kick when the number looks wrong.
 */
export async function reconcileCpAccess(client: Client, log: Logger) {
  const ctx = await loadContext(client, log);
  if (!ctx) return;
  const guild = ctx.incidentGuild;

  // After startup sync the cache is usually warm — avoid a second opcode-8 fetch that rate-limits.
  const members = guild.members.cache.size > 1 ? guild.members.cache : await fetchGuildMembersWithRetry(guild, log);
  const humans = [...members.values()].filter((member) => !member.user.bot);

  const kicks: GuildMember[] = [];
  const updates: Array<{ member: GuildMember; plan: Extract<CpSyncPlan, { kind: "update" }> }> = [];
  let unknown = 0;
  for (const member of humans) {
    const plan = await planForMember(client, ctx, member);
    if (plan.kind === "kick") kicks.push(member);
    else if (plan.kind === "update") updates.push({ member, plan });
    else if (plan.kind === "skip" && plan.reason === "membership_unknown") unknown += 1;
  }

  const limit = cpKickLimit(humans.length, ctx.maxKickPercent);
  const held = kicks.length > limit;
  if (held) {
    log.error({ kicks: kicks.length, limit, members: humans.length }, "cp sync: kick limit exceeded, kicks held back");
    await writeAuditEvent({
      actorType: AuditActorType.BOT,
      source: "cp.sync",
      guildId: guild.id,
      action: "cp.kicks_held",
      entityType: "guild",
      entityId: guild.id,
      after: { wouldKick: kicks.length, limit, members: humans.length, maxKickPercent: ctx.maxKickPercent },
    });
    await sendNotice(
      ctx,
      [
        `⚠️ **Синхронизация ЧП остановила исключения.** Сверка хочет исключить ${kicks.length} из ${humans.length} участников — это больше предела (${limit}).`,
        "Никто не исключён. Проверьте привязки ролей и доступность серверов фракций; предел меняется в настройках синхронизации.",
        `Первые в списке: ${kicks.slice(0, 15).map((member) => member.toString()).join(", ")}`,
      ].join("\n"),
    );
  } else {
    for (const member of kicks) await applyKick(ctx, member, "no_faction_roles", log);
  }
  for (const { member, plan } of updates) await applyUpdate(ctx, member, plan, log);

  if (unknown > 0) {
    log.warn({ unknown }, "cp sync: members skipped because a faction guild could not be read");
  }
  log.info(
    {
      processed: humans.length,
      kicks: held ? 0 : kicks.length,
      kicksHeld: held ? kicks.length : 0,
      updates: updates.length,
      unknown,
      dryRun: ctx.dryRun,
      guildId: guild.id,
    },
    "cp sync reconcile done",
  );
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
