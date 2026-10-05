import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, DecisionStatus, RegistrationKind, RoleMappingKind } from "@mirror/db";
import {
  buildPlayerCard,
  createCharacter,
  createFine,
  createIcBlacklistEntry,
  createRegistration,
  createWanted,
  decideRegistration,
  getDossierAccess,
  issueToken,
  resolveIdentity,
  seedFoundation,
  setSetting,
  upsertGuild,
  upsertMember,
  type Identity,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "improve.test" } as const;
const PLAYER = "300000000000000001";
const LSPD_GUILD = "200000000000000002";
const FINDER_ROLE = "700000000000000001";
const SEARCH_ROLE = "700000000000000002";

beforeEach(async () => {
  await resetDatabase();
  await seedFoundation({ superAdminUserIds: [] });
});
afterAll(() => prisma.$disconnect());

const fieldOf = (card: Awaited<ReturnType<typeof buildPlayerCard>>, name: string) =>
  card.fields.find((field) => field.name === name)?.value ?? null;

async function identityOf(discordId: string) {
  return resolveIdentity(discordId, { superAdminUserIds: [] });
}

describe("player card", () => {
  it("says so plainly when the project knows nothing about the person", async () => {
    const card = await buildPlayerCard(await identityOf(PLAYER), { showBlacklist: true });
    expect(card.faction).toBe("Во фракциях не состоит");
    expect(fieldOf(card, "Персонажи")).toBe("Персонажей нет.");
    expect(fieldOf(card, "Неоплаченные штрафы")).toBe("Нет.");
    expect(fieldOf(card, "Розыск")).toBe("Не в розыске.");
    expect(fieldOf(card, "Регистрации")).toBe("Нет.");
    expect(fieldOf(card, "IC чёрный список")).toBeNull();
    expect(card.unpaidFines).toEqual([]);
  });

  it("shows the faction, characters, unpaid fines, wanted orders and registrations", async () => {
    const guild = await upsertGuild({ discordId: LSPD_GUILD, name: "LSPD", iconUrl: null });
    await prisma.faction.update({ where: { code: "LSPD" }, data: { guildId: guild.id } });
    await prisma.roleMapping.createMany({
      data: [
        { guildId: guild.id, roleDiscordId: "600000000000000001", kind: RoleMappingKind.FACTION_MEMBER },
        { guildId: guild.id, roleDiscordId: "600000000000000002", kind: RoleMappingKind.RANK, value: "5" },
      ],
    });
    await upsertMember(LSPD_GUILD, {
      userDiscordId: PLAYER,
      username: "player",
      globalName: null,
      nickname: null,
      avatarUrl: null,
      guildAvatarUrl: null,
      roleIds: ["600000000000000001", "600000000000000002"],
      joinedAt: null,
    });

    const user = await prisma.user.create({ data: { discordId: PLAYER } });
    const character = await createCharacter({ userId: user.id, slot: 1, staticId: "391200", name: "John Doe" }, context);
    const token = await issueToken(character.id, context);
    const fine = await createFine(
      {
        number: "F-042",
        staticId: "391200",
        characterName: "John Doe",
        amount: 5000,
        reason: "ст. 12",
        issuedByDiscordId: "900",
        factionCode: "LSPD",
        paymentDeadlineText: "24h",
      },
      context,
    );
    await createFine(
      {
        number: "F-043",
        staticId: "391200",
        characterName: "John Doe",
        amount: 700,
        reason: "ст. 3",
        issuedByDiscordId: "900",
        factionCode: "LSPD",
        paymentDeadlineText: "14d",
      },
      context,
    );
    await createWanted(
      {
        number: "W-007",
        staticId: "391200",
        characterName: "John Doe",
        reason: "ст. 6.1",
        termText: "5 лет",
        forumLink: "https://forum.example/1",
        issuedByDiscordId: "900",
      },
      context,
    );
    const vehicle = await createRegistration(
      { kind: RegistrationKind.VEHICLE, staticId: "391200", applicantDiscordId: PLAYER, payload: { model: "Sultan", plate: "A123AA" } },
      context,
    );
    await decideRegistration(vehicle.id, DecisionStatus.APPROVED, "900", null, context);
    await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "391200", applicantDiscordId: PLAYER, payload: { description: "Форма" } },
      context,
    );

    const card = await buildPlayerCard(await identityOf(PLAYER), { showBlacklist: true });
    expect(card.faction).toBe("LSPD · ранг 5");
    expect(fieldOf(card, "Персонажи")).toBe(`**John Doe** · статик \`391200\` · нашивка **${token.number}**`);
    expect(fieldOf(card, "Неоплаченные штрафы")).toContain("**F-042** · $5");
    expect(fieldOf(card, "Неоплаченные штрафы")).toContain("**F-043** · $700");
    expect(fieldOf(card, "Неоплаченные штрафы")).toMatch(/Всего: \$5.700$/);
    expect(fieldOf(card, "Розыск")).toBe("**W-007** · ст. 6.1 · срок: 5 лет");
    expect(fieldOf(card, "Регистрации")).toMatch(/^ТС `A123AA` · статик `391200` · до \d{2}\.\d{2}\.\d{4}\nУниформа · статик `391200` · на рассмотрении$/);
    expect(card.unpaidFines.map((row) => row.id)).toContain(fine.id);
  });

  it("shows the IC blacklist only to a viewer who may see it", async () => {
    const user = await prisma.user.create({ data: { discordId: PLAYER } });
    await createCharacter({ userId: user.id, slot: 1, staticId: "391200", name: "John Doe" }, context);
    const entry = await createIcBlacklistEntry(
      { staticId: "391200", fullName: "John Doe", reason: "Нарушение", forumLink: "https://forum.example/2", createdByDiscordId: "900000000000000001" },
      context,
    );

    const identity = await identityOf(PLAYER);
    expect(fieldOf(await buildPlayerCard(identity, { showBlacklist: true }), "IC чёрный список")).toBe(
      `**${entry.number}** · John Doe · Нарушение`,
    );
    expect(fieldOf(await buildPlayerCard(identity, { showBlacklist: false }), "IC чёрный список")).toBeNull();
  });
});

describe("dossier access", () => {
  const viewer = (overrides: Partial<Identity> = {}): Identity => ({
    discordUserId: "400",
    isSuperAdmin: false,
    adminLevel: null,
    factions: [],
    permissions: [],
    heldRoleIds: [],
    ...overrides,
  });

  beforeEach(async () => {
    await setSetting("tokens.finderRoleIds", [FINDER_ROLE], context);
    await setSetting("icBlacklist.searchRoleIds", [SEARCH_ROLE], context);
  });

  it("lets administrators open a dossier with the blacklist", async () => {
    expect(await getDossierAccess(viewer({ adminLevel: AdminLevel.ADMIN }), [])).toEqual({ allowed: true, showBlacklist: true });
  });

  it("lets the token finder roles open it, the blacklist only with a search role", async () => {
    expect(await getDossierAccess(viewer(), [FINDER_ROLE])).toEqual({ allowed: true, showBlacklist: false });
    expect(await getDossierAccess(viewer({ heldRoleIds: [FINDER_ROLE] }), [SEARCH_ROLE])).toEqual({
      allowed: true,
      showBlacklist: true,
    });
  });

  it("refuses everybody else, helpers included", async () => {
    expect(await getDossierAccess(viewer(), ["700000000000000009"])).toEqual({ allowed: false, showBlacklist: false });
    expect(await getDossierAccess(viewer({ adminLevel: AdminLevel.HELPER }), [SEARCH_ROLE])).toEqual({
      allowed: false,
      showBlacklist: false,
    });
  });
});
