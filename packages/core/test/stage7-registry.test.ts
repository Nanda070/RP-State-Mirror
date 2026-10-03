import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, JobStatus, RecordStatus, RegistrationKind, TransferStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  RegistryActionError,
  UserError,
  auditActorDiscordId,
  claimOverdueFines,
  createFine,
  createIcBlacklistEntry,
  createPersonnelEvent,
  createRegistration,
  createTransfer,
  createWanted,
  decideRegistration,
  decideTransfer,
  discordWebhookUrlSchema,
  enqueueCpReconcile,
  enqueueJob,
  getSetting,
  listAuditLogPage,
  listCharactersPage,
  listDocumentsPage,
  listFinesPage,
  listIcBlacklistPage,
  listJobsPage,
  listPersonnelPage,
  listTransfersPage,
  listWantedPage,
  receiveTokenForStatic,
  runRegistryAction,
  updateFactionDeliverySchema,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage7.test" } as const;
const ADMIN = "880000000000000001";
const OTHER_ADMIN = "880000000000000002";
const PLAYER = "880000000000000003";
const DAY = 86_400_000;

const act = (entity: Parameters<typeof runRegistryAction>[0]["entity"], id: string, action: string, text?: string) =>
  runRegistryAction({ entity, id, action, actorDiscordId: ADMIN, ...(text ? { text } : {}) }, context);

const jobsOf = (type: string) => prisma.job.count({ where: { type } });

async function makeCharacter(staticId = "555") {
  const user = await prisma.user.create({ data: { discordId: PLAYER } });
  const { token } = await receiveTokenForStatic({ userId: user.id, staticId, name: "Ivan Petrov" }, context);
  const character = await prisma.character.findFirstOrThrow({ where: { staticId } });
  return { user, token, character };
}

const makeFine = (number: string, staticId = "111") =>
  createFine(
    {
      number,
      characterName: "Ivan Petrov",
      staticId,
      amount: 5000,
      reason: "ст. 1",
      factionCode: "LSPD",
      paymentDeadlineText: "1d",
      issuedByDiscordId: ADMIN,
    },
    context,
  );

const makeWanted = (number: string, staticId = "111") =>
  createWanted(
    {
      number,
      characterName: "Ivan Petrov",
      staticId,
      reason: "ст. 10",
      termText: "5 лет",
      forumLink: "https://forum.example/t",
      issuedByDiscordId: ADMIN,
    },
    context,
  );

describe("command rights settings", () => {
  it("default to empty role lists, so the rules that existed before stay in force", async () => {
    for (const key of [
      "documents.posterRoleIds",
      "documents.responderRoleIds",
      "fines.managerRoleIds",
      "personnel.managerRoleIds",
    ] as const) {
      expect(await getSetting(key)).toEqual([]);
    }
  });
});

describe("overdue fines", () => {
  it("announces a fine once when its deadline passes, and never a paid one", async () => {
    const overdue = await makeFine("F-1");
    const fresh = await makeFine("F-2", "222");
    const paid = await makeFine("F-3", "333");
    await prisma.fine.updateMany({
      where: { id: { in: [overdue.id, paid.id] } },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });
    await act("fine", paid.id, "paid");

    expect(await claimOverdueFines()).toBe(1);
    expect(await claimOverdueFines()).toBe(0);
    const job = await prisma.job.findFirstOrThrow({ where: { type: MODULE_JOB_TYPES.FINE_OVERDUE } });
    expect(job.payload).toEqual({ fineId: overdue.id });
    expect((await prisma.fine.findUniqueOrThrow({ where: { id: overdue.id } })).overdueNotified).toBe(true);
    expect((await prisma.fine.findUniqueOrThrow({ where: { id: fresh.id } })).overdueNotified).toBe(false);

    // The registry filter «Просрочен» shows exactly it.
    expect((await listFinesPage({ status: "OVERDUE" })).items.map((fine) => fine.number)).toEqual(["F-1"]);
  });
});

