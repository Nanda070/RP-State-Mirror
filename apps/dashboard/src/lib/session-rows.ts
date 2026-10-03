import { SESSION_MAX_AGE_MS } from "@mirror/core";
import { describeDevice, type SessionRow } from "@/components/sessions-list";
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
