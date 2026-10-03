import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, Prisma } from "@mirror/db";
import {
  SettingValidationError,
  auditedMutation,
  getSetting,
  setMainAndIncidentGuilds,
  setSetting,
  toJsonValue,
  type AuditContext,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ctx: AuditContext = { actorType: AuditActorType.SYSTEM, source: "test" };

describe("auditedMutation", () => {
  it("persists the change and its audit record together", async () => {
    const user = await auditedMutation(ctx, "user.created", "user", async (tx) => {
      const created = await tx.user.create({ data: { discordId: "100000000000000001" } });
      return { entityId: created.id, after: { discordId: created.discordId }, result: created };
    });

    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "user.created", entityId: user.id, source: "test" });
  });

  it("rolls back both when the mutation fails", async () => {
    await expect(
      auditedMutation(ctx, "user.created", "user", async (tx) => {
        await tx.user.create({ data: { discordId: "100000000000000002" } });
        throw new Error("fail after write");
      }),
    ).rejects.toThrow("fail after write");

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("rejects an invalid audit context before touching the database", async () => {
    await expect(
      auditedMutation({ actorType: AuditActorType.SYSTEM, source: "" }, "x", "y", async () => ({
        entityId: "1",
        result: null,
      })),
    ).rejects.toThrow();
  });
});

describe("settings", () => {
  it("returns the default when nothing is stored", async () => {
    expect(await getSetting("documents.ttlHours")).toBe(72);
    expect(await getSetting("core.mainGuildId")).toBeNull();
  });

  it("stores the value and audits before/after", async () => {
    await setSetting("registrations.ttlDays", 45, ctx);
    expect(await getSetting("registrations.ttlDays")).toBe(45);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: "registrations.ttlDays" } });
    expect(audit.action).toBe("setting.updated");
    expect(audit.before).toBe(31);
    expect(audit.after).toBe(45);
  });

  it("stores null values", async () => {
    await setSetting("core.mainGuildId", "100000000000000010", ctx);
    await setSetting("core.mainGuildId", null, ctx);
    expect(await getSetting("core.mainGuildId")).toBeNull();
  });

  it("rejects invalid values without writing anything", async () => {
    await expect(setSetting("core.mainGuildId", "not-a-snowflake", ctx)).rejects.toBeInstanceOf(
      SettingValidationError,
    );
    expect(await prisma.systemSetting.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("refuses to use the same guild as main and incident server", async () => {
    await setSetting("core.mainGuildId", "100000000000000010", ctx);
    await expect(setSetting("core.incidentGuildId", "100000000000000010", ctx)).rejects.toBeInstanceOf(
      SettingValidationError,
    );
    expect(await getSetting("core.incidentGuildId")).toBeNull();
  });

  it("sets main and incident guilds atomically and rejects equal ids before write", async () => {
    await expect(
      setMainAndIncidentGuilds("100000000000000010", "100000000000000010", ctx),
    ).rejects.toBeInstanceOf(SettingValidationError);
    expect(await prisma.systemSetting.count()).toBe(0);

    const result = await setMainAndIncidentGuilds("100000000000000010", "100000000000000011", ctx);
    expect(result).toEqual({
      mainGuildId: "100000000000000010",
      incidentGuildId: "100000000000000011",
    });
    expect(await getSetting("core.mainGuildId")).toBe("100000000000000010");
    expect(await getSetting("core.incidentGuildId")).toBe("100000000000000011");
    expect(await prisma.auditLog.count({ where: { action: "setting.updated" } })).toBe(2);
  });

  it("round-trips null, boolean, and array JSON settings without collapsing null to {}", async () => {
    expect(toJsonValue(null)).toBe(Prisma.JsonNull);
    expect(toJsonValue(Prisma.JsonNull)).toBe(Prisma.JsonNull);
    expect(toJsonValue(undefined)).toBe(Prisma.JsonNull);

    await setSetting("cp.logChannelId", null, ctx);
    await setSetting("cp.syncEnabled", false, ctx);
    await setSetting("cp.excludedRoleIds", ["100000000000000020"], ctx);

    expect(await getSetting("cp.logChannelId")).toBeNull();
    expect(await getSetting("cp.syncEnabled")).toBe(false);
    expect(await getSetting("cp.excludedRoleIds")).toEqual(["100000000000000020"]);

    const logRow = await prisma.systemSetting.findUniqueOrThrow({ where: { key: "cp.logChannelId" } });
    expect(logRow.value).toBeNull();
  });

  it("coerces and heals JsonNull stringify artifacts stored as {}", async () => {
    await prisma.systemSetting.create({
      data: { key: "cp.logChannelId", value: {} },
    });

    expect(await getSetting("cp.logChannelId")).toBeNull();

    const healed = await prisma.systemSetting.findUniqueOrThrow({ where: { key: "cp.logChannelId" } });
    expect(healed.value).toBeNull();
  });
});
