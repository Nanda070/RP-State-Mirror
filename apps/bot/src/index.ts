import { hostname } from "node:os";
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type Interaction,
  type Role,
} from "discord.js";
import { AuditActorType, prisma } from "@mirror/db";
import {
  BOT_SERVICE,
  HEARTBEAT_INTERVAL_MS,
  archiveOldAuditLog,
  claimOverdueFines,
  closeRegistrationsOfLeavers,
  enableReadCache,
  onJobEnqueued,
  enableSettingsCache,
  botEnvSchema,
  createLogger,
  expireDocuments,
  expireIcBlacklistEntries,
  expirePendingRegistrations,
  expirePendingTransfers,
  expireRegistrations,
  getSetting,
  markGuildUnavailable,
  markMemberLeft,
  migrateLegacyRegistrationChannels,
  parseEnv,
  recordHeartbeat,
  recordPresenceChanges,
  replacePresenceSnapshot,
  setSetting,
  syncGuildChannels,
  toPresenceStatus,
  type PresenceStatus,
  syncGuildRoles,
  upsertGuild,
  upsertMember,
} from "@mirror/core";
import { handleButtonInteraction, handleModalSubmit, handleSelectInteraction } from "./buttons.js";
import { evaluateMemberCpAccess, isCpRelevantGuild, reconcileCpAccess } from "./cp-sync.js";
import { refusalFor, refuse, reportError } from "./guard.js";
import { jobHandlers } from "./handlers.js";
import { DOSSIER_COMMAND_NAME, handleDossierCommand, handleProfileCommand } from "./player-card.js";
import { handleFactionAutocomplete, handleSlashCommand } from "./slash.js";
import { guildChannels, guildRoles, toGuildSnapshot, toMemberSnapshot } from "./snapshot.js";
import { syncAllGuilds, syncGuild } from "./sync.js";
import { JobWorker } from "./worker.js";

const RECONCILE_INTERVAL_MS = 60 * 60_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;

const BOT_ACTIVITY = "GTA5RP Mirror";

const env = parseEnv(botEnvSchema);
// Commands read the same settings on every interaction: remember them for a few seconds.
enableSettingsCache();
enableReadCache();
const log = createLogger("bot", env.LOG_LEVEL);

// «В сети» in the profile needs the privileged presence intent; it is switched on in the dashboard.
// A change of the switch restarts the bot (see `beat`), because intents are fixed at login.
const presenceEnabled = await getSetting("presence.enabled").catch(() => false);
const PRESENCE_FLUSH_MS = 5_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    ...(presenceEnabled ? [GatewayIntentBits.GuildPresences] : []),
  ],
  partials: [Partials.GuildMember],
  // Shown under the bot's name in Discord: «Играет в GTA5RP Mirror».
  presence: { status: "online", activities: [{ name: BOT_ACTIVITY, type: ActivityType.Playing }] },
});

const worker = new JobWorker(client, jobHandlers, log.child({ component: "worker" }), `${hostname()}:${process.pid}`, {
  onPermanentFailure: (job, error) => void reportError(client, `задача ${job.type} (${job.id})`, error, log),
});
let reconcileTimer: NodeJS.Timeout | undefined;
let maintenanceTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;

/** How many registrations the last «left the faction» pass held back; a repeat is not reported again. */
let heldLeaverRegistrations = 0;

/** Time-based status transitions; side effects (card edits, DMs) go through jobs. */
async function runMaintenance() {
  const [registrations, documents, blacklist, unreviewedRegistrations, unreviewedTransfers] = await Promise.all([
    expireRegistrations(),
    expireDocuments(),
    expireIcBlacklistEntries(),
    expirePendingRegistrations(),
    expirePendingTransfers(),
  ]);
  const leavers = await closeRegistrationsOfLeavers();
  if (leavers.closed > 0) log.info({ closed: leavers.closed }, "maintenance: registrations of people who left their faction closed");
  if (leavers.held > 0 && leavers.held !== heldLeaverRegistrations) {
    log.warn({ held: leavers.held }, "maintenance: too many registrations to close at once — nothing was closed");
    void reportError(
      client,
      "снятие регистраций при уходе из фракции",
      new Error(
        `Проверка хочет снять ${leavers.held} регистраций сразу — это больше предела. Ничего не снято. ` +
          "Если люди действительно ушли, поднимите предел в «Модули → Регистрации»; если нет — проверьте снимок серверов.",
      ),
      log,
    );
  }
  heldLeaverRegistrations = leavers.held;
  const overdueFines = await claimOverdueFines();
  if (overdueFines > 0) log.info({ overdueFines }, "maintenance: overdue fine notices queued");
  // Old audit rows move to the archive table a batch at a time; a backlog drains over several runs.
  const archived = await archiveOldAuditLog();
  if (archived > 0) log.info({ archived }, "maintenance: audit rows archived");
  if (registrations + documents + blacklist + unreviewedRegistrations + unreviewedTransfers > 0) {
    log.info(
      { registrations, documents, blacklist, unreviewedRegistrations, unreviewedTransfers },
      "maintenance: records expired",
    );
  }
}

function guarded(name: string, fn: () => Promise<unknown>) {
  fn().catch((error: unknown) => {
    log.error({ err: error, event: name }, "event handler failed");
    void reportError(client, name, error, log);
  });
}

