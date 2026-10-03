import { hostname } from "node:os";
import { Client, Events, GatewayIntentBits, Partials, type Guild, type Role } from "discord.js";
import { prisma } from "@mirror/db";
import {
  botEnvSchema,
  createLogger,
  expireDocuments,
  expireIcBlacklistEntries,
  expirePendingRegistrations,
  expirePendingTransfers,
  expireRegistrations,
  markGuildUnavailable,
  markMemberLeft,
  migrateLegacyRegistrationChannels,
  parseEnv,
  syncGuildChannels,
  syncGuildRoles,
  upsertGuild,
  upsertMember,
} from "@mirror/core";
import { handleButtonInteraction, handleModalSubmit, handleSelectInteraction } from "./buttons.js";
import { evaluateMemberCpAccess, isCpRelevantGuild, reconcileCpAccess } from "./cp-sync.js";
import { jobHandlers } from "./handlers.js";
import { handleFactionAutocomplete, handleSlashCommand } from "./slash.js";
import { guildChannels, guildRoles, toGuildSnapshot, toMemberSnapshot } from "./snapshot.js";
import { syncAllGuilds, syncGuild } from "./sync.js";
import { JobWorker } from "./worker.js";

const RECONCILE_INTERVAL_MS = 60 * 60_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;

const env = parseEnv(botEnvSchema);
const log = createLogger("bot", env.LOG_LEVEL);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

const worker = new JobWorker(client, jobHandlers, log.child({ component: "worker" }), `${hostname()}:${process.pid}`);
let reconcileTimer: NodeJS.Timeout | undefined;
let maintenanceTimer: NodeJS.Timeout | undefined;

/** Time-based status transitions; side effects (card edits, DMs) go through jobs. */
async function runMaintenance() {
  const [registrations, documents, blacklist, unreviewedRegistrations, unreviewedTransfers] = await Promise.all([
    expireRegistrations(),
    expireDocuments(),
    expireIcBlacklistEntries(),
    expirePendingRegistrations(),
    expirePendingTransfers(),
  ]);
  if (registrations + documents + blacklist + unreviewedRegistrations + unreviewedTransfers > 0) {
    log.info(
      { registrations, documents, blacklist, unreviewedRegistrations, unreviewedTransfers },
      "maintenance: records expired",
    );
  }
}

function guarded(name: string, fn: () => Promise<unknown>) {
  fn().catch((error: unknown) => log.error({ err: error, event: name }, "event handler failed"));
}

client.once(Events.ClientReady, (ready) => {
  log.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, "connected to Discord");
  guarded("ready", async () => {
    await migrateLegacyRegistrationChannels();
    await syncAllGuilds(ready, log);
    const { ALL_COMMANDS, registerCommands } = await import("./commands.js");
    await registerCommands(env.DISCORD_BOT_TOKEN, env.DISCORD_CLIENT_ID);
    log.info({ commands: ALL_COMMANDS.length }, "slash commands registered");
    worker.start();
    reconcileTimer = setInterval(
      () =>
        guarded("reconcile", async () => {
          await syncAllGuilds(ready, log);
          await reconcileCpAccess(ready, log.child({ component: "cp-sync" }));
        }),
      RECONCILE_INTERVAL_MS,
    );
    // Defer CP reconcile so it can reuse the warm member cache from syncAllGuilds.
    setTimeout(
      () => guarded("cp-reconcile-initial", () => reconcileCpAccess(ready, log.child({ component: "cp-sync" }))),
      5_000,
    );
    maintenanceTimer = setInterval(() => guarded("maintenance", runMaintenance), MAINTENANCE_INTERVAL_MS);
    guarded("maintenance-initial", runMaintenance);
  });
});

