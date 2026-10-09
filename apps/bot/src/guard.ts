/**
 * Gate in front of every interaction: emergency lockdown and technical bans.
 * Super admins pass both, so they can always get in and switch the lockdown off.
 */
import { MessageFlags, type Client, type Interaction } from "discord.js";
import {
  TECH_BAN_MESSAGE,
  findActiveTechBan,
  listActiveDiscordBanIds,
  getLockdownCached,
  getSetting,
  lockdownText,
  type Logger,
} from "@mirror/core";

/**
 * Banned Discord accounts, in memory: the check before every interaction does not touch the
 * database. The list is reloaded when bans change (`bans` notification) and every 15 seconds anyway;
 * until the first load succeeds, each person is looked up directly.
 */
const BAN_RELOAD_MS = 15_000;
let bannedIds: Set<string> | null = null;
let bansLoadedAt = 0;
let bansLoading: Promise<void> | null = null;

export function reloadBans(log?: Logger): Promise<void> {
  bansLoading ??= listActiveDiscordBanIds()
    .then((ids) => {
      bannedIds = new Set(ids);
      bansLoadedAt = Date.now();
    })
    .catch((error: unknown) => log?.warn({ err: error }, "ban list was not reloaded"))
    .finally(() => {
      bansLoading = null;
    });
  return bansLoading;
}

async function isBanned(discordId: string): Promise<boolean> {
  if (!bannedIds) return Boolean(await findActiveTechBan({ discordId }));
  if (Date.now() - bansLoadedAt > BAN_RELOAD_MS) void reloadBans();
  return bannedIds.has(discordId);
}

/**
 * Returns the refusal text when the user may not use the bot right now, or null to proceed.
 * If the check itself fails (database down) the interaction is let through: the handler will
 * report its own error, and a broken check must not lock everyone out.
 */
export async function refusalFor(discordId: string, superAdminUserIds: readonly string[], log: Logger) {
  if (superAdminUserIds.includes(discordId)) return null;
  try {
    const lockdown = await getLockdownCached();
    if (lockdown.enabled) return lockdownText(lockdown);
    if (await isBanned(discordId)) return TECH_BAN_MESSAGE;
  } catch (error) {
    log.warn({ err: error }, "access gate check failed; letting the interaction through");
  }
  return null;
}

/** Answers a refused interaction. Autocomplete gets an empty list — it cannot show a message. */
export async function refuse(interaction: Interaction, text: string) {
  try {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
    } else if (interaction.isRepliable()) {
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // The interaction expired or was already answered.
  }
}

const REPORT_INTERVAL_MS = 30_000;
let lastReportAt = 0;
let suppressed = 0;

/**
 * Posts a bot error to the service channel from settings (`monitoring.errorChannelId`).
 * At most one message per 30 seconds; the rest are counted and mentioned in the next one,
 * so an error storm cannot flood the channel or hit Discord rate limits.
 */
export async function reportError(client: Client, where: string, error: unknown, log: Logger) {
  const now = Date.now();
  if (now - lastReportAt < REPORT_INTERVAL_MS) {
    suppressed += 1;
    return;
  }
  try {
    const channelId = await getSetting("monitoring.errorChannelId");
    if (!channelId || !client.isReady()) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    lastReportAt = now;
    const skipped = suppressed;
    suppressed = 0;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await channel.send({
      content: [
        `⚠️ **Ошибка бота** · ${where}`,
        `\`\`\`${message.slice(0, 1500)}\`\`\``,
        skipped > 0 ? `И ещё ${skipped} ошибок за последние 30 секунд — см. лог бота.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      allowedMentions: { parse: [] },
    });
  } catch (reportFailure) {
    log.warn({ err: reportFailure }, "could not post the error to the service channel");
  }
}
