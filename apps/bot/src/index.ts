import { hostname } from "node:os";
import { Client, Events, GatewayIntentBits, Partials, type Role } from "discord.js";
import { prisma } from "@mirror/db";
import {
  botEnvSchema,
  createLogger,
  markGuildUnavailable,
  markMemberLeft,
  parseEnv,
  syncGuildRoles,
  upsertGuild,
  upsertMember,
} from "@mirror/core";
import { jobHandlers } from "./handlers.js";
import { handleSlashCommand } from "./slash.js";
import { guildRoles, toGuildSnapshot, toMemberSnapshot } from "./snapshot.js";
import { syncAllGuilds, syncGuild } from "./sync.js";
import { JobWorker } from "./worker.js";

const RECONCILE_INTERVAL_MS = 60 * 60_000;

const env = parseEnv(botEnvSchema);
const log = createLogger("bot", env.LOG_LEVEL);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

const worker = new JobWorker(client, jobHandlers, log.child({ component: "worker" }), `${hostname()}:${process.pid}`);
let reconcileTimer: NodeJS.Timeout | undefined;

function guarded(name: string, fn: () => Promise<unknown>) {
  fn().catch((error: unknown) => log.error({ err: error, event: name }, "event handler failed"));
}

client.once(Events.ClientReady, (ready) => {
  log.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, "connected to Discord");
  guarded("ready", async () => {
    await syncAllGuilds(ready, log);
    const { registerCommands } = await import("./commands.js");
    await registerCommands(env.DISCORD_BOT_TOKEN, env.DISCORD_CLIENT_ID);
    log.info({ commands: 7 }, "slash commands registered");
    worker.start();
    reconcileTimer = setInterval(() => guarded("reconcile", () => syncAllGuilds(ready, log)), RECONCILE_INTERVAL_MS);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  guarded("interactionCreate", () =>
    handleSlashCommand(interaction, {
      superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
      log: log.child({ component: "slash", command: interaction.commandName }),
    }),
  );
});

client.on(Events.GuildCreate, (guild) => guarded("guildCreate", () => syncGuild(guild, log)));
client.on(Events.GuildUpdate, (_old, guild) => guarded("guildUpdate", () => upsertGuild(toGuildSnapshot(guild))));
client.on(Events.GuildDelete, (guild) => {
  // An unavailable guild is a Discord outage, not a removal.
  if (!guild.available) return;
  guarded("guildDelete", () => markGuildUnavailable(guild.id));
});

function resyncRoles(event: string, role: Role) {
  guarded(event, () => syncGuildRoles(role.guild.id, guildRoles(role.guild)));
}
client.on(Events.GuildRoleCreate, (role) => resyncRoles("guildRoleCreate", role));
client.on(Events.GuildRoleUpdate, (_old, role) => resyncRoles("guildRoleUpdate", role));
client.on(Events.GuildRoleDelete, (role) => resyncRoles("guildRoleDelete", role));

client.on(Events.GuildMemberAdd, (member) => {
  if (member.user.bot) return;
  guarded("guildMemberAdd", () => upsertMember(member.guild.id, toMemberSnapshot(member)));
});
client.on(Events.GuildMemberUpdate, (_old, member) => {
  if (member.user.bot) return;
  guarded("guildMemberUpdate", () => upsertMember(member.guild.id, toMemberSnapshot(member)));
});
client.on(Events.GuildMemberRemove, (member) =>
  guarded("guildMemberRemove", () => markMemberLeft(member.guild.id, member.id)),
);

client.on(Events.Error, (error) => log.error({ err: error }, "discord client error"));

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  clearInterval(reconcileTimer);
  await worker.stop();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await client.login(env.DISCORD_BOT_TOKEN);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("disallowed intents")) {
    log.fatal("Discord rejected the intents: enable SERVER MEMBERS INTENT for the bot in the Developer Portal");
  } else {
    log.fatal({ err: error }, "failed to log in to Discord");
  }
  await prisma.$disconnect();
  process.exit(1);
}
