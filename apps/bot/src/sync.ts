import type { Client, Guild } from "discord.js";
import {
  markAbsentGuildsUnavailable,
  reconcileGuildMembers,
  syncGuildChannels,
  syncGuildRoles,
  upsertGuild,
  type Logger,
} from "@mirror/core";
import { guildChannels, guildRoles, toGuildSnapshot, toMemberSnapshot } from "./snapshot.js";

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

export async function syncGuild(guild: Guild, log: Logger) {
  await upsertGuild(toGuildSnapshot(guild));
  await syncGuildRoles(guild.id, guildRoles(guild));
  await syncGuildChannels(guild.id, guildChannels(guild));
  const members = await fetchGuildMembersWithRetry(guild, log);
  const result = await reconcileGuildMembers(
    guild.id,
    members.filter((member) => !member.user.bot).map(toMemberSnapshot),
  );
  log.info({ guildId: guild.id, guild: guild.name, ...result }, "guild synced");
}

export async function syncAllGuilds(client: Client, log: Logger) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncGuild(guild, log);
    } catch (error) {
      log.error({ err: error, guildId: guild.id }, "guild sync failed");
    }
    // Brief pause between guild opcode-8 fetches to reduce gateway rate limits.
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  // Guilds in an outage stay in the cache as unavailable, so a guild missing from it is one the
  // bot is no longer on.
  try {
    const gone = await markAbsentGuildsUnavailable([...client.guilds.cache.keys()]);
    if (gone.length > 0) log.warn({ guildIds: gone }, "guilds the bot is no longer on were archived");
  } catch (error) {
    log.error({ err: error }, "absent guilds were not archived");
  }
}
