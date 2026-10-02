import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, RoleMappingKind } from "@mirror/db";
import {
  markMemberLeft,
  reconcileGuildMembers,
  resolveIdentity,
  seedFoundation,
  setSetting,
  syncGuildRoles,
  upsertGuild,
  upsertMember,
  type MemberSnapshot,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const MAIN = "200000000000000001";
const LSPD_GUILD = "200000000000000002";
const USER = "300000000000000001";
const OTHER = "300000000000000002";

function member(userDiscordId: string, roleIds: string[]): MemberSnapshot {
  return {
    userDiscordId,
    username: `user-${userDiscordId.slice(-2)}`,
    globalName: null,
    nickname: null,
    avatarUrl: null,
    guildAvatarUrl: null,
    roleIds,
    joinedAt: null,
  };
}

async function guild(discordId: string) {
  return upsertGuild({ discordId, name: `guild-${discordId.slice(-2)}`, iconUrl: null });
}

describe("member snapshot", () => {
  it("does not audit the first snapshot but audits later diffs", async () => {
    await guild(LSPD_GUILD);
    const first = await reconcileGuildMembers(LSPD_GUILD, [member(USER, ["r1"]), member(OTHER, [])]);
    expect(first).toMatchObject({ created: 2, initial: true });
    expect(await prisma.auditLog.count({ where: { entityType: "discord_guild_member" } })).toBe(0);

    const second = await reconcileGuildMembers(LSPD_GUILD, [member(USER, ["r1", "r2"])]);
    expect(second).toMatchObject({ updated: 1, left: 1, initial: false });

    const actions = (await prisma.auditLog.findMany({ where: { entityType: "discord_guild_member" } }))
      .map((a) => a.action)
      .sort();
    expect(actions).toEqual(["member.left", "member.roles_changed"]);
    const gone = await prisma.guildMember.findFirstOrThrow({ where: { userDiscordId: OTHER } });
    expect(gone.isPresent).toBe(false);
  });

  it("audits real-time joins, role changes and leaves, ignoring no-op updates", async () => {
    await guild(LSPD_GUILD);
    await upsertMember(LSPD_GUILD, member(USER, ["r1"]));
    await upsertMember(LSPD_GUILD, member(USER, ["r1"]));
    await upsertMember(LSPD_GUILD, member(USER, ["r2"]));
    await markMemberLeft(LSPD_GUILD, USER);
    await markMemberLeft(LSPD_GUILD, USER);

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } }))
      .filter((a) => a.entityType === "discord_guild_member")
      .map((a) => a.action);
    expect(actions).toEqual(["member.joined", "member.roles_changed", "member.left"]);
  });

  it("archives deleted roles", async () => {
    await guild(LSPD_GUILD);
    await syncGuildRoles(LSPD_GUILD, [
      { discordId: "400000000000000001", name: "A", color: 0, position: 1, managed: false },
      { discordId: "400000000000000002", name: "B", color: 0, position: 2, managed: false },
    ]);
    await syncGuildRoles(LSPD_GUILD, [
      { discordId: "400000000000000001", name: "A", color: 0, position: 1, managed: false },
    ]);
    const archived = await prisma.discordRole.findUniqueOrThrow({ where: { discordId: "400000000000000002" } });
    expect(archived.status).toBe("ARCHIVED");
  });
});

describe("resolveIdentity", () => {
  const ctx = { actorType: AuditActorType.SYSTEM, source: "test" } as const;

  async function setup() {
    await seedFoundation({ superAdminUserIds: [] });
    const main = await guild(MAIN);
    const lspd = await guild(LSPD_GUILD);
    await setSetting("core.mainGuildId", MAIN, ctx);
    await prisma.faction.update({ where: { code: "LSPD" }, data: { guildId: lspd.id } });

    await prisma.roleMapping.createMany({
      data: [
        { guildId: main.id, roleDiscordId: "500000000000000001", kind: RoleMappingKind.ADMIN_LEVEL, value: "HELPER" },
        { guildId: main.id, roleDiscordId: "500000000000000002", kind: RoleMappingKind.ADMIN_LEVEL, value: "SENIOR_ADMIN" },
        { guildId: lspd.id, roleDiscordId: "600000000000000001", kind: RoleMappingKind.FACTION_MEMBER },
        { guildId: lspd.id, roleDiscordId: "600000000000000002", kind: RoleMappingKind.FACTION_LEADER },
        { guildId: lspd.id, roleDiscordId: "600000000000000003", kind: RoleMappingKind.RANK, value: "5" },
        { guildId: lspd.id, roleDiscordId: "600000000000000004", kind: RoleMappingKind.RANK, value: "7" },
        { guildId: lspd.id, roleDiscordId: "600000000000000005", kind: RoleMappingKind.DEPARTMENT, value: "SWAT" },
        { guildId: lspd.id, roleDiscordId: "600000000000000006", kind: RoleMappingKind.PERMISSION, value: "token.find" },
      ],
    });
  }

  it("derives admin level from the main guild and faction data from the faction guild", async () => {
    await setup();
    await upsertMember(MAIN, member(USER, ["500000000000000001", "500000000000000002"]));
    await upsertMember(
      LSPD_GUILD,
      member(USER, [
        "600000000000000001",
        "600000000000000002",
        "600000000000000003",
        "600000000000000004",
        "600000000000000005",
        "600000000000000006",
      ]),
    );

    const identity = await resolveIdentity(USER, { superAdminUserIds: [] });

    expect(identity.adminLevel).toBe(AdminLevel.SENIOR_ADMIN);
    expect(identity.isSuperAdmin).toBe(false);
    expect(identity.factions).toEqual([
      expect.objectContaining({ code: "LSPD", isLeader: true, isDeputy: false, rank: 7, departments: ["SWAT"] }),
    ]);
    expect(identity.permissions).toEqual(["token.find"]);
  });

  it("ignores admin roles held on a guild other than the main guild", async () => {
    await setup();
    await upsertMember(LSPD_GUILD, member(USER, ["500000000000000002"]));
    expect((await resolveIdentity(USER, { superAdminUserIds: [] })).adminLevel).toBeNull();
  });

  it("drops faction membership when the member leaves the faction guild", async () => {
    await setup();
    await upsertMember(LSPD_GUILD, member(USER, ["600000000000000001"]));
    expect((await resolveIdentity(USER, { superAdminUserIds: [] })).factions).toHaveLength(1);

    await markMemberLeft(LSPD_GUILD, USER);
    expect((await resolveIdentity(USER, { superAdminUserIds: [] })).factions).toHaveLength(0);
  });

  it("treats bootstrap super admins as SUPER_ADMIN without any roles", async () => {
    const identity = await resolveIdentity(USER, { superAdminUserIds: [USER] });
    expect(identity).toMatchObject({ isSuperAdmin: true, adminLevel: AdminLevel.SUPER_ADMIN, factions: [] });
  });
});
