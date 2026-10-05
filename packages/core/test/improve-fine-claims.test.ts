import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, DecisionStatus, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  canConfirmFinePayment,
  cancelFine,
  claimOverdueFines,
  createCharacter,
  createFine,
  createFinePaymentClaim,
  decideFinePaymentClaim,
  listPendingFineClaims,
  markFinePaid,
  setSetting,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "improve.fines.test" } as const;
const OWNER = "300000000000000001";
const STRANGER = "300000000000000002";
const OFFICER = "300000000000000009";
const CHANNEL = "830000000000000100";
const MANAGER_ROLE = "830000000000000200";

let fineId = "";

async function fine(number: string, staticId: string, deadline = "24h") {
  return createFine(
    {
      number,
      staticId,
      characterName: "John Doe",
      amount: 5000,
      reason: "ст. 12",
      issuedByDiscordId: OFFICER,
      factionCode: "LSPD",
      paymentDeadlineText: deadline,
    },
    context,
  );
}

const claim = (overrides: Record<string, unknown> = {}) =>
  createFinePaymentClaim(
    { fineId, claimantDiscordId: OWNER, comment: "Оплатил в банке", evidenceFileIds: ["file-1"], ...overrides },
    context,
  );

beforeEach(async () => {
  await resetDatabase();
  await setSetting("fines.claimChannelId", CHANNEL, context);
  const user = await prisma.user.create({ data: { discordId: OWNER } });
  await createCharacter({ userId: user.id, slot: 1, staticId: "391200", name: "John Doe" }, context);
  fineId = (await fine("F-042", "391200")).id;
});
afterAll(() => prisma.$disconnect());

const jobs = (type: string) => prisma.job.count({ where: { type } });

describe("reporting a paid fine", () => {
  it("is off until a channel for the reports is chosen", async () => {
    await setSetting("fines.claimChannelId", null, context);
    await expect(claim()).rejects.toThrow(/не настроен/);
  });

  it("takes one report per fine, with a screenshot, and queues it for the staff", async () => {
    await expect(claim({ evidenceFileIds: [] })).rejects.toThrow(/скриншот/i);

    const created = await claim();
    expect(created.decision).toBe(DecisionStatus.PENDING);
    const buttons = created.reviewButtons as { approve?: string; reject?: string };
    expect(buttons.approve).toMatch(/^mirror:fine\.claim_approve:/);
    expect(buttons.reject).toMatch(/^mirror:fine\.claim_reject:/);
    expect(await jobs(MODULE_JOB_TYPES.FINE_CLAIM_REVIEW)).toBe(1);

    await expect(claim()).rejects.toThrow(/уже ждёт/);
    expect((await listPendingFineClaims([fineId])).get(fineId)?.id).toBe(created.id);
  });

  it("belongs to the owner of the static; a static nobody owns may be reported by anyone", async () => {
    await expect(claim({ claimantDiscordId: STRANGER })).rejects.toThrow(/владелец/);

    const unowned = await fine("F-043", "777000");
    const created = await createFinePaymentClaim(
      { fineId: unowned.id, claimantDiscordId: STRANGER, evidenceFileIds: ["file-2"] },
      context,
    );
    expect(created.claimantDiscordId).toBe(STRANGER);
  });

  it("marks the fine paid when the staff confirms, once and not by the reporter", async () => {
    const created = await claim();
    await expect(decideFinePaymentClaim(created.id, DecisionStatus.APPROVED, OWNER, null, context)).rejects.toThrow(
      /Своё сообщение/,
    );

    const decided = await decideFinePaymentClaim(created.id, DecisionStatus.APPROVED, OFFICER, null, context);
    expect(decided).toMatchObject({ decision: DecisionStatus.APPROVED, decidedByDiscordId: OFFICER });
    const paid = await prisma.fine.findUniqueOrThrow({ where: { id: fineId } });
    expect(paid.status).toBe(RecordStatus.CLOSED);
    expect(paid.paidByDiscordId).toBe(OFFICER);
    expect(paid.paidAt).toBeInstanceOf(Date);

    expect(await jobs(MODULE_JOB_TYPES.FINE_EDIT_PAID)).toBe(1);
    expect(await jobs(MODULE_JOB_TYPES.FINE_CLAIM_DECIDED)).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "fine.paid", entityId: fineId } })).toBe(1);
    expect(await prisma.buttonAction.count({ where: { status: RecordStatus.ACTIVE } })).toBe(0);
    await expect(decideFinePaymentClaim(created.id, DecisionStatus.REJECTED, OFFICER, "нет", context)).rejects.toThrow(
      /уже/,
    );
  });

  it("leaves the fine unpaid after a refusal and lets the person report again", async () => {
    const created = await claim();
    await expect(decideFinePaymentClaim(created.id, DecisionStatus.REJECTED, OFFICER, " ", context)).rejects.toThrow(
      /причину/,
    );
    const decided = await decideFinePaymentClaim(created.id, DecisionStatus.REJECTED, OFFICER, "Скриншот не тот", context);
    expect(decided.rejectionReason).toBe("Скриншот не тот");
    expect((await prisma.fine.findUniqueOrThrow({ where: { id: fineId } })).status).toBe(RecordStatus.ACTIVE);
    await expect(claim()).resolves.toMatchObject({ decision: DecisionStatus.PENDING });
  });

  it("is settled when the fine is paid by the command or cancelled", async () => {
    const first = await claim();
    await markFinePaid({ fineNumber: "F-042", paidByDiscordId: OFFICER }, context);
    expect(await prisma.finePaymentClaim.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      decision: DecisionStatus.APPROVED,
      decidedByDiscordId: OFFICER,
    });
    expect(await jobs(MODULE_JOB_TYPES.FINE_CLAIM_DECIDED)).toBe(1);

    const other = await fine("F-044", "391200");
    const second = await createFinePaymentClaim(
      { fineId: other.id, claimantDiscordId: OWNER, evidenceFileIds: ["file-3"] },
      context,
    );
    await cancelFine(other.id, context);
    expect(await prisma.finePaymentClaim.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      decision: DecisionStatus.REJECTED,
      rejectionReason: "Штраф отменён.",
    });
    await expect(
      createFinePaymentClaim({ fineId: other.id, claimantDiscordId: OWNER, evidenceFileIds: ["file-4"] }, context),
    ).rejects.toThrow(/оплачен или закрыт/);
  });

  it("holds the overdue notice while a report waits for the staff", async () => {
    const created = await claim();
    const afterDeadline = new Date(Date.now() + 48 * 3_600_000);
    expect(await claimOverdueFines(afterDeadline)).toBe(0);

    await decideFinePaymentClaim(created.id, DecisionStatus.REJECTED, OFFICER, "Нет оплаты", context);
    expect(await claimOverdueFines(afterDeadline)).toBe(1);
  });
});

describe("who may confirm a payment", () => {
  const nobody = { adminLevel: null, isSuperAdmin: false } as const;

  it("is whoever may run /штраф-оплачено: administrators and the fine manager roles", () => {
    expect(canConfirmFinePayment({ adminLevel: AdminLevel.ADMIN, isSuperAdmin: false }, [], [MANAGER_ROLE])).toBe(true);
    expect(canConfirmFinePayment(nobody, [MANAGER_ROLE], [MANAGER_ROLE])).toBe(true);
    expect(canConfirmFinePayment(nobody, ["830000000000000201"], [MANAGER_ROLE])).toBe(false);
    expect(canConfirmFinePayment({ adminLevel: AdminLevel.HELPER, isSuperAdmin: false }, [], [MANAGER_ROLE])).toBe(false);
  });
});
