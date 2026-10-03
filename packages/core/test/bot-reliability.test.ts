import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, JobStatus, RecordStatus, RegistrationKind, TransferStatus } from "@mirror/db";
import {
  CP_KICK_FLOOR,
  DEFER_RETRY_MS,
  MODULE_JOB_TYPES,
  claimNextJob,
  cpKickLimit,
  createCharacter,
  createIcBlacklistEntry,
  createRegistration,
  createTransfer,
  deferJob,
  enqueueJob,
  expirePendingRegistrations,
  expirePendingTransfers,
  failJob,
  planCpSync,
  setSetting,
  wakeDeferredJobs,
  type CpFactionLink,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "bot-reliability.test" } as const;

describe("jobs waiting for configuration", () => {
  it("puts a deferred job back without spending an attempt and tries it again later", async () => {
    const { id } = await enqueueJob({ type: "document.send", maxAttempts: 2 });
    const first = await claimNextJob("w");
    expect(first?.attempts).toBe(1);

    const deferred = await deferJob(id, "w", "Канал не настроен");
    expect(deferred).toMatchObject({ status: JobStatus.PENDING, attempts: 0, lockedBy: null });
    expect(deferred?.lastError).toBe("Отложено: Канал не настроен");
    expect(deferred!.availableAt.getTime()).toBeGreaterThan(Date.now() + DEFER_RETRY_MS - 5_000);
    // Not due yet, so the queue is idle instead of spinning on it.
    expect(await claimNextJob("w")).toBeNull();

    // Many deferrals never exhaust maxAttempts.
    for (let round = 0; round < 5; round += 1) {
      await prisma.job.update({ where: { id }, data: { availableAt: new Date() } });
      const claimed = await claimNextJob("w");
      expect(claimed?.attempts).toBe(1);
      await deferJob(id, "w", "Канал не настроен");
    }
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe(JobStatus.PENDING);
  });

  it("wakes deferred jobs when settings are saved, and leaves ordinary retries alone", async () => {
    const waiting = await enqueueJob({ type: "document.send" });
    await claimNextJob("w");
    await deferJob(waiting.id, "w", "Канал не настроен");

    const failing = await enqueueJob({ type: "flaky" });
    await claimNextJob("w");
    const failed = await failJob(failing.id, "w", new Error("boom"));

    expect(await wakeDeferredJobs()).toBe(1);
    expect((await claimNextJob("w"))?.id).toBe(waiting.id);
    const untouched = await prisma.job.findUniqueOrThrow({ where: { id: failing.id } });
    expect(untouched.availableAt).toEqual(failed!.availableAt);
  });

  it("gives up on a job that has waited too long, and ignores a worker that lost the lock", async () => {
    const { id } = await enqueueJob({ type: "document.send" });
    await claimNextJob("w");
    expect(await deferJob(id, "someone-else", "x")).toBeNull();

    const expired = await deferJob(id, "w", "Канал не настроен", { maxAgeMs: -1 });
    expect(expired).toMatchObject({ status: JobStatus.FAILED });
    expect(expired?.completedAt).not.toBeNull();
  });

  it("keeps the checkpoint written by a finished step across a failed attempt", async () => {
    const { id } = await enqueueJob({ type: "document.send" });
    await claimNextJob("w");
    // The bot writes finished steps to `result` right after a Discord post.
    await prisma.job.update({ where: { id }, data: { result: { steps: { post: { messageId: "1" } } } } });
    await failJob(id, "w", new Error("database hiccup after the post"));
    await prisma.job.update({ where: { id }, data: { availableAt: new Date() } });

    const retried = await claimNextJob("w");
    expect(retried?.result).toEqual({ steps: { post: { messageId: "1" } } });
  });
});

describe("ЧП sync safety", () => {
  const links: CpFactionLink[] = [
    { factionCode: "LSPD", factionGuildDiscordId: "guild-lspd", sourceRoleIds: ["src-lspd"], targetRoleIds: ["cp-lspd"] },
    { factionCode: "EMS", factionGuildDiscordId: "guild-ems", sourceRoleIds: ["src-ems"], targetRoleIds: ["cp-ems"] },
  ];
  const base = {
    userDiscordId: "u",
    isBot: false,
    isOwner: false,
    excludedRoleIds: [],
    incidentRoleIds: ["cp-ems"],
    links,
    managedTargetRoleIds: ["cp-lspd", "cp-ems"],
  };

  it("never kicks or strips roles when a faction guild could not be read", () => {
    // EMS is down; the member's only faction is EMS. Reading «no roles» there must not mean «kick».
    expect(planCpSync({ ...base, memberships: new Map([["guild-lspd", []]]), unknownGuildIds: ["guild-ems"] })).toEqual({
      kind: "skip",
      reason: "membership_unknown",
    });
    // The same input with EMS readable and empty is a real kick.
    expect(
      planCpSync({ ...base, memberships: new Map([["guild-lspd", []], ["guild-ems", []]]), unknownGuildIds: [] }),
    ).toEqual({ kind: "kick", reason: "no_faction_roles" });
  });

  it("limits how many members one pass may kick", () => {
    expect(cpKickLimit(1000, 10)).toBe(100);
    expect(cpKickLimit(1000, 0)).toBe(CP_KICK_FLOOR);
    expect(cpKickLimit(5, 10)).toBe(CP_KICK_FLOOR);
    expect(cpKickLimit(0, 10)).toBe(CP_KICK_FLOOR);
    expect(cpKickLimit(250, 2.5)).toBe(6);
  });
});

