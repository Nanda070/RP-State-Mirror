import {
  canAccessAdminArea,
  canManageModules,
  canManageSystemSettings,
  getLockdown,
  getSetting,
  resolveIdentity,
  type Identity,
} from "@mirror/core";
import { redirect } from "next/navigation";
import { cache } from "react";
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

/** One lockdown read per request (layout, page and helpers all ask). */
export const currentLockdown = cache(() => getLockdown());

/** True when the emergency lockdown shuts this visitor out. Super admins always pass. */
export async function isLockedOut(identity: { isSuperAdmin: boolean } | null | undefined): Promise<boolean> {
  if (identity?.isSuperAdmin) return false;
  return (await currentLockdown()).enabled;
}

/** Lockdown check for pages that need no sign-in: a signed-in super admin still gets through. */
export async function publicLockedOut(): Promise<boolean> {
  if (!(await currentLockdown()).enabled) return false;
  const session = await auth();
  return !session?.identity?.isSuperAdmin;
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.discordId || !session.identity) {
    throw new AuthRequiredError("Требуется вход через Discord");
  }
  if (await isLockedOut(session.identity)) {
    throw new ForbiddenError("Идут технические работы. Попробуйте позже.");
  }
  return session;
}

/** One identity resolve per request (layout + page used to double-hit Prisma). */
export const resolveFreshIdentity = cache(async (discordId: string): Promise<Identity> => {
  const env = getDashboardEnv();
  return resolveIdentity(discordId, { superAdminUserIds: env.SUPER_ADMIN_USER_IDS });
});

export async function requireSignedIn() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  if (await isLockedOut(session.identity)) redirect("/maintenance");
  return session;
}

/**
 * Viewer of a section that opens without signing in (catalog, calculator, FAQ):
 * the fresh identity of a signed-in person, null for a guest.
 */
export async function openSectionIdentity(): Promise<Identity | null> {
  const session = await auth();
  if (!session?.user?.discordId) {
    if (await publicLockedOut()) redirect("/maintenance");
    return null;
  }
  if (await isLockedOut(session.identity)) redirect("/maintenance");
  return resolveFreshIdentity(session.user.discordId);
}

export async function requireAdminArea() {
  const session = await requireSession();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canAccessAdminArea(identity)) {
    throw new ForbiddenError("Недостаточно прав для раздела администрации");
  }
  return { session, identity };
}

/** Any signed-in user with a freshly resolved identity (player sections). */
export async function requireIdentity() {
  const session = await requireSession();
  const identity = await resolveFreshIdentity(session.user.discordId);
  return { session, identity };
}

/** «Админ» and above: may change module data (catalog, share links). */
export async function requireModuleManager() {
  const { session, identity } = await requireIdentity();
  if (!canManageModules(identity)) {
    throw new ForbiddenError("Действие доступно администраторам");
  }
  return { session, identity };
}

export async function requireSystemSettings() {
  const session = await requireSession();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) {
    throw new ForbiddenError("Системные настройки доступны только главному администратору");
  }
  return { session, identity };
}

/** Page-level gate: redirect instead of throwing (for RSC pages). */
export async function requireSystemSettingsPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");
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
