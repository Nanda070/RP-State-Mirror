import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  createIcBlacklistEntry,
  expireIcBlacklistEntries,
  findActiveIcBlacklist,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.blacklist.test" } as const;

describe("ic blacklist", () => {
  it("rejects a second active entry and expires by ttl", async () => {
    const first = await createIcBlacklistEntry(
      {
        staticId: "BL-1",
        fullName: "Test Citizen",
        reason: "нарушение",
        createdByDiscordId: "800",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      context,
    );
    expect(await findActiveIcBlacklist("BL-1")).not.toBeNull();
    await expect(
      createIcBlacklistEntry(
        {
          staticId: "BL-1",
          fullName: "Test Citizen",
          reason: "ещё раз",
          createdByDiscordId: "800",
        },
        context,
      ),
    ).rejects.toThrow(/уже есть активная/);

    expect(await expireIcBlacklistEntries(new Date())).toBe(0);
    expect(await expireIcBlacklistEntries(new Date(Date.now() + 2 * 86_400_000))).toBe(1);
    expect(await findActiveIcBlacklist("BL-1")).toBeNull();
    const stored = await prisma.icBlacklistEntry.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.status).toBe(RecordStatus.EXPIRED);
  });
});
