import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import {
  SettingValidationError,
  auditedMutation,
  getSetting,
  setSetting,
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
});
