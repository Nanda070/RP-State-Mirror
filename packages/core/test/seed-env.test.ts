import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FACTIONS,
  EnvError,
  SETTING_KEYS,
  baseEnvSchema,
  botEnvSchema,
  dashboardEnvSchema,
  parseEnv,
  seedFoundation,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const SUPER_ADMIN = "1219803151180370021";

describe("seedFoundation", () => {
  it("creates factions including WN, default settings and the super admin", async () => {
    const result = await seedFoundation({ superAdminUserIds: [SUPER_ADMIN] });

    expect(result).toEqual({
      factionsCreated: DEFAULT_FACTIONS.length,
      settingsCreated: SETTING_KEYS.length,
      usersCreated: 1,
    });
    const codes = (await prisma.faction.findMany({ orderBy: { sortOrder: "asc" } })).map((f) => f.code);
    expect(codes).toEqual(["GOV", "FIB", "LSPD", "LSSD", "SASPA", "ARMY", "EMS", "WN"]);
    expect(await prisma.user.findUnique({ where: { discordId: SUPER_ADMIN } })).not.toBeNull();
    expect(await prisma.auditLog.count()).toBe(DEFAULT_FACTIONS.length + SETTING_KEYS.length + 1);
  });

  it("is idempotent and keeps values edited later", async () => {
    await seedFoundation({ superAdminUserIds: [SUPER_ADMIN] });
    await prisma.faction.update({ where: { code: "WN" }, data: { name: "Edited" } });

    const second = await seedFoundation({ superAdminUserIds: [SUPER_ADMIN] });

    expect(second).toEqual({ factionsCreated: 0, settingsCreated: 0, usersCreated: 0 });
    expect((await prisma.faction.findUniqueOrThrow({ where: { code: "WN" } })).name).toBe("Edited");
  });
});

describe("parseEnv", () => {
  const valid = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

  it("parses the super admin list and applies defaults", () => {
    const env = parseEnv(baseEnvSchema, { ...valid, SUPER_ADMIN_USER_IDS: ` ${SUPER_ADMIN}, ${SUPER_ADMIN} ,` });
    expect(env.SUPER_ADMIN_USER_IDS).toEqual([SUPER_ADMIN]);
    expect(env.APP_ENV).toBe("development");
  });

  it("rejects malformed Discord IDs", () => {
    expect(() => parseEnv(baseEnvSchema, { ...valid, SUPER_ADMIN_USER_IDS: "123" })).toThrow(EnvError);
  });

  it("requires the bot token for the bot", () => {
    expect(() => parseEnv(botEnvSchema, { ...valid, DISCORD_BOT_TOKEN: "" })).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("requires a database URL", () => {
    expect(() => parseEnv(baseEnvSchema, {})).toThrow(/DATABASE_URL/);
  });

  it("requires dashboard OAuth secrets and Auth.js callback URL", () => {
    const env = parseEnv(dashboardEnvSchema, {
      ...valid,
      DISCORD_CLIENT_ID: SUPER_ADMIN,
      DISCORD_CLIENT_SECRET: "secret",
      SESSION_SECRET: "0123456789abcdef",
      OAUTH_REDIRECT_URL: "http://localhost:3000/api/auth/callback/discord",
    });
    expect(env.DISCORD_CLIENT_ID).toBe(SUPER_ADMIN);
    expect(() =>
      parseEnv(dashboardEnvSchema, {
        ...valid,
        DISCORD_CLIENT_ID: SUPER_ADMIN,
        DISCORD_CLIENT_SECRET: "secret",
        SESSION_SECRET: "0123456789abcdef",
        OAUTH_REDIRECT_URL: "http://localhost:8080/",
      }),
    ).toThrow(/OAUTH_REDIRECT_URL/);
  });
});
