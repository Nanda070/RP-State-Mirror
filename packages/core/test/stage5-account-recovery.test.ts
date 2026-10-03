import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RegistrationKind } from "@mirror/db";
import {
  AccountRecoveryError,
  MODULE_JOB_TYPES,
  createAccountRecovery,
  createCharacter,
  decideAccountRecovery,
  issueToken,
  listAccountRecoveriesFor,
  previewAccountRecovery,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.recovery.test" } as const;
const OLD = "820000000000000001";
const NEW = "820000000000000002";
const ADMIN = "820000000000000009";

async function seedOldAccount() {
  const old = await prisma.user.create({ data: { discordId: OLD } });
  const first = await createCharacter({ userId: old.id, slot: 1, staticId: "111", name: "Ivan Petrov" }, context);
  const second = await createCharacter({ userId: old.id, slot: 3, staticId: "222", name: "Second One" }, context);
  const token = await issueToken(first.id, context);
  await prisma.registration.create({
    data: { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: OLD, payload: {} },
  });
  await prisma.transfer.create({
    data: { characterId: first.id, fromFactionCode: "FIB", toFactionCode: "LSPD", fromRank: 1, toRank: 1, createdByDiscordId: OLD },
  });
  return { old, first, second, token };
}

function request(overrides: Partial<Parameters<typeof createAccountRecovery>[0]> = {}) {
  return createAccountRecovery(
    { newDiscordId: NEW, oldDiscordId: OLD, characterName: "ivan petrov", staticId: "111", reason: "Потерял доступ к почте", ...overrides },
    context,
  );
}

describe("account recovery", () => {
  it("moves characters, badges, registrations and transfers to the new account on approval", async () => {
    const { first, second, token } = await seedOldAccount();
    const newUser = await prisma.user.create({ data: { discordId: NEW } });
    await createCharacter({ userId: newUser.id, slot: 1, staticId: "900", name: "Already Here" }, context);
    const created = await request();

    const preview = await previewAccountRecovery(created.id);
    expect(preview).toMatchObject({ canApprove: true, blocker: null, nameMatches: true, newCharacterCount: 1 });
    expect(preview.oldCharacters.map((c) => c.staticId)).toEqual(["111", "222"]);

    const decided = await decideAccountRecovery(created.id, DecisionStatus.APPROVED, ADMIN, null, context);
    expect(decided.decision).toBe(DecisionStatus.APPROVED);
    expect(decided.movedCharacterIds).toEqual([first.id, second.id]);

    const moved = await prisma.character.findMany({ where: { userId: newUser.id }, orderBy: { slot: "asc" } });
    expect(moved.map((c) => [c.slot, c.staticId])).toEqual([[1, "900"], [2, "111"], [3, "222"]]);
    expect(await prisma.character.count({ where: { user: { discordId: OLD } } })).toBe(0);
    expect((await prisma.token.findUniqueOrThrow({ where: { number: token.number } })).characterId).toBe(first.id);
    expect(await prisma.registration.count({ where: { applicantDiscordId: NEW } })).toBe(1);
    expect(await prisma.transfer.count({ where: { createdByDiscordId: NEW } })).toBe(1);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.ACCOUNT_RECOVERY_DECIDED } })).toBe(1);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "account_recovery.approved" } });
    expect(audit.metadata).toMatchObject({ registrations: 1, transfers: 1 });
  });

  it("creates the new user on approval when the account has never used the bot", async () => {
    await seedOldAccount();
    const created = await request();
    await decideAccountRecovery(created.id, DecisionStatus.APPROVED, ADMIN, null, context);
    const newUser = await prisma.user.findUniqueOrThrow({ where: { discordId: NEW }, include: { characters: true } });
    expect(newUser.characters.map((c) => c.slot).sort()).toEqual([1, 2]);
  });

  it("accepts a request without revealing ownership, but blocks approval of a wrong static", async () => {
    await seedOldAccount();
    const created = await request({ staticId: "777" });
    const preview = await previewAccountRecovery(created.id);
    expect(preview.canApprove).toBe(false);
    expect(preview.blocker).toMatch(/не принадлежит/);

    await expect(
      decideAccountRecovery(created.id, DecisionStatus.APPROVED, ADMIN, null, context),
    ).rejects.toBeInstanceOf(AccountRecoveryError);
    expect(await prisma.character.count({ where: { user: { discordId: OLD } } })).toBe(2);
    expect((await prisma.accountRecovery.findUniqueOrThrow({ where: { id: created.id } })).decision).toBe("PENDING");
  });

  it("blocks approval when the new account has no room and moves nothing", async () => {
    await seedOldAccount();
    const newUser = await prisma.user.create({ data: { discordId: NEW } });
    await createCharacter({ userId: newUser.id, slot: 1, staticId: "901", name: "A" }, context);
    await createCharacter({ userId: newUser.id, slot: 2, staticId: "902", name: "B" }, context);
    const created = await request();

    expect((await previewAccountRecovery(created.id)).blocker).toMatch(/не хватает слотов/);
    await expect(
      decideAccountRecovery(created.id, DecisionStatus.APPROVED, ADMIN, null, context),
    ).rejects.toBeInstanceOf(AccountRecoveryError);
    expect(await prisma.character.count({ where: { userId: newUser.id } })).toBe(2);
  });

  it("rejects with a reason, notifies, and frees the account for a new request", async () => {
    await seedOldAccount();
    const created = await request();
    await expect(request()).rejects.toBeInstanceOf(AccountRecoveryError);
    await expect(
      decideAccountRecovery(created.id, DecisionStatus.REJECTED, ADMIN, "  ", context),
    ).rejects.toBeInstanceOf(AccountRecoveryError);

    const rejected = await decideAccountRecovery(created.id, DecisionStatus.REJECTED, ADMIN, "Нет подтверждения", context);
    expect(rejected).toMatchObject({ decision: "REJECTED", rejectionReason: "Нет подтверждения", movedCharacterIds: [] });
    expect(await prisma.character.count({ where: { user: { discordId: OLD } } })).toBe(2);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.ACCOUNT_RECOVERY_DECIDED } })).toBe(1);

    await request();
    expect((await listAccountRecoveriesFor(NEW)).map((r) => r.decision)).toEqual(["PENDING", "REJECTED"]);
  });

  it("guards: same account, own request, double decision, daily limit", async () => {
    await seedOldAccount();
    await expect(request({ oldDiscordId: NEW })).rejects.toBeInstanceOf(AccountRecoveryError);
    await expect(request({ oldDiscordId: "not-an-id" })).rejects.toThrow();
    await expect(request({ reason: "коротко" })).rejects.toThrow();

    const created = await request();
    for (const actor of [NEW, OLD]) {
      await expect(
        decideAccountRecovery(created.id, DecisionStatus.APPROVED, actor, null, context),
      ).rejects.toBeInstanceOf(AccountRecoveryError);
    }

    // Two admins press «approve» at the same moment: exactly one wins.
    const results = await Promise.allSettled([
      decideAccountRecovery(created.id, DecisionStatus.APPROVED, ADMIN, null, context),
      decideAccountRecovery(created.id, DecisionStatus.REJECTED, "820000000000000008", "дубль", context),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.ACCOUNT_RECOVERY_DECIDED } })).toBe(1);

    await prisma.accountRecovery.createMany({
      data: [1, 2].map(() => ({
        newDiscordId: NEW, oldDiscordId: OLD, characterName: "x", staticId: "1", reason: "r", decision: DecisionStatus.REJECTED,
      })),
    });
    await expect(request()).rejects.toThrow(/Слишком много заявок/);
  });
});
