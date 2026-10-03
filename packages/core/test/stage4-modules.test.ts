import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RecordStatus, RegistrationKind, TransferStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  allocateTokenNumber,
  createCharacter,
  createFeedbackTicket,
  createRegistration,
  createTransfer,
  addFeedbackMessage,
  decideRegistration,
  decideTransfer,
  issueToken,
  revokeToken,
  submitDiscordForm,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.test" } as const;

async function createUser(discordId: string) {
  return prisma.user.create({ data: { discordId } });
}

async function createTestTransfer(discordId: string) {
  const user = await createUser(discordId);
  const character = await createCharacter({ userId: user.id, slot: 1, staticId: `S-${discordId}`, name: "Officer" }, context);
  const transfer = await createTransfer(
    {
      characterId: character.id,
      fromFactionCode: "LSPD",
      toFactionCode: "GOV",
      fromRank: 5,
      toRank: 4,
      createdByDiscordId: discordId,
      documentFileIds: [],
    },
    context,
  );
  return { user, character, transfer };
}

async function createVehicleRegistration(discordId: string) {
  const user = await createUser(discordId);
  const character = await createCharacter({ userId: user.id, slot: 1, staticId: `S-${discordId}`, name: "Driver" }, context);
  const registration = await createRegistration(
    { kind: RegistrationKind.VEHICLE, characterId: character.id, payload: { model: "Sultan", plate: "A123AA" } },
    context,
  );
  return { user, character, registration };
}

