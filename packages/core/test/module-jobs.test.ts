import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, JobStatus, RecordStatus } from "@mirror/db";
import {
  createDocument,
  createFine,
  createWanted,
  closeWanted,
  deliveryConfigured,
  enqueueDocumentSend,
  enqueueFinePublish,
  enqueueWantedEditClosed,
  enqueueWantedPublish,
  markFinePaid,
  MODULE_JOB_TYPES,
  resolveFactionDocumentDelivery,
  resolveFineDelivery,
  resolveWantedDelivery,
  seedFoundation,
  setSetting,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ctx = { actorType: AuditActorType.SYSTEM, source: "test" } as const;

describe("stage 3 delivery + job enqueue", () => {
  it("reports unconfigured delivery until channel settings exist", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const docTarget = await resolveFactionDocumentDelivery("LSPD");
    expect(deliveryConfigured(docTarget)).toBe(false);
    expect(docTarget.kind).toBe("unconfigured");

    expect(deliveryConfigured(await resolveWantedDelivery())).toBe(false);
    expect(deliveryConfigured(await resolveFineDelivery())).toBe(false);
  });

  it("resolves wanted/fine channels from system settings + incident guild", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    await setSetting("core.incidentGuildId", "200000000000000099", ctx);
    await setSetting("wanted.channelId", "300000000000000001", ctx);
    await setSetting("fines.channelId", "300000000000000002", ctx);

    const wanted = await resolveWantedDelivery();
    expect(wanted).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000001",
    });

    const fine = await resolveFineDelivery();
    expect(fine).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000002",
    });
  });

  it("enqueues delivery jobs after create/close/paid mutations", async () => {
    await seedFoundation({ superAdminUserIds: [] });

    const doc = await createDocument(
      { factionCode: "LSPD", authorDiscordId: "1", subject: "A", content: "body" },
      ctx,
    );
    await enqueueDocumentSend(doc.id);

    const wanted = await createWanted(
      { staticId: "100", characterName: "Test", reason: "theft", issuedByDiscordId: "9" },
      ctx,
    );
    await enqueueWantedPublish(wanted.id);
    const closed = await closeWanted(
      { wantedNumber: wanted.number, closedByDiscordId: "8", evidence: "photo" },
      ctx,
    );
    await enqueueWantedEditClosed(closed.id);

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
    await enqueueFinePublish(fine.id);
    await markFinePaid({ fineNumber: fine.number, paidByDiscordId: "8" }, ctx);

    const jobs = await prisma.job.findMany({ orderBy: { createdAt: "asc" } });
    expect(jobs.map((j) => j.type)).toEqual([
      MODULE_JOB_TYPES.DOCUMENT_SEND,
      MODULE_JOB_TYPES.WANTED_PUBLISH,
      MODULE_JOB_TYPES.WANTED_EDIT_CLOSED,
      MODULE_JOB_TYPES.FINE_PUBLISH,
    ]);
    expect(jobs.every((j) => j.status === JobStatus.PENDING)).toBe(true);
    expect(closed.status).toBe(RecordStatus.CLOSED);
  });

  it("uses faction settings channel for document delivery when guild is linked", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const guild = await prisma.guild.create({
      data: {
        discordId: "200000000000000010",
        name: "LSPD Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.faction.update({
      where: { code: "LSPD" },
      data: {
        guildId: guild.id,
        settings: { documentsChannelId: "300000000000000010" },
      },
    });

    const target = await resolveFactionDocumentDelivery("LSPD");
    expect(target).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000010",
      channelDiscordId: "300000000000000010",
    });
  });
});
