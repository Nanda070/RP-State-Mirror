import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RoleMappingKind } from "@mirror/db";
import {
  archiveRoleMapping,
  listActiveRoleMappings,
  resolveIdentity,
  upsertGuild,
  upsertRoleMapping,
  syncGuildRoles,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const GUILD = "200000000000000010";
const ROLE = "400000000000000010";
const CTX = { actorType: AuditActorType.SYSTEM, source: "test" };

describe("role mapping soft-delete", () => {
  it("upserts, lists active rows, archives without physical delete", async () => {
    await upsertGuild({ discordId: GUILD, name: "Main", iconUrl: null });
    await syncGuildRoles(GUILD, [{ discordId: ROLE, name: "Admin", color: 0, position: 1, managed: false }]);

    const created = await upsertRoleMapping(
      {
        guildDiscordId: GUILD,
        roleDiscordId: ROLE,
        kind: RoleMappingKind.ADMIN_LEVEL,
        value: "ADMIN",
      },
      CTX,
    );
    expect((await listActiveRoleMappings(GUILD)).map((m) => m.id)).toEqual([created.id]);

    await archiveRoleMapping(created.id, CTX);
    expect(await listActiveRoleMappings(GUILD)).toEqual([]);
    expect(await prisma.roleMapping.count()).toBe(1);
    expect((await prisma.roleMapping.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("ARCHIVED");

    const restored = await upsertRoleMapping(
      {
        guildDiscordId: GUILD,
        roleDiscordId: ROLE,
        kind: RoleMappingKind.ADMIN_LEVEL,
        value: "ADMIN",
      },
      CTX,
    );
    expect(restored.id).toBe(created.id);
    expect(restored.status).toBe("ACTIVE");
  });

  it("archived mappings stop affecting identity", async () => {
    const USER = "300000000000000010";
    await upsertGuild({ discordId: GUILD, name: "Main", iconUrl: null });
    await syncGuildRoles(GUILD, [{ discordId: ROLE, name: "Admin", color: 0, position: 1, managed: false }]);
    await prisma.guildMember.create({
      data: {
        guildId: (await prisma.guild.findUniqueOrThrow({ where: { discordId: GUILD } })).id,
        userDiscordId: USER,
        username: "tester",
        roleIds: [ROLE],
        isPresent: true,
      },
    });
    await prisma.systemSetting.create({
      data: { key: "core.mainGuildId", value: GUILD },
    });

    const mapping = await upsertRoleMapping(
      {
        guildDiscordId: GUILD,
        roleDiscordId: ROLE,
        kind: RoleMappingKind.ADMIN_LEVEL,
        value: "HELPER",
      },
      CTX,
    );
    expect((await resolveIdentity(USER, { superAdminUserIds: [] })).adminLevel).toBe("HELPER");

    await archiveRoleMapping(mapping.id, CTX);
    expect((await resolveIdentity(USER, { superAdminUserIds: [] })).adminLevel).toBeNull();
  });
});
