import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RecordStatus, TransferStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  assertTransferRanksAllowed,
  createCharacter,
  createTransfer,
  decideTransfer,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.transfers.test" } as const;

async function character(discordId: string) {
  const user = await prisma.user.create({ data: { discordId } });
  return createCharacter({ userId: user.id, slot: 1, staticId: `S-${discordId}`, name: `Officer ${discordId}` }, context);
}

function transfer(characterId: string, fromRank = 5, toRank = 4) {
  return createTransfer(
    {
      characterId,
      fromFactionCode: "LSPD",
      toFactionCode: "LSSD",
      fromRank,
      toRank,
      createdByDiscordId: "900",
    },
    context,
  );
}

describe("transfer rank table", () => {
  it("allows any ranks when the faction-pair catalog is empty", async () => {
    await expect(assertTransferRanksAllowed("LSPD", "LSSD", 9, 1)).resolves.toBeUndefined();
    const owner = await character("600");
    expect((await transfer(owner.id, 9, 1)).toRank).toBe(1);
  });

  it("requires the mapped toRank once rules exist for the pair", async () => {
    await prisma.transferRankRule.create({
      data: { fromFactionCode: "LSPD", toFactionCode: "LSSD", fromRank: 5, toRank: 4 },
    });
    await assertTransferRanksAllowed("LSPD", "LSSD", 5, 4);
    await expect(assertTransferRanksAllowed("LSPD", "LSSD", 5, 3)).rejects.toThrow(/соответствует рангу 4/);
    await expect(assertTransferRanksAllowed("LSPD", "LSSD", 6, 4)).rejects.toThrow(/не описан/);
    // Unrelated pairs stay free.
    await expect(assertTransferRanksAllowed("FIB", "LSSD", 5, 1)).resolves.toBeUndefined();
  });
});

describe("transfer decisions", () => {
  it("queues a notification job when the transfer closes", async () => {
    const owner = await character("610");
    const pending = await transfer(owner.id);
    await decideTransfer(pending.id, "source", DecisionStatus.APPROVED, "lead-1", null, context);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.TRANSFER_DECIDED } })).toBe(0);

    await decideTransfer(pending.id, "target", DecisionStatus.APPROVED, "lead-2", null, context);
    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.TRANSFER_DECIDED } });
    expect(jobs.map((job) => job.payload)).toEqual([{ transferId: pending.id }]);
    expect((await prisma.transfer.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(TransferStatus.APPROVED);
  });

  it("queues a notification job on the first rejection", async () => {
    const owner = await character("620");
    const pending = await transfer(owner.id);
    await decideTransfer(pending.id, "target", DecisionStatus.REJECTED, "lead-2", "нет мест", context);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.TRANSFER_DECIDED } })).toBe(1);
    expect((await prisma.transfer.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(TransferStatus.REJECTED);
  });
});

describe("transfer rank rule status", () => {
  it("ignores archived rules", async () => {
    await prisma.transferRankRule.create({
      data: {
        fromFactionCode: "LSPD",
        toFactionCode: "LSSD",
        fromRank: 5,
        toRank: 4,
        status: RecordStatus.ARCHIVED,
      },
    });
    await expect(assertTransferRanksAllowed("LSPD", "LSSD", 5, 99)).resolves.toBeUndefined();
  });
});
