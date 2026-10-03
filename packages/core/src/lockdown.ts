/**
 * Emergency lockdown (§6). While it is on, everything people interact with is closed for everyone
 * except super admins: slash commands, buttons, modals, the dashboard and public forms.
 * Background work (ЧП sync, the job queue, expiry) keeps running — that was the owner's decision.
 */
import { getSetting, setSetting } from "./settings.js";
import type { AuditContext } from "./audit.js";

export const LOCKDOWN_MESSAGE = "Сервис временно недоступен: идут технические работы. Попробуйте позже.";

export interface Lockdown {
  enabled: boolean;
  reason: string;
  byDiscordId: string | null;
  at: string | null;
}

export function getLockdown(): Promise<Lockdown> {
  return getSetting("system.lockdown");
}

export async function setLockdown(
  input: { enabled: boolean; reason?: string | null; actorDiscordId: string | null },
  context: AuditContext,
): Promise<Lockdown> {
  return setSetting(
    "system.lockdown",
    {
      enabled: input.enabled,
      reason: input.enabled ? (input.reason?.trim() ?? "").slice(0, 300) : "",
      byDiscordId: input.actorDiscordId,
      at: new Date().toISOString(),
    },
    context,
  );
}

/** Text shown to a locked-out user: the admin's reason when there is one. */
export function lockdownText(lockdown: Pick<Lockdown, "reason">): string {
  return lockdown.reason ? `${LOCKDOWN_MESSAGE}\nПричина: ${lockdown.reason}` : LOCKDOWN_MESSAGE;
}

const CACHE_MS = 5_000;
let cached: { value: Lockdown; at: number } | null = null;

/**
 * Lockdown state for hot paths (every bot interaction): cached for a few seconds, so the switch
 * takes effect within that time without a database query per click.
 */
export async function getLockdownCached(): Promise<Lockdown> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await getLockdown();
  cached = { value, at: Date.now() };
  return value;
}

/** For tests and for the process that just changed the setting. */
export function clearLockdownCache() {
  cached = null;
}
