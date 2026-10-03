import { SESSION_MAX_AGE_MS } from "@mirror/core";
import type { SessionRow } from "@/components/sessions-list";
import { formatMoscow } from "./moscow";

type StoredSession = {
  id: string;
  discordId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

/** Short, human description of a user-agent string. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Неизвестное устройство";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /YaBrowser\//.test(userAgent)
        ? "Яндекс Браузер"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Chrome\//.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "Браузер";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return system ? `${browser} · ${system}` : browser;
}

/** Sessions as the table shows them. `owners` is given in the admin view of all users. */
export function toSessionRows(
  sessions: readonly StoredSession[],
  currentSessionId: string | undefined,
  owners?: ReadonlyMap<string, string>,
): SessionRow[] {
  const now = Date.now();
  return sessions.map((session) => ({
    id: session.id,
    owner: owners ? (owners.get(session.discordId) ?? session.discordId) : null,
    device: describeDevice(session.userAgent),
    ipAddress: session.ipAddress,
    createdAt: formatMoscow(session.createdAt),
    lastSeenAt: formatMoscow(session.lastSeenAt),
    active: !session.revokedAt && now - session.createdAt.getTime() <= SESSION_MAX_AGE_MS,
    current: session.id === currentSessionId,
  }));
}
