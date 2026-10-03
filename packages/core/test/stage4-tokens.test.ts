import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, RecordStatus } from "@mirror/db";
import {
  canFindTokens,
  createCharacter,
  findTokens,
  formatTokenDisplay,
  issueToken,
  receiveTokenForStatic,
  updateCharacterStaticId,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.tokens.test" } as const;

describe("token display and lookup", () => {
  it("formats the faction badge", () => {
    expect(formatTokenDisplay({ factionCode: "LSPD", department: "Patrol", number: "1234" })).toBe(
      "[LSPD | Patrol | 1234]",
    );
    expect(formatTokenDisplay({ number: "99" })).toBe("[— | — | 99]");
  });

  it("finds by number, static id and discord id", async () => {
    const user = await prisma.user.create({ data: { discordId: "700000000000000001" } });
    const character = await createCharacter(
      {
        userId: user.id,
        slot: 1,
        staticId: "S-700",
        name: "Find Me",
        factionCode: "GOV",
        department: "ОГП",
      },
      context,
    );
    const token = await issueToken(character.id, context);

    expect((await findTokens(token.number))[0]?.display).toBe("[GOV | ОГП | " + token.number + "]");
    expect((await findTokens("S-700"))[0]?.ownerDiscordId).toBe(user.discordId);
    expect((await findTokens(user.discordId))[0]?.character.staticId).toBe("S-700");
    expect(await findTokens("missing")).toEqual([]);
  });

  it("lets admins rename a static and keeps archived ones free", async () => {
    const user = await prisma.user.create({ data: { discordId: "701" } });
    await createCharacter({ userId: user.id, slot: 1, staticId: "OLD", name: "A" }, context);
    const updated = await updateCharacterStaticId({ currentStaticId: "OLD", newStaticId: "NEW" }, context);
    expect(updated.staticId).toBe("NEW");
    await expect(updateCharacterStaticId({ currentStaticId: "OLD", newStaticId: "X" }, context)).rejects.toThrow(
      /не найден/,
    );

    await prisma.character.update({ where: { id: updated.id }, data: { status: RecordStatus.ARCHIVED } });
    await createCharacter({ userId: user.id, slot: 1, staticId: "NEW", name: "B" }, context);
  });
});

describe("token find access", () => {
  it("allows admins or configured finder roles", () => {
    expect(canFindTokens({ adminLevel: AdminLevel.ADMIN, isSuperAdmin: false }, [], [])).toBe(true);
    expect(canFindTokens({ adminLevel: null, isSuperAdmin: false }, ["1"], ["1"])).toBe(true);
    expect(canFindTokens({ adminLevel: null, isSuperAdmin: false }, ["1"], ["2"])).toBe(false);
  });
});

describe("token receive by static", () => {
  it("creates a character when needed and issues a badge", async () => {
    const user = await prisma.user.create({ data: { discordId: "702000000000000001" } });
    const first = await receiveTokenForStatic(
      { userId: user.id, staticId: "RECV-1", factionCode: "LSPD", department: "Patrol" },
      context,
    );
    expect(first.created).toBe(true);
    expect(first.character.staticId).toBe("RECV-1");
    expect(first.character.slot).toBe(1);
    expect(first.token.number.length).toBeGreaterThanOrEqual(4);

    await expect(
      receiveTokenForStatic({ userId: user.id, staticId: "RECV-1" }, context),
    ).rejects.toThrow(/уже есть активная/);

    const second = await receiveTokenForStatic({ userId: user.id, staticId: "RECV-2" }, context);
    expect(second.created).toBe(true);
    expect(second.character.slot).toBe(2);
  });

  it("rejects a static owned by another user", async () => {
    const owner = await prisma.user.create({ data: { discordId: "703" } });
    const other = await prisma.user.create({ data: { discordId: "704" } });
    await createCharacter({ userId: owner.id, slot: 1, staticId: "TAKEN", name: "Owner" }, context);
    await expect(
      receiveTokenForStatic({ userId: other.id, staticId: "TAKEN" }, context),
    ).rejects.toThrow(/другому персонажу/);
  });
});
