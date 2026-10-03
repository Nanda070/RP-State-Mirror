/**
 * Dashboard sessions (§6). Auth.js keeps a signed cookie; every sign-in also gets a row here whose
 * id travels inside that cookie. A request is honoured only while its row is not revoked, which is
 * what makes «end this session» and «sign out everywhere» work. The rows double as the login history.
 */
import { prisma } from "@mirror/db";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

const TOUCH_INTERVAL_MS = 5 * 60_000;
/** Matches the cookie lifetime in the dashboard's Auth.js config. */
export const SESSION_MAX_AGE_MS = 14 * 24 * 3_600_000;

export class SessionError extends UserError {
  override name = "SessionError";
}

export async function createUserSession(input: {
  userId: string;
  discordId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return prisma.userSession.create({
    data: {
      userId: input.userId,
      discordId: input.discordId,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
  });
}

/**
 * True while the session may be used. Also records activity, at most once every few minutes,
 * so an ordinary page view costs one indexed read.
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, lastSeenAt: true, createdAt: true },
  });
  if (!session || session.revokedAt) return false;
  if (Date.now() - session.createdAt.getTime() > SESSION_MAX_AGE_MS) return false;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.userSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return true;
}

/** Sessions of one user: live ones first, then the recent history. */
export async function listSessionsForUser(userId: string, limit = 30) {
  return prisma.userSession.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
    take: limit,
  });
}

export async function listRecentSessions(filter: { activeOnly?: boolean; limit?: number } = {}) {
  return prisma.userSession.findMany({
    where: filter.activeOnly
      ? { revokedAt: null, createdAt: { gte: new Date(Date.now() - SESSION_MAX_AGE_MS) } }
      : {},
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 200,
  });
}

/**
 * Ends one session. A user may end their own; ending someone else's is for super admins —
 * the caller decides that and passes `allowForeign`.
 */
export async function revokeUserSession(
  sessionId: string,
  actor: { userId: string; discordId: string; allowForeign: boolean },
  context: AuditContext,
) {
  return auditedMutation(context, "session.revoked", "session", async (tx) => {
    const session = await tx.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt) throw new SessionError("Сессия не найдена или уже завершена.");
    if (session.userId !== actor.userId && !actor.allowForeign) {
      throw new SessionError("Завершить можно только свою сессию.");
    }
    const updated = await tx.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedByDiscordId: actor.discordId },
    });
    return {
      entityId: sessionId,
      before: { discordId: session.discordId, ipAddress: session.ipAddress },
      after: { revokedByDiscordId: actor.discordId },
      result: updated,
    };
  });
}

/** Ends every live session of a user, optionally keeping the one the request came from. */
export async function revokeAllUserSessions(
  target: { userId: string; exceptSessionId?: string | null },
  actorDiscordId: string,
  context: AuditContext,
): Promise<number> {
  return auditedMutation(context, "session.revoked_all", "user", async (tx) => {
    const { count } = await tx.userSession.updateMany({
      where: {
        userId: target.userId,
        revokedAt: null,
        ...(target.exceptSessionId ? { id: { not: target.exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedByDiscordId: actorDiscordId },
    });
    return { entityId: target.userId, after: { revoked: count }, result: count };
  });
}

/** Sign-out: the row stays as history, the cookie stops working even if it was copied. */
export async function endUserSession(sessionId: string, discordId: string) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedByDiscordId: discordId },
  });
}
