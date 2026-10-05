import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import { DEFAULT_APPEARANCE, getAppearance, setAppearance, toAppearance } from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage9-appearance.test" } as const;

describe("appearance", () => {
  it("keeps a preset and an own accent per person, audited", async () => {
    expect(await getAppearance("800")).toEqual(DEFAULT_APPEARANCE);
    await setAppearance("800", { theme: "midnight", accentColor: "#A1B2C3" }, context);
    expect(await getAppearance("800")).toEqual({ theme: "midnight", accentColor: "#a1b2c3" });
    await setAppearance("800", { theme: "graphite", accentColor: null }, context);
    expect(await getAppearance("800")).toEqual({ theme: "graphite", accentColor: null });
    expect(await prisma.auditLog.count({ where: { action: "user.appearance_changed" } })).toBe(2);

    await expect(setAppearance("800", { theme: "neon" as never, accentColor: null }, context)).rejects.toThrow();
    await expect(setAppearance("800", { theme: "mirror", accentColor: "red" }, context)).rejects.toThrow(/#rrggbb/);
    // Whatever got into the row, the page only ever sees a known preset and a valid colour.
    expect(toAppearance({ theme: "unknown", accentColor: "javascript:" })).toEqual(DEFAULT_APPEARANCE);
  });
});
