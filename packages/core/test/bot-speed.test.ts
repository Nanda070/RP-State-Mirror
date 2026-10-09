import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecordStatus } from "@mirror/db";
import { botSpeedDetail, listActiveDiscordBanIds } from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("bot speed on the status page", () => {
  it("shows the Discord ping and the answer times from the heartbeat", () => {
    expect(botSpeedDetail({ pingMs: 42, ackP50Ms: 180, ackP95Ms: 420 })).toBe(
      " · пинг Discord 42 мс · ответ на нажатие: обычно 180 мс, 95% быстрее 420 мс",
    );
    expect(botSpeedDetail({ pingMs: 42 })).toBe(" · пинг Discord 42 мс");
    // Before the first heartbeat after login discord.js reports -1.
    expect(botSpeedDetail({ pingMs: -1 })).toBe("");
    expect(botSpeedDetail(null)).toBe("");
  });
});

describe("ban list for the bot", () => {
  it("lists active Discord bans only", async () => {
    const base = { reason: "test", createdByDiscordId: "950000000000000009" };
    await prisma.techBan.createMany({
      data: [
        { ...base, kind: "DISCORD", value: "950000000000000001" },
        { ...base, kind: "DISCORD", value: "950000000000000002", status: RecordStatus.ARCHIVED },
        { ...base, kind: "STATIC", value: "12345" },
      ],
    });
    expect(await listActiveDiscordBanIds()).toEqual(["950000000000000001"]);
  });
});
