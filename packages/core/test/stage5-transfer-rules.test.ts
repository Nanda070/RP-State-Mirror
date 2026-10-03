import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  TransferRuleError,
  assertTransferRanksAllowed,
  listTransferRankRules,
  lookupTransferRank,
  replaceTransferPairRules,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.transfer-rules.test" } as const;

beforeEach(async () => {
  await resetDatabase();
  await prisma.faction.createMany({
    data: [
      { code: "FIB", name: "FIB" },
      { code: "LSPD", name: "LSPD" },
      { code: "EMS", name: "EMS", status: RecordStatus.ARCHIVED },
    ],
  });
});
afterAll(() => prisma.$disconnect());

describe("transfer rank rules", () => {
  it("replaces a pair table, keeping unchanged rules and archiving the rest", async () => {
    await replaceTransferPairRules(
      { fromFactionCode: "fib", toFactionCode: "lspd", rules: [{ fromRank: 5, toRank: 4 }, { fromRank: 6, toRank: 5 }] },
      context,
    );
    const keptId = (await prisma.transferRankRule.findFirstOrThrow({ where: { fromRank: 5 } })).id;

    const next = await replaceTransferPairRules(
      { fromFactionCode: "FIB", toFactionCode: "LSPD", rules: [{ fromRank: 7, toRank: 6 }, { fromRank: 5, toRank: 4 }, { fromRank: 6, toRank: 6 }] },
      context,
    );
    expect(next.map((r) => [r.fromRank, r.toRank])).toEqual([[5, 4], [6, 6], [7, 6]]);

    const active = await prisma.transferRankRule.findMany({ where: { status: RecordStatus.ACTIVE } });
    expect(active).toHaveLength(3);
    expect(active.find((r) => r.fromRank === 5)?.id).toBe(keptId);
    expect(await prisma.transferRankRule.count({ where: { status: RecordStatus.ARCHIVED } })).toBe(1);

    expect(await lookupTransferRank("fib", "lspd", 6)).toBe(6);
    expect(await lookupTransferRank("FIB", "LSPD", 9)).toBeNull();
    expect(await lookupTransferRank("LSPD", "FIB", 5)).toBeNull();
    expect(await listTransferRankRules({ fromFactionCode: "fib" })).toHaveLength(3);
  });

  it("feeds the transfer check and an empty table lifts the restriction", async () => {
    await replaceTransferPairRules(
      { fromFactionCode: "FIB", toFactionCode: "LSPD", rules: [{ fromRank: 5, toRank: 4 }] },
      context,
    );
    await expect(assertTransferRanksAllowed("FIB", "LSPD", 5, 4)).resolves.toBeUndefined();
    await expect(assertTransferRanksAllowed("FIB", "LSPD", 5, 5)).rejects.toThrow();
    await expect(assertTransferRanksAllowed("FIB", "LSPD", 3, 3)).rejects.toThrow();

    await replaceTransferPairRules({ fromFactionCode: "FIB", toFactionCode: "LSPD", rules: [] }, context);
    await expect(assertTransferRanksAllowed("FIB", "LSPD", 3, 9)).resolves.toBeUndefined();
    expect(await prisma.transferRankRule.count({ where: { status: RecordStatus.ACTIVE } })).toBe(0);
  });

  it("rejects the same faction, duplicate ranks, inactive factions and out-of-range ranks", async () => {
    const rules = [{ fromRank: 1, toRank: 1 }];
    await expect(
      replaceTransferPairRules({ fromFactionCode: "FIB", toFactionCode: "fib", rules }, context),
    ).rejects.toBeInstanceOf(TransferRuleError);
    await expect(
      replaceTransferPairRules(
        { fromFactionCode: "FIB", toFactionCode: "LSPD", rules: [...rules, { fromRank: 1, toRank: 2 }] },
        context,
      ),
    ).rejects.toBeInstanceOf(TransferRuleError);
    await expect(
      replaceTransferPairRules({ fromFactionCode: "FIB", toFactionCode: "EMS", rules }, context),
    ).rejects.toBeInstanceOf(TransferRuleError);
    await expect(
      replaceTransferPairRules({ fromFactionCode: "FIB", toFactionCode: "LSPD", rules: [{ fromRank: 101, toRank: 1 }] }, context),
    ).rejects.toThrow();
    expect(await prisma.transferRankRule.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "transfer_rules.replaced" } })).toBe(0);
  });
});
