import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, JobStatus, RecordStatus, RoleMappingKind } from "@mirror/db";
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
  formatRoleMentions,
  markFinePaid,
  MODULE_JOB_TYPES,
  resolveDocumentResponseDelivery,
  resolveDocumentResponseLocalDelivery,
  resolveFactionCodeByGuildDiscordId,
  resolveFactionDocumentDelivery,
  resolveFactionPingRoleId,
  resolveFactionSeniorRoleId,
  resolveFineDelivery,
  resolveFinePaidDelivery,
  resolveRegistrationDelivery,
  resolveWantedDelivery,
  resolveWantedPingRoleIds,
  sameDeliveryChannel,
  seedFoundation,
  setSetting,
  toJsonValue,
  updateFactionDeliverySettings,
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
    expect(deliveryConfigured(await resolveFineDelivery("LSPD"))).toBe(false);
    expect(deliveryConfigured(await resolveFinePaidDelivery())).toBe(false);
  });

  it("resolves vehicle and uniform registration channels separately", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    await setSetting("core.incidentGuildId", "200000000000000099", ctx);
    await setSetting("registrations.vehicleChannelId", "300000000000000101", ctx);
    await setSetting("registrations.uniformChannelId", "300000000000000102", ctx);

    expect(await resolveRegistrationDelivery("VEHICLE")).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000101",
    });
    expect(await resolveRegistrationDelivery("UNIFORM")).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000102",
    });
  });

  it("migrates legacy registrations.channelId onto both vehicle and uniform channels", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    await setSetting("core.incidentGuildId", "200000000000000099", ctx);
    await prisma.systemSetting.create({
      data: { key: "registrations.channelId", value: toJsonValue("300000000000000200") },
    });
    await prisma.systemSetting.deleteMany({
      where: { key: { in: ["registrations.vehicleChannelId", "registrations.uniformChannelId"] } },
    });

    expect(await resolveRegistrationDelivery("VEHICLE")).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000200",
    });
    expect(await resolveRegistrationDelivery("UNIFORM")).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000200",
    });
    expect(await prisma.systemSetting.findUnique({ where: { key: "registrations.channelId" } })).toBeNull();
  });

  it("resolves wanted from ЧП settings; fines from faction/GOV documents channels", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    await setSetting("core.incidentGuildId", "200000000000000099", ctx);
    await setSetting("wanted.channelId", "300000000000000001", ctx);
    // fines.channelId on ЧП must NOT drive /штраф delivery anymore
    await setSetting("fines.channelId", "300000000000000002", ctx);

    const wanted = await resolveWantedDelivery();
    expect(wanted).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000001",
    });

    expect(deliveryConfigured(await resolveFineDelivery("LSPD"))).toBe(false);

    const lspdGuild = await prisma.guild.create({
      data: {
        discordId: "200000000000000010",
        name: "LSPD Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    const govGuild = await prisma.guild.create({
      data: {
        discordId: "200000000000000020",
        name: "GOV Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.faction.update({
      where: { code: "LSPD" },
      data: {
        guildId: lspdGuild.id,
        settings: { documentsChannelId: "300000000000000010" },
      },
    });
    await prisma.faction.update({
      where: { code: "GOV" },
      data: {
        guildId: govGuild.id,
        settings: { documentsChannelId: "300000000000000020" },
      },
    });

    expect(await resolveFineDelivery("LSPD")).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000010",
      channelDiscordId: "300000000000000010",
    });
    expect(await resolveFinePaidDelivery()).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000020",
      channelDiscordId: "300000000000000020",
    });
    // Still not the CHП fines.channelId
    expect(await resolveFineDelivery("LSPD")).not.toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000099",
      channelDiscordId: "300000000000000002",
    });
  });

  it("enqueues delivery jobs after create/close/paid mutations", async () => {
    await seedFoundation({ superAdminUserIds: [] });

    const doc = await createDocument(
      {
        number: "LSPD-001",
        factionCode: "LSPD",
        authorDiscordId: "1",
        subject: "A",
        content: "body",
        notifiedPerson: "Officer A",
        forumLink: "https://forum.example/t/1",
        leaderText: "Leader",
        deputyText: "Deputy",
      },
      ctx,
    );
    await enqueueDocumentSend(doc.id);

    const wanted = await createWanted(
      {
        number: "W-001",
        staticId: "100",
        characterName: "Test",
        reason: "theft",
        termText: "10 лет",
        forumLink: "https://forum.example/wanted/1",
        issuedByDiscordId: "9",
      },
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
        number: "F-001",
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

  it("routes /ответ to GOV documents and a local copy on the command guild", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const govGuild = await prisma.guild.create({
      data: {
        discordId: "200000000000000020",
        name: "GOV Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    const lspdGuild = await prisma.guild.create({
      data: {
        discordId: "200000000000000021",
        name: "LSPD Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.faction.update({
      where: { code: "GOV" },
      data: {
        guildId: govGuild.id,
        settings: { documentsChannelId: "300000000000000020" },
      },
    });
    await prisma.faction.update({
      where: { code: "LSPD" },
      data: {
        guildId: lspdGuild.id,
        settings: { documentsChannelId: "300000000000000021" },
      },
    });

    const replyTarget = await resolveDocumentResponseDelivery();
    expect(replyTarget).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000020",
      channelDiscordId: "300000000000000020",
    });
    expect(await resolveFactionCodeByGuildDiscordId("200000000000000021")).toBe("LSPD");
    const localTarget = await resolveDocumentResponseLocalDelivery("200000000000000021");
    expect(localTarget).toEqual({
      kind: "channel",
      guildDiscordId: "200000000000000021",
      channelDiscordId: "300000000000000021",
    });
    expect(sameDeliveryChannel(replyTarget, localTarget)).toBe(false);
    expect(replyTarget).not.toEqual(await resolveFactionDocumentDelivery("LSPD"));
  });

  it("resolves wanted ping roles for all ЧП factions except WN", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    expect(await resolveWantedPingRoleIds()).toEqual([]);

    const incident = await prisma.guild.create({
      data: {
        discordId: "200000000000000099",
        name: "ЧП",
        status: RecordStatus.ACTIVE,
      },
    });
    await setSetting("core.incidentGuildId", incident.discordId, ctx);

    const roleSpecs = [
      { code: "GOV", discordId: "400000000000000001" },
      { code: "LSPD", discordId: "400000000000000002" },
      { code: "WN", discordId: "400000000000000003" },
      { code: "SHARED", discordId: "400000000000000004", name: "Фракция" },
    ] as const;

    for (const spec of roleSpecs) {
      await prisma.discordRole.create({
        data: {
          discordId: spec.discordId,
          guildId: incident.id,
          name: "name" in spec ? spec.name : spec.code,
          status: RecordStatus.ACTIVE,
        },
      });
    }

    for (const code of ["GOV", "LSPD", "WN"] as const) {
      const faction = await prisma.faction.findUniqueOrThrow({ where: { code } });
      const roleDiscordId =
        code === "GOV"
          ? "400000000000000001"
          : code === "LSPD"
            ? "400000000000000002"
            : "400000000000000003";
      await prisma.roleMapping.create({
        data: {
          guildId: incident.id,
          roleDiscordId,
          kind: RoleMappingKind.FACTION_MEMBER,
          value: "true",
          factionId: faction.id,
          status: RecordStatus.ACTIVE,
        },
      });
    }

    // FIB only has the shared «Фракция» mapping — should fall back to role named FIB.
    const fib = await prisma.faction.findUniqueOrThrow({ where: { code: "FIB" } });
    await prisma.discordRole.create({
      data: {
        discordId: "400000000000000005",
        guildId: incident.id,
        name: "FIB",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.roleMapping.create({
      data: {
        guildId: incident.id,
        roleDiscordId: "400000000000000004",
        kind: RoleMappingKind.FACTION_MEMBER,
        value: "FIB",
        factionId: fib.id,
        status: RecordStatus.ACTIVE,
      },
    });

    const pingIds = await resolveWantedPingRoleIds();
    expect(pingIds).toContain("400000000000000001"); // GOV
    expect(pingIds).toContain("400000000000000002"); // LSPD
    expect(pingIds).toContain("400000000000000005"); // FIB fallback by name
    expect(pingIds).not.toContain("400000000000000003"); // WN excluded
    expect(pingIds).not.toContain("400000000000000004"); // shared Фракция skipped
  });

  it("stores and resolves seniorRoleId / ping role from faction delivery settings", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    expect(formatRoleMentions(["400000000000000001", "bad"])).toBe("<@&400000000000000001>");
    expect(await resolveFactionSeniorRoleId("LSPD")).toBeNull();
    expect(await resolveFactionPingRoleId("LSPD")).toBeNull();

    const guild = await prisma.guild.create({
      data: {
        discordId: "200000000000000011",
        name: "LSPD Guild",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.discordRole.create({
      data: {
        discordId: "400000000000000099",
        guildId: guild.id,
        name: "LSPD",
        status: RecordStatus.ACTIVE,
      },
    });
    await updateFactionDeliverySettings(
      {
        factionCode: "LSPD",
        guildDiscordId: guild.discordId,
        seniorRoleId: "400000000000000011",
        documentsChannelId: "300000000000000011",
      },
      ctx,
    );

    expect(await resolveFactionSeniorRoleId("LSPD")).toBe("400000000000000011");
    // Prefer role named like faction code over seniorRoleId
    expect(await resolveFactionPingRoleId("LSPD")).toBe("400000000000000099");
    const faction = await prisma.faction.findUniqueOrThrow({ where: { code: "LSPD" } });
    expect(faction.settings).toMatchObject({
      seniorRoleId: "400000000000000011",
      documentsChannelId: "300000000000000011",
    });
  });
});
