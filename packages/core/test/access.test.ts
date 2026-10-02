import { describe, expect, it } from "vitest";
import { AdminLevel } from "@mirror/db";
import {
  buildStatusBadge,
  canAccessAdminArea,
  canBootstrapDashboard,
  canManageSystemSettings,
  canMapSuperAdminLevel,
  hasMinAdminLevel,
  type Identity,
} from "@mirror/core";

function identity(partial: Partial<Identity>): Identity {
  return {
    discordUserId: "300000000000000001",
    isSuperAdmin: false,
    adminLevel: null,
    factions: [],
    permissions: [],
    ...partial,
  };
}

describe("access gates", () => {
  it("allows helpers into admin areas but not system settings", () => {
    const helper = identity({ adminLevel: AdminLevel.HELPER });
    expect(canAccessAdminArea(helper)).toBe(true);
    expect(canManageSystemSettings(helper)).toBe(false);
    expect(hasMinAdminLevel(helper, AdminLevel.ADMIN)).toBe(false);
  });

  it("allows only super admins to manage system settings", () => {
    expect(canManageSystemSettings(identity({ adminLevel: AdminLevel.SENIOR_ADMIN }))).toBe(false);
    expect(canManageSystemSettings(identity({ adminLevel: AdminLevel.ADMIN }))).toBe(false);
    expect(canManageSystemSettings(identity({ adminLevel: AdminLevel.SUPER_ADMIN }))).toBe(true);
    expect(canManageSystemSettings(identity({ isSuperAdmin: true, adminLevel: AdminLevel.SUPER_ADMIN }))).toBe(
      true,
    );
    expect(canMapSuperAdminLevel(identity({ adminLevel: AdminLevel.SENIOR_ADMIN }))).toBe(false);
    expect(canMapSuperAdminLevel(identity({ adminLevel: AdminLevel.SUPER_ADMIN }))).toBe(true);
  });

  it("blocks non-super-admins while main guild is unset", () => {
    expect(canBootstrapDashboard(identity({ isSuperAdmin: false }), null)).toBe(false);
    expect(canBootstrapDashboard(identity({ isSuperAdmin: true }), null)).toBe(true);
    expect(canBootstrapDashboard(identity({ isSuperAdmin: false }), "200000000000000001")).toBe(true);
  });
});

describe("buildStatusBadge", () => {
  it("prefers admin position, then faction, then citizen", () => {
    expect(buildStatusBadge(identity({ adminLevel: AdminLevel.SUPER_ADMIN })).primary).toBe(
      "Главный администратор",
    );
    expect(
      buildStatusBadge(
        identity({
          factions: [
            {
              code: "LSPD",
              name: "LSPD",
              color: "#3B82F6",
              isLeader: false,
              isDeputy: false,
              rank: 5,
              departments: ["Detective"],
            },
          ],
        }),
      ),
    ).toMatchObject({ primary: "LSPD · Detective · Ранг 5", kind: "faction" });
    expect(buildStatusBadge(identity({})).primary).toBe("Гражданин");
  });
});
