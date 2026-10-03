import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus, RegistrationKind } from "@mirror/db";
import {
  LegalError,
  PrivacyError,
  anonymizeUser,
  createFine,
  createRegistration,
  createUserSession,
  currentLegalVersion,
  getPublishedLegal,
  getSetting,
  hasLegalConsent,
  listLegalVersions,
  publishLegalDocument,
  reconcileGuildMembers,
  recordLegalConsent,
  setSetting,
  unpublishLegalDocument,
  upsertGuild,
  writeAuditEvent,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage7.legal.test" } as const;
const ADMIN = "890000000000000001";
const PLAYER = "890000000000000002";
const GUILD = "890000000000000100";
const TEXT = "# Условия\n\nТекст условий использования сервиса, достаточно длинный для публикации.";

describe("legal texts", () => {
  it("publishes editions, keeps history and returns to the built-in text", async () => {
    expect(await getPublishedLegal("terms")).toBeNull();
    await expect(publishLegalDocument({ kind: "terms", body: "коротко", createdByDiscordId: ADMIN }, context)).rejects.toThrow(
      "слишком короткий",
    );

    const first = await publishLegalDocument({ kind: "terms", body: TEXT, createdByDiscordId: ADMIN }, context);
    expect(first.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(publishLegalDocument({ kind: "terms", body: TEXT, createdByDiscordId: ADMIN }, context)).rejects.toBeInstanceOf(
      LegalError,
    );

    // A second edition on the same day gets its own version and replaces the first.
    const second = await publishLegalDocument({ kind: "terms", body: `${TEXT}\n\nДополнение.`, createdByDiscordId: ADMIN }, context);
    expect(second.version).toBe(`${first.version}.2`);
    expect((await getPublishedLegal("terms"))?.id).toBe(second.id);
    expect((await listLegalVersions("terms")).map((row) => row.status)).toEqual([RecordStatus.ACTIVE, RecordStatus.ARCHIVED]);
    // Other pages are untouched.
    expect(await getPublishedLegal("privacy")).toBeNull();

    await unpublishLegalDocument("terms", context);
    expect(await getPublishedLegal("terms")).toBeNull();
    expect(await listLegalVersions("terms")).toHaveLength(2);
    await expect(unpublishLegalDocument("terms", context)).rejects.toBeInstanceOf(LegalError);
  });

  it("derives the current version and remembers who accepted it", async () => {
    expect(await currentLegalVersion("2026-10-03")).toBe("2026-10-03");
    const published = await publishLegalDocument({ kind: "privacy", body: TEXT, createdByDiscordId: ADMIN }, context);
    // The newest date wins, whether it is the built-in edition or a published one.
    expect(await currentLegalVersion("2000-01-01")).toBe(published.version);
    expect(await currentLegalVersion("2999-01-01")).toBe("2999-01-01");

    expect(await hasLegalConsent(PLAYER, published.version)).toBe(false);
    await recordLegalConsent(PLAYER, published.version);
    await recordLegalConsent(PLAYER, published.version);
    expect(await hasLegalConsent(PLAYER, published.version)).toBe(true);
    expect(await prisma.legalConsent.count()).toBe(1);
    expect(await hasLegalConsent(PLAYER, "2999-01-01")).toBe(false);
  });
});

describe("admin positions", () => {
  it("are a validated list of titles by Discord id", async () => {
    expect(await getSetting("admins.positions")).toEqual([]);
    await setSetting("admins.positions", [{ discordId: ADMIN, title: "Куратор фракций" }], context);
    expect(await getSetting("admins.positions")).toEqual([{ discordId: ADMIN, title: "Куратор фракций" }]);
    await expect(setSetting("admins.positions", [{ discordId: "abc", title: "x" }], context)).rejects.toThrow();
  });
});

describe("data erasure", () => {
  async function seedPlayer(present: boolean) {
    await upsertGuild({ discordId: GUILD, name: "Main", iconUrl: null });
    await reconcileGuildMembers(GUILD, [
      {
        userDiscordId: PLAYER,
        username: "player",
        globalName: "Игрок",
        nickname: "Ivan Petrov",
        avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
        guildAvatarUrl: null,
        roleIds: ["890000000000000200"],
        joinedAt: new Date(),
        publicFlags: 64,
        avatarDecorationUrl: "https://cdn.discordapp.com/avatar-decoration-presets/x.png",
      },
    ]);
    if (!present) await reconcileGuildMembers(GUILD, []);
    const user = await prisma.user.create({ data: { discordId: PLAYER } });
    await createUserSession({ userId: user.id, discordId: PLAYER, ipAddress: "203.0.113.9", userAgent: "Chrome" });
    await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "777", applicantDiscordId: PLAYER, payload: { description: "форма" } },
      context,
    );
    await createFine(
      { number: "F-1", characterName: "Ivan Petrov", staticId: "777", amount: 100, reason: "ст. 1", factionCode: "LSPD", paymentDeadlineText: "1d", issuedByDiscordId: PLAYER },
      { actorType: AuditActorType.USER, source: "bot.slash", actorUserId: user.id, ipAddress: "203.0.113.9", metadata: { discordUserId: PLAYER } },
    );
    await writeAuditEvent({ ...context, action: "member.joined", entityType: "discord_guild_member", entityId: `${GUILD}:${PLAYER}` });
    await recordLegalConsent(PLAYER, "2026-10-03");
    return user;
  }

  it("is refused while the person is on a project server, for a super admin and for oneself", async () => {
    await seedPlayer(true);
    const request = { discordId: PLAYER, requestedByDiscordId: ADMIN };
    await expect(anonymizeUser(request, context)).rejects.toThrow("состоит на серверах");
    await expect(anonymizeUser({ discordId: ADMIN, requestedByDiscordId: ADMIN }, context)).rejects.toBeInstanceOf(PrivacyError);
    await expect(anonymizeUser(request, context, { superAdminUserIds: [PLAYER] })).rejects.toThrow("Главного администратора");
    await expect(anonymizeUser({ discordId: "abc", requestedByDiscordId: ADMIN }, context)).rejects.toThrow();
  });

  it("cuts every link between the records and the person, and keeps the records", async () => {
    const user = await seedPlayer(false);
    const result = await anonymizeUser({ discordId: PLAYER, requestedByDiscordId: ADMIN }, context);
    expect(result.pseudonym).toMatch(/^deleted-[0-9a-f]{12}$/);

    // Nothing in the database mentions the id any more.
    const leftovers = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    for (const { table_name: table } of leftovers) {
      const [row] = await prisma.$queryRawUnsafe<{ hits: bigint }[]>(
        `SELECT count(*) AS hits FROM "${table}" t WHERE t::text LIKE '%${PLAYER}%'`,
      );
      expect(`${table}:${row?.hits}`).toBe(`${table}:0`);
    }

    // The records themselves are still there, attributed to the pseudonym.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ discordId: result.pseudonym });
    expect(await prisma.fine.findFirstOrThrow()).toMatchObject({ number: "F-1", issuedByDiscordId: result.pseudonym });
    expect(await prisma.registration.findFirstOrThrow()).toMatchObject({ staticId: "777", applicantDiscordId: result.pseudonym });
    expect(await prisma.guildMember.findFirstOrThrow()).toMatchObject({
      username: "удалён",
      nickname: null,
      avatarUrl: null,
      publicFlags: null,
      avatarDecorationUrl: null,
      roleIds: [],
    });
    const session = await prisma.userSession.findFirstOrThrow();
    expect(session).toMatchObject({ ipAddress: null, userAgent: null });
    expect(session.revokedAt).not.toBeNull();
    // The person's own audit events lose the IP; the log still says what happened.
    const own = await prisma.auditLog.findFirstOrThrow({ where: { action: "fine.created" } });
    expect(own.ipAddress).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "user.anonymized", entityId: result.pseudonym } })).toBe(1);

    // A second request has nothing left to do but does not fail.
    const again = await anonymizeUser({ discordId: PLAYER, requestedByDiscordId: ADMIN }, context);
    expect(Object.values(again.tables).reduce((sum, value) => sum + value, 0)).toBe(0);
  });
});
