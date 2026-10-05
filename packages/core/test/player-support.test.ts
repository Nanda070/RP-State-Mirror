import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus, RoleMappingKind } from "@mirror/db";
import {
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_OPEN_FEEDBACK_TICKETS,
  getFeedbackAttachmentInfo,
  isOwnFeedbackAttachment,
  sniffAttachmentContentType,
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

describe("ticket attachments", () => {
  async function upload(createdById: string | null, contentType = "image/png") {
    return prisma.mediaFile.create({
      data: {
        objectKey: `media/test/${Math.random().toString(36).slice(2)}`,
        originalName: "screen.png",
        contentType,
        sizeBytes: 1234,
        createdById,
      },
    });
  }

  it("detects pictures and PDF from the bytes only", () => {
    expect(sniffAttachmentContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffAttachmentContentType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffAttachmentContentType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffAttachmentContentType(new TextEncoder().encode("MZ\x90\x00"))).toBeNull();
  });

  it("keeps files on messages, lets only the author and staff read them, and needs text or a file", async () => {
    const uploader = await prisma.user.create({ data: { discordId: "740000000000000001" } });
    const picture = await upload(uploader.id);
    const pdf = await upload(uploader.id, "application/pdf");

    await expect(
      createFeedbackTicket({ authorDiscordId: uploader.discordId, category: "support", content: "   " }, context),
    ).rejects.toThrow(/прикрепите файл/);

    const ticket = await createFeedbackTicket(
      {
        authorDiscordId: uploader.discordId,
        category: "support",
        content: "",
        attachmentFileIds: [picture.id, pdf.id],
        uploaderUserId: uploader.id,
      },
      context,
    );
    expect(ticket.messages[0]?.content).toBe("");
    expect(ticket.messages[0]?.attachmentFileIds).toEqual([picture.id, pdf.id]);
    expect(await isOwnFeedbackAttachment(picture.id, uploader.discordId)).toBe(true);
    expect(await isOwnFeedbackAttachment(picture.id, "740000000000000002")).toBe(false);

    // A staff reply with a file: the ticket author may read it too.
    const staffUser = await prisma.user.create({ data: { discordId: "740000000000000009" } });
    const staffFile = await upload(staffUser.id);
    await addFeedbackMessage(ticket.id, staffUser.discordId, "Посмотрите вложение", context, {
      attachmentFileIds: [staffFile.id],
      uploaderUserId: staffUser.id,
    });
    expect(await isOwnFeedbackAttachment(staffFile.id, uploader.discordId)).toBe(true);

    const info = await getFeedbackAttachmentInfo([picture.id, pdf.id, staffFile.id]);
    expect(info.get(pdf.id)?.contentType).toBe("application/pdf");
  });

  it("refuses foreign, reused, unknown, wrong-type and too many files", async () => {
    const owner = await prisma.user.create({ data: { discordId: "750000000000000001" } });
    const stranger = await prisma.user.create({ data: { discordId: "750000000000000002" } });
    const ticket = await createFeedbackTicket({ authorDiscordId: owner.discordId, category: "support", content: "Привет" }, context);

    const foreign = await upload(stranger.id);
    await expect(
      addFeedbackMessage(ticket.id, owner.discordId, "чужой", context, { attachmentFileIds: [foreign.id], uploaderUserId: owner.id }),
    ).rejects.toThrow(/Файл не найден/);

    const mine = await upload(owner.id);
    await addFeedbackMessage(ticket.id, owner.discordId, "мой", context, { attachmentFileIds: [mine.id], uploaderUserId: owner.id });
    await expect(
      addFeedbackMessage(ticket.id, owner.discordId, "ещё раз", context, { attachmentFileIds: [mine.id], uploaderUserId: owner.id }),
    ).rejects.toThrow(/уже прикреплён/);

    await expect(
      addFeedbackMessage(ticket.id, owner.discordId, "нет файла", context, { attachmentFileIds: ["missing"] }),
    ).rejects.toThrow(/Файл не найден/);

    const svg = await upload(owner.id, "image/svg+xml");
    await expect(
      addFeedbackMessage(ticket.id, owner.discordId, "svg", context, { attachmentFileIds: [svg.id], uploaderUserId: owner.id }),
    ).rejects.toThrow(/Файл не найден/);

    const many = await Promise.all(Array.from({ length: MAX_FEEDBACK_ATTACHMENTS + 1 }, () => upload(owner.id)));
    await expect(
      addFeedbackMessage(ticket.id, owner.discordId, "много", context, {
        attachmentFileIds: many.map((file) => file.id),
        uploaderUserId: owner.id,
      }),
    ).rejects.toThrow(/не больше/);
  });
});
