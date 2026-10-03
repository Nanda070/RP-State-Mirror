import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  createDocument,
  createFine,
  createWanted,
  closeWanted,
  markFinePaid,
  seedFoundation,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ctx = { actorType: AuditActorType.SYSTEM, source: "test" } as const;

describe("stage 3 modules", () => {
  it("creates sequential document numbers per faction inside an audited transaction", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const first = await createDocument(
      { factionCode: "LSPD", authorDiscordId: "1", subject: "A", content: "body" },
      ctx,
    );
    const second = await createDocument(
      { factionCode: "LSPD", authorDiscordId: "1", subject: "B", content: "body" },
      ctx,
    );
    expect(first.number).toBe("LSPD-001");
    expect(second.number).toBe("LSPD-002");
    expect(await prisma.auditLog.count({ where: { action: "document.created" } })).toBe(2);
  });

  it("creates and closes wanted records with W- numbers", async () => {
    const wanted = await createWanted(
      { staticId: "100", characterName: "Test", reason: "theft", issuedByDiscordId: "9" },
      ctx,
    );
    expect(wanted.number).toBe("W-001");
    const closed = await closeWanted(
      { wantedNumber: wanted.number, closedByDiscordId: "8", evidence: "photo" },
      ctx,
    );
    expect(closed.status).toBe(RecordStatus.CLOSED);
  });

  it("creates fines and marks them paid", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const fine = await createFine(
      {
        staticId: "100",
        characterName: "Test",
        amount: 5000,
        reason: "speeding",
        issuedByDiscordId: "9",
        factionCode: "LSPD",
      },
      ctx,
    );
    expect(fine.number).toBe("F-001");
    const paid = await markFinePaid({ fineNumber: fine.number, paidByDiscordId: "8" }, ctx);
    expect(paid.status).toBe(RecordStatus.CLOSED);
    expect(paid.paidAt).not.toBeNull();
  });
});
