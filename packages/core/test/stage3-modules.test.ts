import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  createDocument,
  createDocumentResponse,
  createFine,
  createWanted,
  closeWanted,
  listActiveFactionsForAutocomplete,
  markFinePaid,
  normalizeLinkOrText,
  parsePaymentDeadline,
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
      {
        factionCode: "LSPD",
        authorDiscordId: "1",
        subject: "A",
        content: "body",
        notifiedPerson: "Officer",
        forumLink: "https://forum.example/a",
        leaderText: "Leader",
        deputyText: "Deputy",
      },
      ctx,
    );
    const second = await createDocument(
      {
        factionCode: "LSPD",
        authorDiscordId: "1",
        subject: "B",
        content: "body",
        notifiedPerson: "Officer",
        forumLink: "https://forum.example/b",
        leaderText: "Leader",
        deputyText: "Deputy",
      },
      ctx,
    );
    expect(first.number).toBe("LSPD-001");
    expect(second.number).toBe("LSPD-002");
    expect(first.forumLink).toBe("https://forum.example/a");
    expect(first.notifiedPerson).toBe("Officer");
    expect(await prisma.auditLog.count({ where: { action: "document.created" } })).toBe(2);
  });

  it("stores legacy /ответ fields on document responses", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const doc = await createDocument(
      {
        factionCode: "LSPD",
        authorDiscordId: "1",
        subject: "A",
        content: "body",
        notifiedPerson: "Officer",
        forumLink: "https://forum.example/a",
        leaderText: "Leader",
        deputyText: "Deputy",
      },
      ctx,
    );
    const { response } = await createDocumentResponse(
      {
        documentNumber: doc.number,
        authorDiscordId: "2",
        personalFile: "https://forum.example/file/1",
        video: "clip.mp4",
        content: "done",
      },
      ctx,
    );
    expect(response.personalFile).toContain("forum.example");
    expect(response.video).toBe("clip.mp4");
    expect(response.content).toBe("done");
    expect(normalizeLinkOrText("https://x.test/a")).toBe("[Открыть](https://x.test/a)");
    expect(normalizeLinkOrText("plain")).toBe("plain");
  });

  it("creates and closes wanted records with W- numbers and legacy fields", async () => {
    const wanted = await createWanted(
      {
        staticId: "100",
        characterName: "Test",
        reason: "theft",
        termText: "10 лет",
        forumLink: "https://forum.example/w",
        issuedByDiscordId: "9",
      },
      ctx,
    );
    expect(wanted.number).toBe("W-001");
    expect(wanted.termText).toBe("10 лет");
    expect(wanted.forumLink).toBe("https://forum.example/w");
    const closed = await closeWanted(
      { wantedNumber: wanted.number, closedByDiscordId: "8", evidence: "photo" },
      ctx,
    );
    expect(closed.status).toBe(RecordStatus.CLOSED);
  });

  it("creates fines with payment deadline and marks them paid", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const fine = await createFine(
      {
        staticId: "100",
        characterName: "Test",
        amount: 5000,
        reason: "speeding",
        issuedByDiscordId: "9",
        factionCode: "LSPD",
        paymentDeadlineText: "24h",
      },
      ctx,
    );
    expect(fine.number).toBe("F-001");
    expect(fine.paymentDeadlineText).toBe("24h");
    expect(fine.dueAt).not.toBeNull();
    const paid = await markFinePaid({ fineNumber: fine.number, paidByDiscordId: "8" }, ctx);
    expect(paid.status).toBe(RecordStatus.CLOSED);
    expect(paid.paidAt).not.toBeNull();
  });

  it("parses payment deadlines and lists all ACTIVE factions for autocomplete", async () => {
    expect(parsePaymentDeadline("14d")).toEqual({ ms: 14 * 86_400_000, text: "14d" });
    expect(() => parsePaymentDeadline("soon")).toThrow(/Формат срока/);

    await seedFoundation({ superAdminUserIds: [] });
    const empty = await listActiveFactionsForAutocomplete("");
    expect(empty.length).toBeGreaterThanOrEqual(7);
    expect(empty.every((c) => c.value && c.name.includes(c.value))).toBe(true);

    const filtered = await listActiveFactionsForAutocomplete("lsp");
    expect(filtered.some((c) => c.value === "LSPD")).toBe(true);
  });
});