/** Sign of life for the status page and the «bot is down» alert. */
function beat() {
  recordHeartbeat(BOT_SERVICE, {
    guilds: client.guilds.cache.size,
    pingMs: Math.round(client.ws.ping),
    presence: presenceEnabled,
  }).catch((error: unknown) => log.warn({ err: error }, "heartbeat was not recorded"));
  // The presence switch was changed in the dashboard: reconnect with the other set of intents.
  getSetting("presence.enabled")
    .then((wanted) => {
      if (wanted === presenceEnabled || shuttingDown) return;
      log.info({ presence: wanted }, "presence setting changed — restarting to reconnect with the new intents");
      process.exitCode = 1;
      void shutdown("presence setting changed");
    })
    .catch(() => undefined);
}

// Discord sends a presence update for every guild the person shares with the bot and for every
// change of activity; only a change of status is kept, and the writes go out in batches.
const pendingPresence = new Map<string, PresenceStatus>();
let presenceTimer: NodeJS.Timeout | undefined;

function flushPresence() {
  if (pendingPresence.size === 0) return;
  const batch = new Map(pendingPresence);
  pendingPresence.clear();
  guarded("presenceFlush", () => recordPresenceChanges(batch));
}

/** Everyone the bot sees online right now; the rest are offline. */
function snapshotPresence() {
  if (!presenceEnabled) return;
  const visible = new Map<string, PresenceStatus>();
  for (const guild of client.guilds.cache.values()) {
    for (const presence of guild.presences.cache.values()) {
      if (presence.user?.bot) continue;
      const status = toPresenceStatus(presence.status);
      // A person online in one guild and idle in another: online wins.
      if (status === "online" || !visible.has(presence.userId)) visible.set(presence.userId, status);
    }
  }
  guarded("presenceSnapshot", async () => {
    const written = await replacePresenceSnapshot(visible);
    log.info({ visible: visible.size, written }, "presence snapshot stored");
  });
}

if (presenceEnabled) {
  client.on(Events.PresenceUpdate, (before, after) => {
    if (after.user?.bot) return;
    const status = toPresenceStatus(after.status);
    if (before && toPresenceStatus(before.status) === status) return;
    pendingPresence.set(after.userId, status);
  });
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
    // A command or a button of this bot queued a job: run it now, not at the next poll.
    // The short delay lets the transaction that created the job commit.
    onJobEnqueued(() => void setTimeout(() => worker.wake(), 200));
    beat();
    heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    if (presenceEnabled) {
      snapshotPresence();
      presenceTimer = setInterval(flushPresence, PRESENCE_FLUSH_MS);
    }
    reconcileTimer = setInterval(
      () =>
        guarded("reconcile", async () => {
          await syncAllGuilds(ready, log);
          await reconcileCpAccess(ready, log.child({ component: "cp-sync" }));
          snapshotPresence();
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

client.on(Events.ShardResume, () => {
  client.user?.setPresence({ status: "online", activities: [{ name: BOT_ACTIVITY, type: ActivityType.Playing }] });
});

process.on("unhandledRejection", (error) => {
  log.error({ err: error }, "unhandledRejection");
  void reportError(client, "unhandledRejection", error, log);
});
process.on("uncaughtException", (error) => {
  // After an uncaught exception the process state is unknown: stop cleanly and let the supervisor
  // (Docker restart policy) start a fresh one, instead of limping on.
  log.fatal({ err: error }, "uncaughtException — shutting down");
  process.exitCode = 1;
  void shutdown("uncaughtException");
});

client.on(Events.InteractionCreate, (interaction) => {
  guarded("interaction", async () => {
    // Lockdown and technical bans are checked once, before any command, button, modal or list.
    const refusal = await refusalFor(interaction.user.id, env.SUPER_ADMIN_USER_IDS, log);
    if (refusal) {
      await refuse(interaction, refusal);
      return;
    }
    routeInteraction(interaction);
  });
});

function routeInteraction(interaction: Interaction) {
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
  const cardContext = () => ({
    superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    log: log.child({ component: "player-card", command: interaction.isCommand() ? interaction.commandName : "" }),
  });
  if (interaction.isUserContextMenuCommand()) {
    if (interaction.commandName === DOSSIER_COMMAND_NAME) {
      guarded("dossier", () => handleDossierCommand(interaction, cardContext()));
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "профиль") {
    guarded("profile", () => handleProfileCommand(interaction, cardContext()));
    return;
  }
  guarded("interactionCreate", () =>
    handleSlashCommand(interaction, {
      superAdminUserIds: env.SUPER_ADMIN_USER_IDS,
      log: log.child({ component: "slash", command: interaction.commandName }),
    }),
  );
}

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

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  clearInterval(reconcileTimer);
  clearInterval(maintenanceTimer);
  clearInterval(heartbeatTimer);
  clearInterval(presenceTimer);
  flushPresence();
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
  if (message.includes("disallowed intents") && presenceEnabled) {
    // The presence intent is not switched on in the Developer Portal: turn the feature off, so the
    // bot comes back without it (systemd starts it again), and leave the reason in the audit log.
    log.fatal("Discord rejected the presence intent: enable PRESENCE INTENT in the Developer Portal; «в сети» is switched off");
    await setSetting("presence.enabled", false, {
      actorType: AuditActorType.SYSTEM,
      source: "bot.presence_intent_rejected",
    }).catch((settingError: unknown) => log.error({ err: settingError }, "could not switch presence off"));
  } else if (message.includes("disallowed intents")) {
    log.fatal("Discord rejected the intents: enable SERVER MEMBERS INTENT for the bot in the Developer Portal");
  } else {
    log.fatal({ err: error }, "failed to log in to Discord");
  }
  await prisma.$disconnect();
  process.exit(1);
}
