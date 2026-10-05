import { prisma } from "@mirror/db";
import { getBotHeartbeat, isHeartbeatFresh } from "./monitoring.js";
import { getSetting } from "./settings.js";

/**
 * «В сети» in the profile. With `presence.enabled` the bot connects with the privileged presence
 * intent and writes every change of a person's Discord status here; the site only reads.
 */
export const PRESENCE_STATUSES = ["online", "idle", "dnd", "offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export function toPresenceStatus(raw: string | null | undefined): PresenceStatus {
  return (PRESENCE_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as PresenceStatus) : "offline";
}

const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK) result.push(items.slice(index, index + CHUNK));
  return result;
}

/** Writes statuses that changed. The moment of a change is the last time the person was seen online. */
export async function recordPresenceChanges(
  changes: ReadonlyMap<string, PresenceStatus>,
  now = new Date(),
): Promise<number> {
  if (changes.size === 0) return 0;
  const ids = [...changes.keys()];
  const known = new Map<string, string>();
  for (const part of chunks(ids)) {
    const rows = await prisma.userPresence.findMany({ where: { discordId: { in: part } }, select: { discordId: true, status: true } });
    for (const row of rows) known.set(row.discordId, row.status);
  }
  const fresh = ids.filter((id) => !known.has(id));
  for (const part of chunks(fresh)) {
    await prisma.userPresence.createMany({
      data: part.map((discordId) => {
        const status = changes.get(discordId) ?? "offline";
        return { discordId, status, lastOnlineAt: status === "offline" ? null : now };
      }),
      skipDuplicates: true,
    });
  }
  // One update per status for everyone whose status moved to it.
  const moved = new Map<PresenceStatus, string[]>();
  for (const [discordId, status] of changes) {
    const before = known.get(discordId);
    if (before === undefined || before === status) continue;
    moved.set(status, [...(moved.get(status) ?? []), discordId]);
  }
  let written = fresh.length;
  for (const [status, members] of moved) {
    for (const part of chunks(members)) {
      const result = await prisma.userPresence.updateMany({
        where: { discordId: { in: part } },
        data: { status, lastOnlineAt: now },
      });
      written += result.count;
    }
  }
  return written;
}

/**
 * The full picture after a (re)connect: everyone the bot sees online is written as such, and
 * everyone else who was online is now offline (Discord only lists members who are not offline).
 */
export async function replacePresenceSnapshot(
  visible: ReadonlyMap<string, PresenceStatus>,
  now = new Date(),
): Promise<number> {
  const written = await recordPresenceChanges(visible, now);
  const online = [...visible].filter(([, status]) => status !== "offline").map(([discordId]) => discordId);
  const gone = await prisma.userPresence.updateMany({
    where: { status: { not: "offline" }, ...(online.length > 0 ? { discordId: { notIn: online } } : {}) },
    data: { status: "offline", lastOnlineAt: now },
  });
  return written + gone.count;
}

export type PresenceView = { status: PresenceStatus; lastOnlineAt: Date | null };

/**
 * A person's status for the profile, or null when it cannot be told: the feature is off, the bot
 * is not connected with the presence intent, or the bot has not been heard from lately.
 */
export async function getPresence(discordId: string, now = Date.now()): Promise<PresenceView | null> {
  const [enabled, heartbeat] = await Promise.all([getSetting("presence.enabled"), getBotHeartbeat()]);
  if (!enabled || !heartbeat || !isHeartbeatFresh(heartbeat.at, now)) return null;
  const meta = (heartbeat.meta ?? {}) as { presence?: unknown };
  if (meta.presence !== true) return null;
  const row = await prisma.userPresence.findUnique({ where: { discordId } });
  return row ? { status: toPresenceStatus(row.status), lastOnlineAt: row.lastOnlineAt } : { status: "offline", lastOnlineAt: null };
}
