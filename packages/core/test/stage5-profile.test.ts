import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RegistrationKind } from "@mirror/db";
import {
  createCharacter,
  createFine,
  createIcBlacklistEntry,
  createWanted,
  getPlayerProfile,
  issueToken,
  revokeToken,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.profile.test" } as const;
const ME = "810000000000000001";
const OTHER = "810000000000000002";
const ADMIN = "810000000000000009";

describe("player profile", () => {
  it("is empty for an account the project has never seen", async () => {
    expect(await getPlayerProfile(ME)).toEqual({
      characters: [],
      registrations: [],
      transfers: [],
      fines: [],
      wanted: [],
    });
  });

  it("collects characters with badges and records matched by the user's statics only", async () => {
    const me = await prisma.user.create({ data: { discordId: ME } });
    const other = await prisma.user.create({ data: { discordId: OTHER } });
    const mine = await createCharacter({ userId: me.id, slot: 1, staticId: "111", name: "Ivan Mine" }, context);
    await createCharacter({ userId: me.id, slot: 2, staticId: "222", name: "Second Mine" }, context);
    await createCharacter({ userId: other.id, slot: 1, staticId: "999", name: "Not Mine" }, context);

    const first = await issueToken(mine.id, context);
    await revokeToken(first.number, context);
    const current = await issueToken(mine.id, context);

    const fine = { characterName: "x", reason: "ст. 1", amount: 500, paymentDeadlineText: "24h", issuedByDiscordId: ADMIN, factionCode: "GOV" };
    await createFine({ ...fine, number: "F-1", staticId: "111" }, context);
    await createFine({ ...fine, number: "F-2", staticId: "999" }, context);
    const wanted = { characterName: "x", reason: "ст. 2", termText: "10 лет", forumLink: "https://forum.example/1", issuedByDiscordId: ADMIN };
    await createWanted({ ...wanted, number: "W-1", staticId: "222" }, context);
    await createWanted({ ...wanted, number: "W-2", staticId: "999" }, context);
    await createIcBlacklistEntry(
      { staticId: "222", fullName: "Second Mine", reason: "нарушение", forumLink: "https://forum.example/2", createdByDiscordId: ADMIN },
      context,
    );
    await prisma.registration.createMany({
      data: [
        { kind: RegistrationKind.UNIFORM, staticId: "111", applicantDiscordId: ME, payload: { description: "форма" } },
        { kind: RegistrationKind.UNIFORM, staticId: "999", applicantDiscordId: OTHER, payload: { description: "чужая" } },
      ],
    });

    const profile = await getPlayerProfile(ME);
    expect(profile.characters.map((c) => c.staticId)).toEqual(["111", "222"]);
    expect(profile.characters[0]?.activeToken?.number).toBe(current.number);
    expect(profile.characters[0]?.tokens.map((t) => t.number)).toEqual([current.number, first.number]);
    expect(profile.characters[0]?.blacklist).toBeNull();
    expect(profile.characters[1]?.activeToken).toBeNull();
    expect(profile.characters[1]?.blacklist?.number).toBe("BL-001");
    expect(profile.fines.map((f) => f.number)).toEqual(["F-1"]);
    expect(profile.wanted.map((w) => w.number)).toEqual(["W-1"]);
    expect(profile.registrations.map((r) => r.staticId)).toEqual(["111"]);
  });
});
