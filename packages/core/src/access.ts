import { AdminLevel } from "@mirror/db";
import { ADMIN_LEVEL_ORDER, type Identity } from "./identity.js";

export type AdminGate = AdminLevel;

const LEVEL_RANK: Record<AdminLevel, number> = {
  [AdminLevel.SUPER_ADMIN]: 4,
  [AdminLevel.SENIOR_ADMIN]: 3,
  [AdminLevel.ADMIN]: 2,
  [AdminLevel.HELPER]: 1,
};

export function adminLevelRank(level: AdminLevel | null | undefined): number {
  if (!level) return 0;
  return LEVEL_RANK[level];
}

export function hasMinAdminLevel(identity: Pick<Identity, "adminLevel">, minimum: AdminGate): boolean {
  return adminLevelRank(identity.adminLevel) >= LEVEL_RANK[minimum];
}

/** Any staff level that may open admin areas (overview, registries later). */
export function canAccessAdminArea(identity: Pick<Identity, "adminLevel">): boolean {
  return hasMinAdminLevel(identity, AdminLevel.HELPER);
}

/**
 * System settings for stage 2: main guild, incident guild, role mappings.
 * PLAN defaults: главный и старший админ; не обычный админ/хелпер.
 */
export function canManageSystemSettings(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return identity.isSuperAdmin || hasMinAdminLevel(identity, AdminLevel.SENIOR_ADMIN);
}

/**
 * While the main guild is unset, only bootstrap super-admins may use the dashboard
 * beyond the public landing and legal pages.
 */
export function canBootstrapDashboard(
  identity: Pick<Identity, "isSuperAdmin">,
  mainGuildId: string | null,
): boolean {
  if (mainGuildId) return true;
  return identity.isSuperAdmin;
}

export function isStaffIdentity(identity: Pick<Identity, "adminLevel">): boolean {
  return identity.adminLevel !== null;
}

export const ADMIN_LEVEL_LABELS_RU: Record<AdminLevel, string> = {
  [AdminLevel.SUPER_ADMIN]: "Главный администратор",
  [AdminLevel.SENIOR_ADMIN]: "Старший администратор",
  [AdminLevel.ADMIN]: "Администратор",
  [AdminLevel.HELPER]: "Хелпер",
};

export { ADMIN_LEVEL_ORDER };
