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
 * System settings: main guild, incident guild, role mappings.
 * PLAN: только главный админ (старший — без системных настроек).
 */
export function canManageSystemSettings(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return identity.isSuperAdmin || identity.adminLevel === AdminLevel.SUPER_ADMIN;
}

/** Only a super admin may create/update ADMIN_LEVEL=SUPER_ADMIN role mappings. */
export function canMapSuperAdminLevel(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return canManageSystemSettings(identity);
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

/**
 * Can view and manage bot module records (documents, wanted, fines, personnel).
 * PLAN: Администратор и выше.
 */
export function canManageModules(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return identity.isSuperAdmin || hasMinAdminLevel(identity, AdminLevel.ADMIN);
}

/** /нашивка найти: admins, or holders of roles from `tokens.finderRoleIds` (ОГП/Юстиция). */
export function canFindTokens(
  identity: Pick<Identity, "adminLevel" | "isSuperAdmin">,
  heldRoleIds: readonly string[],
  finderRoleIds: readonly string[],
): boolean {
  if (canManageModules(identity)) return true;
  return finderRoleIds.some((roleId) => heldRoleIds.includes(roleId));
}

function holdsAnyRole(heldRoleIds: readonly string[], allowed: readonly string[]): boolean {
  return allowed.some((roleId) => heldRoleIds.includes(roleId));
}

/** IC blacklist add/remove: admins or `icBlacklist.managerRoleIds`. */
export function canManageIcBlacklist(
  identity: Pick<Identity, "adminLevel" | "isSuperAdmin">,
  heldRoleIds: readonly string[],
  managerRoleIds: readonly string[],
): boolean {
  return canManageModules(identity) || holdsAnyRole(heldRoleIds, managerRoleIds);
}

/** IC blacklist search: managers, admins, or `icBlacklist.searchRoleIds`. */
export function canSearchIcBlacklist(
  identity: Pick<Identity, "adminLevel" | "isSuperAdmin">,
  heldRoleIds: readonly string[],
  managerRoleIds: readonly string[],
  searchRoleIds: readonly string[],
): boolean {
  return (
    canManageIcBlacklist(identity, heldRoleIds, managerRoleIds) || holdsAnyRole(heldRoleIds, searchRoleIds)
  );
}

/**
 * Can view module records (read-only).
 * PLAN: Хелпер и выше.
 */
export function canViewModules(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return identity.isSuperAdmin || hasMinAdminLevel(identity, AdminLevel.HELPER);
}

/**
 * Can close wanted / mark fines paid from the dashboard.
 * Same as ADMIN+ but exposed separately for clarity.
 */
export function canActOnModuleRecord(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">): boolean {
  return canManageModules(identity);
}

export const ADMIN_LEVEL_LABELS_RU: Record<AdminLevel, string> = {
  [AdminLevel.SUPER_ADMIN]: "Главный администратор",
  [AdminLevel.SENIOR_ADMIN]: "Старший администратор",
  [AdminLevel.ADMIN]: "Администратор",
  [AdminLevel.HELPER]: "Хелпер",
};

export { ADMIN_LEVEL_ORDER };