describe("applications nobody reviewed", () => {
  const DAY = 86_400_000;

  it("closes an old pending registration, frees its static and notifies; fresh and decided ones stay", async () => {
    const old = await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: "860000000000000001", payload: { description: "форма" } },
      context,
    );
    const fresh = await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "222", applicantDiscordId: "860000000000000002", payload: { description: "форма" } },
      context,
    );
    const approved = await prisma.registration.create({
      data: {
        kind: RegistrationKind.UNIFORM,
        staticId: "333",
        applicantDiscordId: "860000000000000003",
        payload: {},
        decision: DecisionStatus.APPROVED,
        createdAt: new Date(Date.now() - 60 * DAY),
      },
    });
    await prisma.registration.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 15 * DAY) } });

    expect(await expirePendingRegistrations()).toBe(1);
    expect(await expirePendingRegistrations()).toBe(0);

    const closed = await prisma.registration.findUniqueOrThrow({ where: { id: old.id } });
    expect(closed).toMatchObject({ status: RecordStatus.CLOSED, decision: DecisionStatus.REJECTED, decidedByDiscordId: null });
    expect(closed.rejectionReason).toMatch(/не рассмотрена за 14 дн/);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: fresh.id } })).decision).toBe("PENDING");
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe("ACTIVE");

    const decidedJobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.REGISTRATION_DECIDED } });
    expect(decidedJobs.map((job) => job.payload)).toEqual([{ registrationId: old.id }]);
    expect(await prisma.auditLog.count({ where: { action: "registration.pending_expired" } })).toBe(1);

    // The static is free again.
    await expect(
      createRegistration(
        { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: "860000000000000001", payload: { description: "ещё раз" } },
        context,
      ),
    ).resolves.toBeTruthy();
  });

  it("honours the configured number of days", async () => {
    const registration = await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: "860000000000000001", payload: { description: "форма" } },
      context,
    );
    await prisma.registration.update({ where: { id: registration.id }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    expect(await expirePendingRegistrations()).toBe(0);
    await setSetting("registrations.pendingTtlDays", 3, context);
    expect(await expirePendingRegistrations()).toBe(1);
  });

  it("closes an old pending transfer so the character can apply again", async () => {
    const user = await prisma.user.create({ data: { discordId: "860000000000000010" } });
    const character = await createCharacter({ userId: user.id, slot: 1, staticId: "500", name: "Officer" }, context);
    const input = {
      characterId: character.id,
      fromFactionCode: "LSPD",
      toFactionCode: "GOV",
      fromRank: 5,
      toRank: 4,
      createdByDiscordId: user.discordId,
      documentFileIds: [],
    };
    const transfer = await createTransfer(input, context);
    await expect(createTransfer(input, context)).rejects.toThrow(/уже есть заявка/);

    await prisma.transfer.update({ where: { id: transfer.id }, data: { createdAt: new Date(Date.now() - 15 * DAY) } });
    expect(await expirePendingTransfers()).toBe(1);

    const closed = await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(closed.status).toBe(TransferStatus.CLOSED);
    expect(closed.rejectionReason).toMatch(/не рассмотрена/);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.TRANSFER_DECIDED } })).toBe(1);
    await expect(createTransfer(input, context)).resolves.toBeTruthy();
  });
});

describe("IC blacklist numbers", () => {
  it("are unique under concurrent creation", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        createIcBlacklistEntry(
          {
            staticId: `70${index}`,
            fullName: `Person ${index}`,
            reason: "нарушение",
            forumLink: "https://forum.example/1",
            createdByDiscordId: "860000000000000099",
          },
          context,
        ),
      ),
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(0);
    const numbers = (await prisma.icBlacklistEntry.findMany({ select: { number: true } })).map((entry) => entry.number);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.sort()).toEqual(["BL-001", "BL-002", "BL-003", "BL-004", "BL-005", "BL-006", "BL-007", "BL-008"]);
  });
});
