import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import {
  MAX_OPEN_FEEDBACK_TICKETS,
  addFeedbackMessage,
  closeFeedbackTicket,
  createFeedbackTicket,
  getMutedDmKinds,
  listOwnFeedbackTickets,
  setMutedDmKinds,
  wantsDm,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "player-support.test" } as const;

describe("«Мои обращения»", () => {
  it("keeps at most five open tickets per player and lists only their own", async () => {
    const tickets: Array<{ id: string }> = [];
    for (let index = 0; index < MAX_OPEN_FEEDBACK_TICKETS; index += 1) {
      tickets.push(await createFeedbackTicket({ authorDiscordId: "500", category: "support", content: `Вопрос ${index}` }, context));
    }
    await expect(
      createFeedbackTicket({ authorDiscordId: "500", category: "support", content: "Шестой" }, context),
    ).rejects.toThrow(/открытых обращений/);

    await createFeedbackTicket({ authorDiscordId: "600", category: "support", content: "Чужой" }, context);
    await closeFeedbackTicket(tickets[0]!.id, context);
    await createFeedbackTicket({ authorDiscordId: "500", category: "support", content: "После закрытия" }, context);

    await addFeedbackMessage(tickets[1]!.id, "admin", "Ответ администрации", context);
    await addFeedbackMessage(tickets[1]!.id, "500", "Спасибо", context);
    const own = await listOwnFeedbackTickets("500");
    expect(own).toHaveLength(MAX_OPEN_FEEDBACK_TICKETS + 1);
    expect(own.every((ticket) => ticket.authorDiscordId === "500")).toBe(true);
    expect(own.find((ticket) => ticket.id === tickets[1]!.id)?.messages.map((message) => message.authorDiscordId)).toEqual([
      "500",
      "admin",
      "500",
    ]);
  });
});

describe("DM preferences", () => {
  it("stores switched-off kinds and drops unknown ones on read", async () => {
    await prisma.user.create({ data: { discordId: "700" } });
    expect(await getMutedDmKinds("700")).toEqual([]);
    expect(await wantsDm("700", "fine")).toBe(true);

    await setMutedDmKinds("700", ["fine", "transfer", "fine"], context);
    expect(await getMutedDmKinds("700")).toEqual(["transfer", "fine"]);
    expect(await wantsDm("700", "fine")).toBe(false);
    expect(await wantsDm("700", "registration")).toBe(true);
    await expect(setMutedDmKinds("700", ["nonsense"], context)).rejects.toThrow(/Такого вида уведомлений нет/);

    expect(await wantsDm("unknown-player", "fine")).toBe(true);
  });
});