describe("stage 4 modules", () => {
  it("limits a user to three active characters and issues one token per character", async () => {
    const user = await createUser("100");
    for (let slot = 1; slot <= 3; slot += 1) {
      await createCharacter({ userId: user.id, slot, staticId: `S-${slot}`, name: `Character ${slot}` }, context);
    }
    await expect(
      createCharacter({ userId: user.id, slot: 1, staticId: "S-4", name: "Too many" }, context),
    ).rejects.toThrow(/три активных/);

    const character = await prisma.character.findFirstOrThrow({ where: { staticId: "S-1" } });
    const token = await issueToken(character.id, context);
    expect(token.number).toMatch(/^\d{4}$/);
    await expect(issueToken(character.id, context)).rejects.toThrow(/уже есть активная/);
  });

  it("re-issues a token after the previous one was revoked", async () => {
    const user = await createUser("110");
    const character = await createCharacter({ userId: user.id, slot: 1, staticId: "S-110", name: "Badge" }, context);
    const first = await issueToken(character.id, context);
    await revokeToken(first.number, context);
    const second = await issueToken(character.id, context);
    expect(second.number).not.toBe(first.number);
    const tokens = await prisma.token.findMany({ where: { characterId: character.id } });
    expect(tokens.map((t) => t.status).sort()).toEqual([RecordStatus.ACTIVE, RecordStatus.REVOKED]);
  });

  it("frees static id and slot once a character is archived", async () => {
    const user = await createUser("120");
    const character = await createCharacter({ userId: user.id, slot: 1, staticId: "S-120", name: "Old" }, context);
    await expect(
      createCharacter({ userId: user.id, slot: 2, staticId: "S-120", name: "Dup" }, context),
    ).rejects.toThrow(/статик/);
    await prisma.character.update({ where: { id: character.id }, data: { status: RecordStatus.ARCHIVED } });
    const again = await createCharacter({ userId: user.id, slot: 1, staticId: "S-120", name: "New" }, context);
    expect(again.status).toBe(RecordStatus.ACTIVE);
  });

  it("moves to five-digit numbers when free four-digit numbers drop below the threshold", async () => {
    const user = await createUser("130");
    const character = await createCharacter({ userId: user.id, slot: 1, staticId: "S-130", name: "Bulk" }, context);
    // 8200 of 9000 four-digit numbers issued → 8.9 % free < 10 %.
    await prisma.$executeRaw`
      INSERT INTO tokens (id, number, character_id, status)
      SELECT 'bulk-' || n, n::text, ${character.id}, 'REVOKED' FROM generate_series(1000, 9199) AS n`;
    expect(await allocateTokenNumber(prisma)).toMatch(/^\d{5}$/);
  });

  it("creates review buttons and the delivery job in the same transaction as the registration", async () => {
    const { registration } = await createVehicleRegistration("140");
    const buttons = registration.reviewButtons as { approve?: string; reject?: string };
    expect(buttons.approve).toMatch(/^mirror:registration\.approve:/);
    expect(buttons.reject).toMatch(/^mirror:registration\.reject:/);
    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.REGISTRATION_REVIEW } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({ registrationId: registration.id });
  });

  it("allows the first registration decision only once", async () => {
    const { registration } = await createVehicleRegistration("200");
    const approved = await decideRegistration(registration.id, DecisionStatus.APPROVED, "admin-1", null, context);
    expect(approved.decision).toBe(DecisionStatus.APPROVED);
    expect(approved.expiresAt).toBeInstanceOf(Date);
    await expect(
      decideRegistration(registration.id, DecisionStatus.REJECTED, "admin-2", "late", context),
    ).rejects.toThrow(/уже обработана/);
  });

  it("accepts exactly one of two concurrent registration decisions", async () => {
    const { registration } = await createVehicleRegistration("210");
    const results = await Promise.allSettled([
      decideRegistration(registration.id, DecisionStatus.APPROVED, "admin-1", null, context),
      decideRegistration(registration.id, DecisionStatus.REJECTED, "admin-2", "нет", context),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const stored = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    const audit = await prisma.auditLog.count({ where: { entityId: registration.id, action: { not: "registration.created" } } });
    expect(audit).toBe(1);
    expect(stored.decision).not.toBe(DecisionStatus.PENDING);
  });

  it("lets the character apply again after a rejection", async () => {
    const { character, registration } = await createVehicleRegistration("220");
    await decideRegistration(registration.id, DecisionStatus.REJECTED, "admin", "фото нечитаемо", context);
    const next = await createRegistration(
      { kind: RegistrationKind.VEHICLE, characterId: character.id, payload: { model: "Sultan", plate: "B1" } },
      context,
    );
    expect(next.decision).toBe(DecisionStatus.PENDING);
  });

  it("keeps transfer pending until both faction leaders approve", async () => {
    const { transfer } = await createTestTransfer("300");
    const first = await decideTransfer(transfer.id, "source", DecisionStatus.APPROVED, "lead-1", null, context);
    expect(first.status).toBe(TransferStatus.PENDING);
    await expect(
      decideTransfer(transfer.id, "source", DecisionStatus.REJECTED, "lead-1", "передумал", context),
    ).rejects.toThrow(/этой стороны/);
    const second = await decideTransfer(transfer.id, "target", DecisionStatus.APPROVED, "lead-2", null, context);
    expect(second.status).toBe(TransferStatus.APPROVED);
  });

  it("does not lose concurrent approvals from both transfer sides", async () => {
    const { transfer } = await createTestTransfer("310");
    const results = await Promise.allSettled([
      decideTransfer(transfer.id, "source", DecisionStatus.APPROVED, "lead-1", null, context),
      decideTransfer(transfer.id, "target", DecisionStatus.APPROVED, "lead-2", null, context),
    ]);
    expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok"]);
    const stored = await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(stored.sourceDecision).toBe(DecisionStatus.APPROVED);
    expect(stored.targetDecision).toBe(DecisionStatus.APPROVED);
    expect(stored.status).toBe(TransferStatus.APPROVED);
  });

  it("allows only one pending transfer per character", async () => {
    const { character } = await createTestTransfer("320");
    await expect(
      createTransfer(
        {
          characterId: character.id,
          fromFactionCode: "LSPD",
          toFactionCode: "EMS",
          fromRank: 5,
          toRank: 3,
          createdByDiscordId: "320",
        },
        context,
      ),
    ).rejects.toThrow(/уже есть заявка/);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.TRANSFER_REVIEW } })).toBe(1);
  });

  it("validates Discord form submissions and closes feedback conversations", async () => {
    const user = await createUser("400");
    const form = await prisma.discordForm.create({
      data: {
        name: "Заявка",
        responseLimit: 1,
        createdByDiscordId: "admin",
        fields: {
          create: [{ position: 0, key: "text", label: "Текст", type: "short", required: true }],
        },
      },
    });
    await expect(submitDiscordForm(form.id, {}, user.discordId)).rejects.toThrow(/Заполните поле/);
    await submitDiscordForm(form.id, { text: "hello" }, user.discordId);
    await expect(submitDiscordForm(form.id, { text: "second" }, user.discordId)).rejects.toThrow(/Лимит/);

    const ticket = await createFeedbackTicket(
      { authorDiscordId: user.discordId, category: "support", content: "Нужна помощь" },
      context,
    );
    expect(ticket.messages).toHaveLength(1);
    await addFeedbackMessage(ticket.id, "admin", "Разбираемся", context);
    await prisma.feedbackTicket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    await expect(addFeedbackMessage(ticket.id, user.discordId, "Ещё вопрос", context)).rejects.toThrow(/закрыт/);
  });

  it("enforces the form response limit under concurrent submissions", async () => {
    const form = await prisma.discordForm.create({
      data: {
        name: "Лимит",
        responseLimit: 2,
        createdByDiscordId: "admin",
        fields: { create: [{ position: 0, key: "text", label: "Текст", type: "short", required: true }] },
      },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => submitDiscordForm(form.id, { text: `v${i}` }, `u${i}`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(2);
  });
});
