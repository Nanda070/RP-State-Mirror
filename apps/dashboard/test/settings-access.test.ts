import { describe, expect, it } from "vitest";
import { AdminLevel } from "@mirror/db";
import { canManageSystemSettings, type Identity } from "@mirror/core";
import { safeNextPath } from "../src/lib/safe-next-path.js";

/**
 * Mirrors the gate used by /api/settings/* — only SUPER_ADMIN may change
 * main/incident guild and role mappings (PLAN: старший без системных настроек).
 */
function assertSettingsApiAllowed(identity: Pick<Identity, "adminLevel" | "isSuperAdmin">) {
  if (!canManageSystemSettings(identity)) {
    throw Object.assign(new Error("Системные настройки доступны только главному администратору"), {
      status: 403,
    });
  }
}

describe("settings API access control", () => {
  it("rejects helpers, admins, and senior admins", () => {
    for (const level of [AdminLevel.HELPER, AdminLevel.ADMIN, AdminLevel.SENIOR_ADMIN]) {
      expect(() => assertSettingsApiAllowed({ adminLevel: level, isSuperAdmin: false })).toThrow(
        /403|главному/,
      );
      try {
        assertSettingsApiAllowed({ adminLevel: level, isSuperAdmin: false });
      } catch (error) {
        expect((error as { status: number }).status).toBe(403);
      }
    }
  });

  it("allows super admins (role or bootstrap list)", () => {
    expect(() =>
      assertSettingsApiAllowed({ adminLevel: AdminLevel.SUPER_ADMIN, isSuperAdmin: false }),
    ).not.toThrow();
    expect(() =>
      assertSettingsApiAllowed({ adminLevel: AdminLevel.SUPER_ADMIN, isSuperAdmin: true }),
    ).not.toThrow();
  });
});

describe("safeNextPath", () => {
  it("allows same-origin relative paths only", () => {
    expect(safeNextPath("/overview")).toBe("/overview");
    expect(safeNextPath("/settings/roles")).toBe("/settings/roles");
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil")).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("overview")).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
