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
  it("creates documents with user-provided numbers and rejects duplicates", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const first = await createDocument(
      {
        number: "lspd-042",
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
        number: "LSPD-043",
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
    expect(first.number).toBe("LSPD-042");
    expect(second.number).toBe("LSPD-043");
    expect(first.forumLink).toBe("https://forum.example/a");
    expect(first.notifiedPerson).toBe("Officer");
    expect(await prisma.auditLog.count({ where: { action: "document.created" } })).toBe(2);

    await expect(
      createDocument(
        {
          number: "LSPD-042",
          factionCode: "LSPD",
          authorDiscordId: "1",
          subject: "Dup",
          content: "body",
          notifiedPerson: "Officer",
          forumLink: "https://forum.example/dup",
          leaderText: "Leader",
          deputyText: "Deputy",
        },
        ctx,
      ),
    ).rejects.toThrow(/уже существует/);

    await expect(
      createDocument(
        {
          number: "bad number!",
          factionCode: "LSPD",
          authorDiscordId: "1",
          subject: "Bad",
          content: "body",
          notifiedPerson: "Officer",
          forumLink: "https://forum.example/bad",
          leaderText: "Leader",
          deputyText: "Deputy",
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("stores legacy /ответ fields on document responses", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const doc = await createDocument(
      {
        number: "LSPD-001",
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

  it("creates and closes wanted records with user-provided numbers", async () => {
    const wanted = await createWanted(
      {
        number: "w-042",
        staticId: "100",
        characterName: "Test",
        reason: "theft",
        termText: "10 лет",
        forumLink: "https://forum.example/w",
        issuedByDiscordId: "9",
      },
      ctx,
    );
    expect(wanted.number).toBe("W-042");
    expect(wanted.termText).toBe("10 лет");
    expect(wanted.forumLink).toBe("https://forum.example/w");

    await expect(
      createWanted(
        {
          number: "W-042",
          staticId: "101",
          characterName: "Other",
          reason: "theft",
          termText: "5 лет",
          forumLink: "https://forum.example/w2",
          issuedByDiscordId: "9",
        },
        ctx,
      ),
    ).rejects.toThrow(/Открытый розыск/);

    const closed = await closeWanted(
      { wantedNumber: wanted.number, closedByDiscordId: "8", evidence: "photo" },
      ctx,
    );
    expect(closed.status).toBe(RecordStatus.CLOSED);
  });

  it("creates fines with user-provided numbers, payment deadline, and marks them paid", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const fine = await createFine(
      {
        number: "f-007",
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
    expect(fine.number).toBe("F-007");
    expect(fine.paymentDeadlineText).toBe("24h");
    expect(fine.dueAt).not.toBeNull();

    await expect(
      createFine(
        {
          number: "F-007",
          staticId: "101",
          characterName: "Other",
          amount: 1000,
          reason: "parking",
          issuedByDiscordId: "9",
          factionCode: "LSPD",
          paymentDeadlineText: "1m",
        },
        ctx,
      ),
    ).rejects.toThrow(/Штраф уже есть/);

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