describe("registry actions", () => {
  it("closes and cancels wanted orders and queues the card update", async () => {
    const first = await makeWanted("W-1");
    const second = await makeWanted("W-2", "222");

    await expect(act("wanted", first.id, "close")).rejects.toBeInstanceOf(RegistryActionError);
    expect(await act("wanted", first.id, "close", "https://forum.example/proof")).toContain("W-1");
    expect(await prisma.wanted.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: RecordStatus.CLOSED,
      closedByDiscordId: ADMIN,
      evidence: "https://forum.example/proof",
    });
    expect(await jobsOf(MODULE_JOB_TYPES.WANTED_EDIT_CLOSED)).toBe(1);

    await act("wanted", second.id, "cancel");
    expect((await prisma.wanted.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(RecordStatus.REVOKED);
    // A closed record cannot be closed again; the message is meant for the admin.
    await expect(act("wanted", first.id, "close", "x")).rejects.toBeInstanceOf(UserError);
    await expect(act("wanted", "missing", "cancel")).rejects.toBeInstanceOf(UserError);
    await expect(act("wanted", first.id, "explode")).rejects.toThrow("Неизвестное действие");
  });

  it("marks a fine paid or cancels it", async () => {
    const fine = await makeFine("F-1");
    const mistake = await makeFine("F-2", "222");

    await act("fine", fine.id, "paid");
    expect(await prisma.fine.findUniqueOrThrow({ where: { id: fine.id } })).toMatchObject({
      status: RecordStatus.CLOSED,
      paidByDiscordId: ADMIN,
    });
    expect(await jobsOf(MODULE_JOB_TYPES.FINE_EDIT_PAID)).toBe(1);

    await act("fine", mistake.id, "cancel");
    expect((await prisma.fine.findUniqueOrThrow({ where: { id: mistake.id } })).status).toBe(RecordStatus.REVOKED);
    await expect(act("fine", fine.id, "paid")).rejects.toBeInstanceOf(UserError);
  });

  it("decides registrations from the dashboard and withdraws an approved one", async () => {
    const pending = await createRegistration(
      { kind: RegistrationKind.VEHICLE, staticId: "111", plate: "AB123", applicantDiscordId: PLAYER, payload: { model: "Sultan" } },
      context,
    );
    const refused = await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "222", applicantDiscordId: PLAYER, payload: { description: "форма" } },
      context,
    );

    await expect(act("registration", refused.id, "reject")).rejects.toThrow("причину");
    await act("registration", refused.id, "reject", "нет фото");
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: refused.id } })).toMatchObject({
      decision: DecisionStatus.REJECTED,
      rejectionReason: "нет фото",
    });

    await expect(act("registration", pending.id, "revoke", "ошибка")).rejects.toThrow("одобренную");
    await act("registration", pending.id, "approve");
    await act("registration", pending.id, "revoke", "ТС продано");
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: RecordStatus.REVOKED,
      rejectionReason: "ТС продано",
    });
    // The static and the plate are free again.
    await createRegistration(
      { kind: RegistrationKind.VEHICLE, staticId: "111", plate: "AB123", applicantDiscordId: PLAYER, payload: { model: "Sultan" } },
      context,
    );
    expect(await jobsOf(MODULE_JOB_TYPES.REGISTRATION_EXPIRED)).toBe(1);
  });

  it("does not let anyone decide their own application — in the bot and in the dashboard alike", async () => {
    const own = await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: ADMIN, payload: { description: "форма" } },
      context,
    );
    await expect(decideRegistration(own.id, DecisionStatus.APPROVED, ADMIN, null, context)).rejects.toThrow("своей заявке");
    await expect(act("registration", own.id, "approve")).rejects.toThrow("своей заявке");
    await decideRegistration(own.id, DecisionStatus.APPROVED, OTHER_ADMIN, null, context);

    const { character } = await makeCharacter();
    const transfer = await createTransfer(
      { characterId: character.id, fromFactionCode: "LSPD", toFactionCode: "FIB", fromRank: 3, toRank: 2, createdByDiscordId: ADMIN },
      context,
    );
    await expect(decideTransfer(transfer.id, "source", DecisionStatus.APPROVED, ADMIN, null, context)).rejects.toThrow(
      "своей заявке",
    );
  });

  it("decides a transfer side by side and cancels a pending one", async () => {
    const { character } = await makeCharacter();
    const create = () =>
      createTransfer(
        { characterId: character.id, fromFactionCode: "LSPD", toFactionCode: "FIB", fromRank: 3, toRank: 2, createdByDiscordId: PLAYER },
        context,
      );
    const transfer = await create();

    await act("transfer", transfer.id, "approve_source");
    expect((await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(TransferStatus.PENDING);
    await act("transfer", transfer.id, "approve_target");
    expect(await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).toMatchObject({
      status: TransferStatus.APPROVED,
      sourceDecidedByDiscordId: ADMIN,
      targetDecidedByDiscordId: ADMIN,
    });
    await expect(act("transfer", transfer.id, "cancel", "поздно")).rejects.toThrow("уже закрыт");

    const second = await create();
    await expect(act("transfer", second.id, "reject_target")).rejects.toThrow("причину");
    await act("transfer", second.id, "cancel", "подан по ошибке");
    expect(await prisma.transfer.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: TransferStatus.CLOSED,
      rejectionReason: "подан по ошибке",
    });
    // A closed transfer no longer blocks a new one.
    await create();
  });

  it("revokes a badge, fixes a static and archives a character to free the slot", async () => {
    const { user, token, character } = await makeCharacter("555");

    await act("character", character.id, "set_static", "556");
    expect((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).staticId).toBe("556");

    await act("token", token.id, "revoke");
    expect((await prisma.token.findUniqueOrThrow({ where: { id: token.id } })).status).toBe(RecordStatus.REVOKED);
    await expect(act("token", token.id, "revoke")).rejects.toBeInstanceOf(UserError);

    const again = await receiveTokenForStatic({ userId: user.id, staticId: "556" }, context);
    await expect(act("character", character.id, "archive")).rejects.toThrow("причину");
    await act("character", character.id, "archive", "ошибка в статике");
    expect((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).status).toBe(RecordStatus.ARCHIVED);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: again.token.id } })).status).toBe(RecordStatus.REVOKED);
    // Nothing is deleted, and the static can be taken again.
    expect(await prisma.character.count()).toBe(1);
    await receiveTokenForStatic({ userId: user.id, staticId: "556" }, context);
    expect(await prisma.character.count({ where: { status: RecordStatus.ACTIVE } })).toBe(1);
  });

  it("closes a blacklist record and revokes a personnel event", async () => {
    const entry = await createIcBlacklistEntry(
      { fullName: "Ivan Petrov", staticId: "111", reason: "нарушения", forumLink: "https://forum.example/t", createdByDiscordId: ADMIN },
      context,
    );
    await expect(act("ic_blacklist", entry.id, "close")).rejects.toThrow("причину");
    await act("ic_blacklist", entry.id, "close", "амнистия");
    expect(await prisma.icBlacklistEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
      status: RecordStatus.CLOSED,
      closeReason: "амнистия",
    });
    expect(await jobsOf(MODULE_JOB_TYPES.IC_BLACKLIST_EDIT_CLOSED)).toBe(1);

    const event = await createPersonnelEvent(
      { factionCode: "LSPD", type: "dismissal", subjectDiscordId: PLAYER, subjectName: "Ivan", actorDiscordId: ADMIN, details: { reason: "по собственному желанию" } },
      context,
    );
    await act("personnel", event.id, "revoke");
    expect((await prisma.personnelEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(RecordStatus.REVOKED);
  });

  it("retries a failed job with fresh attempts and cancels a waiting one", async () => {
    const failed = await enqueueJob({ type: "test.failed", payload: {} });
    await prisma.job.update({
      where: { id: failed.id },
      data: { status: JobStatus.FAILED, attempts: 5, lastError: "boom", completedAt: new Date() },
    });
    await act("job", failed.id, "retry");
    expect(await prisma.job.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 0,
      lastError: null,
      completedAt: null,
    });

    await act("job", failed.id, "cancel");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe(JobStatus.CANCELLED);
    await expect(act("job", failed.id, "cancel")).rejects.toThrow("ожидающую");

    const reconcile = await enqueueCpReconcile(ADMIN);
    expect(reconcile).toMatchObject({ type: MODULE_JOB_TYPES.CP_RECONCILE, maxAttempts: 1 });
    await expect(act("job", reconcile.id, "retry")).rejects.toThrow("упавшую");
  });

  it("writes every action to the audit log", async () => {
    const wanted = await makeWanted("W-1");
    await act("wanted", wanted.id, "cancel");
    const log = await listAuditLogPage({ entityType: "wanted" });
    expect(log.items.map((event) => event.action)).toEqual(["wanted.revoked", "wanted.created"]);
    expect(log.total).toBe(2);
  });
});

