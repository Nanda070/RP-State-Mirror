import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus, RoleMappingKind } from "@mirror/db";
import {
  MAX_OPEN_FEEDBACK_TICKETS,
  addFeedbackMessage,
  assignFeedbackTicket,
  closeFeedbackTicket,
  createFeedbackTicket,
  getMutedDmKinds,
  listOwnFeedbackTickets,
  listStaffDiscordIds,
  setMutedDmKinds,
  setSetting,
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

describe("feedback assignee staff list", () => {
  it("lists super admins and holders of ADMIN_LEVEL roles on the main guild", async () => {
    const main = await prisma.guild.create({
      data: { discordId: "800000000000000001", name: "Main", status: RecordStatus.ACTIVE },
    });
    await setSetting("core.mainGuildId", main.discordId, context);
    await prisma.roleMapping.create({
      data: {
        guildId: main.id,
        roleDiscordId: "900000000000000001",
        kind: RoleMappingKind.ADMIN_LEVEL,
        value: "ADMIN",
        status: RecordStatus.ACTIVE,
      },
    });
    await prisma.guildMember.create({
      data: {
        guildId: main.id,
        userDiscordId: "710000000000000001",
        username: "admin.one",
        roleIds: ["900000000000000001"],
        isPresent: true,
      },
    });
    await prisma.guildMember.create({
      data: {
        guildId: main.id,
        userDiscordId: "710000000000000002",
        username: "player.two",
        roleIds: [],
        isPresent: true,
      },
    });

    const staff = await listStaffDiscordIds(["720000000000000001"]);
    expect(staff.sort()).toEqual(["710000000000000001", "720000000000000001"]);

    const ticket = await createFeedbackTicket(
      { authorDiscordId: "730000000000000001", category: "support", content: "Нужна помощь" },
      context,
    );
    const assigned = await assignFeedbackTicket(ticket.id, "710000000000000001", context);
    expect(assigned.assignedToDiscordId).toBe("710000000000000001");
    expect(assigned.status).toBe("IN_PROGRESS");
  });
});
