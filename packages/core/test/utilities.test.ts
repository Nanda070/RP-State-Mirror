import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecordStatus, RoleMappingKind } from "@mirror/db";
import { findFactionOverlaps, listInviteGuilds, setSetting } from "@mirror/core";
import { AuditActorType } from "@mirror/db";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ctx = { actorType: AuditActorType.SYSTEM, source: "utilities.test" } as const;

describe("findFactionOverlaps", () => {
  it("returns users present in two faction guilds with mapped roles", async () => {
    const g1 = await prisma.guild.create({ data: { discordId: "111", name: "LSPD Guild" } });
    const g2 = await prisma.guild.create({ data: { discordId: "222", name: "FIB Guild" } });
    const lspd = await prisma.faction.create({ data: { code: "LSPD", name: "LSPD", guildId: g1.id } });
    const fib = await prisma.faction.create({ data: { code: "FIB", name: "FIB", guildId: g2.id } });
    await prisma.roleMapping.createMany({
      data: [
        {
          guildId: g1.id,
          roleDiscordId: "r-lspd",
          kind: RoleMappingKind.FACTION_MEMBER,
          value: "member",
          factionId: lspd.id,
        },
        {
          guildId: g2.id,
          roleDiscordId: "r-fib",
          kind: RoleMappingKind.FACTION_MEMBER,
          value: "member",
          factionId: fib.id,
        },
      ],
    });
    await prisma.guildMember.createMany({
      data: [
        {
          guildId: g1.id,
          userDiscordId: "u1",
          username: "dual",
          roleIds: ["r-lspd"],
          isPresent: true,
        },
        {
          guildId: g2.id,
          userDiscordId: "u1",
          username: "dual",
          roleIds: ["r-fib"],
          isPresent: true,
        },
        {
          guildId: g1.id,
          userDiscordId: "u2",
          username: "single",
          roleIds: ["r-lspd"],
          isPresent: true,
        },
      ],
    });

    const overlaps = await findFactionOverlaps();
    expect(overlaps).toEqual([
      { discordUserId: "u1", username: "dual", factions: ["FIB", "LSPD"] },
    ]);
  });
});

describe("listInviteGuilds", () => {
  it("uses configured guild ids when set", async () => {
    await prisma.guild.create({ data: { discordId: "100000000000000001", name: "Main", status: RecordStatus.ACTIVE } });
    await prisma.guild.create({ data: { discordId: "100000000000000002", name: "Other", status: RecordStatus.ACTIVE } });
    await setSetting("invites.guildIds", ["100000000000000002"], ctx);
    expect(await listInviteGuilds()).toEqual([
      { discordId: "100000000000000002", name: "Other", label: "Other" },
    ]);
  });
});
