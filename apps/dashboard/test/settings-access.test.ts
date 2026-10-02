import { describe, expect, it } from "vitest";
import { AdminLevel } from "@mirror/db";
import { canManageSystemSettings, type Identity } from "@mirror/core";

/**
 * Mirrors the gate used by /api/settings/* — only senior+ may change
 * main/incident guild and role mappings in stage 2.
 */
function assertSettingsApiAllowed(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">) {
  if (!canManageSystemSettings(identity)) {
    throw Object.assign(new Error("Системные настройки доступны главному и старшему админу"), {
      status: 403,
    });
  }
}

describe("settings API access control", () => {
  it("rejects helpers and admins", () => {
    for (const level of [AdminLevel.HELPER, AdminLevel.ADMIN]) {
      expect(() => assertSettingsApiAllowed({ adminLevel: level, isSuperAdmin: false })).toThrow(/403|старшему/);
      try {
        assertSettingsApiAllowed({ adminLevel: level, isSuperAdmin: false });
      } catch (error) {
        expect((error as { status: number }).status).toBe(403);
      }
    }
  });

  it("allows senior and bootstrap super admins", () => {
    expect(() =>
      assertSettingsApiAllowed({ adminLevel: AdminLevel.SENIOR_ADMIN, isSuperAdmin: false }),
    ).not.toThrow();
    expect(() =>
      assertSettingsApiAllowed({ adminLevel: AdminLevel.SUPER_ADMIN, isSuperAdmin: true }),
    ).not.toThrow();
  });
});