describe("registry listings", () => {
  it("search, filter by status and split into pages", async () => {
    for (let index = 1; index <= 55; index += 1) await makeWanted(`W-${index}`, String(1000 + index));
    const closed = await prisma.wanted.findFirstOrThrow({ where: { number: "W-7" } });
    await act("wanted", closed.id, "cancel");

    const first = await listWantedPage({});
    expect(first).toMatchObject({ total: 55, page: 1, pages: 2 });
    expect(first.items).toHaveLength(50);
    expect((await listWantedPage({ page: 2 })).items).toHaveLength(5);
    expect((await listWantedPage({ page: 99 })).items).toHaveLength(0);

    expect((await listWantedPage({ q: "w-55" })).items.map((item) => item.number)).toEqual(["W-55"]);
    expect((await listWantedPage({ q: "1042" })).items.map((item) => item.staticId)).toEqual(["1042"]);
    expect((await listWantedPage({ status: "REVOKED" })).items.map((item) => item.number)).toEqual(["W-7"]);
    expect((await listWantedPage({ status: "NOT_A_STATUS" })).total).toBe(55);
    expect((await listWantedPage({ q: "нет такого" })).total).toBe(0);
  });

  it("cover every registry the dashboard shows", async () => {
    const { character } = await makeCharacter("555");
    await makeFine("F-1");
    await createIcBlacklistEntry(
      { fullName: "Petr Sidorov", staticId: "777", reason: "нарушения", forumLink: "https://forum.example/t", createdByDiscordId: ADMIN },
      context,
    );
    await createPersonnelEvent(
      { factionCode: "FIB", type: "dismissal", subjectDiscordId: PLAYER, subjectName: "Ivan", actorDiscordId: ADMIN, details: { reason: "по собственному желанию" } },
      context,
    );
    await createTransfer(
      { characterId: character.id, fromFactionCode: "LSPD", toFactionCode: "FIB", fromRank: 3, toRank: 2, createdByDiscordId: PLAYER },
      context,
    );

    expect((await listFinesPage({ q: "lspd" })).total).toBe(1);
    expect((await listIcBlacklistPage({ q: "sidorov" })).total).toBe(1);
    expect((await listPersonnelPage({ q: "FIB" })).total).toBe(1);
    expect((await listTransfersPage({ q: "555" })).items[0]?.character.staticId).toBe("555");
    expect((await listTransfersPage({ status: "APPROVED" })).total).toBe(0);
    expect((await listCharactersPage({ q: PLAYER })).items[0]?.tokens).toHaveLength(1);
    expect((await listDocumentsPage({})).total).toBe(0);
    expect((await listJobsPage({ q: "transfer" })).total).toBeGreaterThan(0);
  });

  it("filter the audit log by author, entity and period", async () => {
    const userContext = { actorType: AuditActorType.USER, source: "bot.slash", metadata: { discordUserId: ADMIN } };
    await createWanted(
      { number: "W-1", characterName: "Ivan", staticId: "1", reason: "ст.", termText: "1", forumLink: "https://forum.example/t", issuedByDiscordId: ADMIN },
      userContext,
    );
    await makeFine("F-1");

    const byAuthor = await listAuditLogPage({ actorDiscordId: ADMIN });
    expect(byAuthor.items.map((event) => event.action)).toEqual(["wanted.created"]);
    expect(auditActorDiscordId(byAuthor.items[0]!)).toBe(ADMIN);

    expect((await listAuditLogPage({ entityType: "fine" })).total).toBe(1);
    expect((await listAuditLogPage({ q: "wanted" })).total).toBe(1);
    expect((await listAuditLogPage({ from: new Date(Date.now() + DAY) })).total).toBe(0);
    expect((await listAuditLogPage({ to: new Date(Date.now() + DAY) })).total).toBe(2);
  });
});

describe("faction delivery webhooks", () => {
  it("accept only Discord webhook addresses", () => {
    const good = "https://discord.com/api/webhooks/123456789012345678/abc-DEF_123";
    expect(discordWebhookUrlSchema.safeParse(good).success).toBe(true);
    expect(updateFactionDeliverySchema.safeParse({ factionCode: "LSPD", documentsWebhookUrl: good }).success).toBe(true);
    for (const bad of [
      "https://evil.example/api/webhooks/1/x",
      "http://discord.com/api/webhooks/1/x",
      "https://discord.com.evil.example/api/webhooks/1/x",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(updateFactionDeliverySchema.safeParse({ factionCode: "LSPD", personnelWebhookUrl: bad }).success).toBe(false);
    }
    expect(updateFactionDeliverySchema.safeParse({ factionCode: "LSPD", documentsWebhookUrl: null }).success).toBe(true);
  });
});
