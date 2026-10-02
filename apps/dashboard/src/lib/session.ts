import {
  canAccessAdminArea,
  canManageSystemSettings,
  getSetting,
  resolveIdentity,
  type Identity,
} from "@mirror/core";
import { auth, type SessionIdentity } from "../auth";
import { getDashboardEnv } from "../env";

export class AuthRequiredError extends Error {
  override name = "AuthRequiredError";
  status = 401;
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";
  status = 403;
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.discordId || !session.identity) {
    throw new AuthRequiredError("Требуется вход через Discord");
  }
  return session;
}

export async function resolveFreshIdentity(discordId: string): Promise<Identity> {
  const env = getDashboardEnv();
  return resolveIdentity(discordId, { superAdminUserIds: env.SUPER_ADMIN_USER_IDS });
}

export async function requireAdminArea() {
  const session = await requireSession();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canAccessAdminArea(identity)) {
    throw new ForbiddenError("Недостаточно прав для раздела администрации");
  }
  return { session, identity };
}

export async function requireSystemSettings() {
  const session = await requireSession();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) {
    throw new ForbiddenError("Системные настройки доступны главному и старшему админу");
  }
  return { session, identity };
}

export function toSessionIdentity(identity: Identity): SessionIdentity {
  return {
    discordUserId: identity.discordUserId,
    isSuperAdmin: identity.isSuperAdmin,
    adminLevel: identity.adminLevel,
    factions: identity.factions,
    permissions: identity.permissions,
  };
}

export async function getMainGuildId(): Promise<string | null> {
  return getSetting("core.mainGuildId");
}
