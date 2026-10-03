import type { Client, Guild } from "discord.js";
import {
  reconcileGuildMembers,
  syncGuildChannels,
  syncGuildRoles,
  upsertGuild,
  type Logger,
} from "@mirror/core";
import { guildChannels, guildRoles, toGuildSnapshot, toMemberSnapshot } from "./snapshot.js";

export async function syncGuild(guild: Guild, log: Logger) {
  await upsertGuild(toGuildSnapshot(guild));
  await syncGuildRoles(guild.id, guildRoles(guild));
  await syncGuildChannels(guild.id, guildChannels(guild));
  const members = await guild.members.fetch();
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
  }
}