process.on("unhandledRejection", (error) => {
  log.error({ err: error }, "unhandledRejection");
});
process.on("uncaughtException", (error) => {
  // After an uncaught exception the process state is unknown: stop cleanly and let the supervisor
  // (Docker restart policy) start a fresh one, instead of limping on.
  log.fatal({ err: error }, "uncaughtException — shutting down");
  process.exitCode = 1;
  void shutdown("uncaughtException");
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isAutocomplete()) {
    guarded("autocomplete", () => handleFactionAutocomplete(interaction));
    return;
  }
  if (interaction.isButton()) {
    guarded("button", () =>
      handleButtonInteraction(interaction, {
        client,
        superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
        publicBaseUrl: env.PUBLIC_BASE_URL,
        log: log.child({ component: "buttons" }),
      }),
    );
    return;
  }
  if (interaction.isStringSelectMenu()) {
    guarded("select", () =>
      handleSelectInteraction(interaction, {
        client,
        superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
        publicBaseUrl: env.PUBLIC_BASE_URL,
        log: log.child({ component: "selects" }),
      }),
    );
    return;
  }
  if (interaction.isModalSubmit()) {
    guarded("modalSubmit", () =>
      handleModalSubmit(interaction, {
        client,
        superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
        publicBaseUrl: env.PUBLIC_BASE_URL,
        log: log.child({ component: "modals" }),
      }),
    );
    return;
  }
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
  if (!guild.available) return;
  guarded("guildDelete", () => markGuildUnavailable(guild.id));
});

const RESYNC_DEBOUNCE_MS = 2_000;
const pendingResyncs = new Map<string, NodeJS.Timeout>();

/**
 * Moving one role or channel makes Discord send an update for every item whose position shifted.
 * Each used to trigger a full resync of the guild; now a burst collapses into one resync per guild.
 */
function debounceResync(kind: "roles" | "channels", guild: Guild) {
  const key = `${kind}:${guild.id}`;
  clearTimeout(pendingResyncs.get(key));
  pendingResyncs.set(
    key,
    setTimeout(() => {
      pendingResyncs.delete(key);
      guarded(`${kind}Resync`, () =>
        kind === "roles"
          ? syncGuildRoles(guild.id, guildRoles(guild))
          : syncGuildChannels(guild.id, guildChannels(guild)),
      );
    }, RESYNC_DEBOUNCE_MS),
  );
}

function resyncRoles(_event: string, role: Role) {
  debounceResync("roles", role.guild);
}
client.on(Events.GuildRoleCreate, (role) => resyncRoles("guildRoleCreate", role));
client.on(Events.GuildRoleUpdate, (_old, role) => resyncRoles("guildRoleUpdate", role));
client.on(Events.GuildRoleDelete, (role) => resyncRoles("guildRoleDelete", role));

client.on(Events.ChannelCreate, (channel) => {
  if (!channel.isDMBased() && channel.guild) {
    debounceResync("channels", channel.guild);
  }
});
client.on(Events.ChannelUpdate, (_old, channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  debounceResync("channels", channel.guild);
});
client.on(Events.ChannelDelete, (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  debounceResync("channels", channel.guild);
});

client.on(Events.GuildMemberAdd, (member) => {
  if (member.user.bot) return;
  guarded("guildMemberAdd", async () => {
    await upsertMember(member.guild.id, toMemberSnapshot(member));
    if (await isCpRelevantGuild(member.guild.id)) {
      await evaluateMemberCpAccess(client, member.id, log.child({ component: "cp-sync" }));
    }
  });
});
client.on(Events.GuildMemberUpdate, (_old, member) => {
  if (member.user.bot) return;
  guarded("guildMemberUpdate", async () => {
    await upsertMember(member.guild.id, toMemberSnapshot(member));
    if (await isCpRelevantGuild(member.guild.id)) {
      await evaluateMemberCpAccess(client, member.id, log.child({ component: "cp-sync" }));
    }
  });
});
client.on(Events.GuildMemberRemove, (member) =>
  guarded("guildMemberRemove", async () => {
    await markMemberLeft(member.guild.id, member.id);
    if (await isCpRelevantGuild(member.guild.id)) {
      await evaluateMemberCpAccess(client, member.id, log.child({ component: "cp-sync" }));
    }
  }),
);

client.on(Events.Error, (error) => log.error({ err: error }, "discord client error"));

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  clearInterval(reconcileTimer);
  clearInterval(maintenanceTimer);
  for (const timer of pendingResyncs.values()) clearTimeout(timer);
  await worker.stop();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0);
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
