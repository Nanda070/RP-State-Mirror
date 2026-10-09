import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import { claimNextJob, createLogger, enqueueJob, setSetting } from "@mirror/core";
import { DbEvents, type ChangeTopic } from "../src/db-events.js";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "db-events.test" } as const;

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("database changes heard live", () => {
  let events: DbEvents;
  let heard: ChangeTopic[];

  beforeEach(async () => {
    heard = [];
    events = new DbEvents(process.env.DATABASE_URL!, createLogger("test", "silent"));
    for (const topic of ["jobs", "settings", "reference", "bans"] as const) events.on(topic, () => heard.push(topic));
    const connected = new Promise<void>((resolve) => events.onConnection((up) => up && resolve()));
    events.start();
    await connected;
    // A fresh connection reports every topic once (changes missed while nobody listened).
    expect([...heard].sort()).toEqual(["bans", "jobs", "reference", "settings"]);
    heard = [];
  });
  afterEach(() => events.stop());

  async function waitFor(topic: ChangeTopic) {
    const deadline = Date.now() + 3_000;
    while (!heard.includes(topic)) {
      if (Date.now() > deadline) throw new Error(`no «${topic}» notification`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("hears a new job on commit, not a job being taken", async () => {
    await enqueueJob({ type: "test.job", payload: {} });
    await waitFor("jobs");
    heard = [];
    expect(await claimNextJob("test-worker")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heard).not.toContain("jobs");
  });

  it("hears settings, reference data and bans", async () => {
    await setSetting("documents.ttlHours", 48, context);
    await waitFor("settings");
    await prisma.faction.create({ data: { code: "TST", name: "Test" } });
    await waitFor("reference");
    await prisma.techBan.create({ data: { kind: "DISCORD", value: "940000000000000001", reason: "test", createdByDiscordId: "940000000000000002" } });
    await waitFor("bans");
  });

  it("says when it is connected and stops cleanly", async () => {
    expect(events.connected).toBe(true);
    await events.stop();
    expect(events.connected).toBe(false);
  });
});
