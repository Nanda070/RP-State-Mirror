import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import {
  BOT_SERVICE,
  getPresence,
  recordHeartbeat,
  recordPresenceChanges,
  replacePresenceSnapshot,
  setSetting,
  toPresenceStatus,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage9-presence.test" } as const;

describe("«в сети»", () => {
  it("keeps status changes and the last time a person was seen online", async () => {
    const t1 = new Date("2026-10-05T10:00:00Z");
    const t2 = new Date("2026-10-05T11:00:00Z");
    await recordPresenceChanges(new Map([["1", "online"], ["2", "offline"]]), t1);
    let rows = await prisma.userPresence.findMany({ orderBy: { discordId: "asc" } });
    expect(rows.map((row) => [row.discordId, row.status, row.lastOnlineAt?.toISOString() ?? null])).toEqual([
      ["1", "online", t1.toISOString()],
      ["2", "offline", null],
    ]);

    // The same status again changes nothing; going offline marks the moment.
    await recordPresenceChanges(new Map([["1", "online"]]), t2);
    expect((await prisma.userPresence.findUnique({ where: { discordId: "1" } }))?.lastOnlineAt).toEqual(t1);
    await recordPresenceChanges(new Map([["1", "offline"]]), t2);
    expect(await prisma.userPresence.findUnique({ where: { discordId: "1" } })).toMatchObject({
      status: "offline",
      lastOnlineAt: t2,
    });

    // A snapshot after a reconnect: whoever is not listed is offline now.
    await recordPresenceChanges(new Map([["3", "dnd"], ["4", "idle"]]), t1);
    await replacePresenceSnapshot(new Map([["4", "online"]]), t2);
    rows = await prisma.userPresence.findMany({ orderBy: { discordId: "asc" } });
    expect(rows.map((row) => [row.discordId, row.status])).toEqual([
      ["1", "offline"],
      ["2", "offline"],
      ["3", "offline"],
      ["4", "online"],
    ]);
    expect(toPresenceStatus("invisible")).toBe("offline");
  });

  it("shows a status only when the feature is on and the bot is connected with the intent", async () => {
    await recordPresenceChanges(new Map([["10", "idle"]]));
    expect(await getPresence("10")).toBeNull();

    await setSetting("presence.enabled", true, context);
    expect(await getPresence("10")).toBeNull();
    await recordHeartbeat(BOT_SERVICE, { presence: false });
    expect(await getPresence("10")).toBeNull();

    await recordHeartbeat(BOT_SERVICE, { presence: true });
    expect(await getPresence("10")).toMatchObject({ status: "idle" });
    expect(await getPresence("11")).toEqual({ status: "offline", lastOnlineAt: null });
    // A silent bot: the status cannot be trusted any more.
    expect(await getPresence("10", Date.now() + 10 * 60_000)).toBeNull();
  });
});
