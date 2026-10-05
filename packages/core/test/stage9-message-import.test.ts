import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobStatus, RecordStatus } from "@mirror/db";
import {
  completeJob,
  createButtonAction,
  discordMessageToSpec,
  enqueueMessageImport,
  getMessageImport,
  parseDiscordMessageLink,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ROLE = "300000000000000001";

describe("Discord message → editor template", () => {
  it("reads classic embeds, text above them and buttons", async () => {
    const own = await createButtonAction("role.toggle", { roleId: ROLE });
    const { spec, notes } = await discordMessageToSpec({
      content: "Внимание всем",
      embeds: [
        {
          type: "rich",
          title: "Набор в LSPD",
          description: "Подробности ниже",
          color: 0x3366ff,
          url: "https://example.com/news",
          author: { name: "Mirror", icon_url: "https://example.com/a.png" },
          footer: { text: "GTA5RP" },
          image: { url: "https://cdn.discordapp.com/attachments/1/2/pic.png" },
          fields: [{ name: "Где", value: "Мэрия", inline: true }, { name: "", value: "" }],
          timestamp: "2026-10-05T10:00:00.000Z",
        },
        { type: "link", title: "превью ссылки" },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Сайт", url: "https://example.com" },
            { type: 2, style: 1, label: "Получить роль", custom_id: own.customId, emoji: { name: "🚓" } },
            { type: 2, style: 2, label: "Чужая", custom_id: "otherbot:press" },
          ],
        },
      ],
    });
    expect(spec).toMatchObject({
      version: 1,
      embeds: [
        { type: "embed", description: "Внимание всем" },
        {
          title: "Набор в LSPD",
          color: 0x3366ff,
          author: { name: "Mirror", iconUrl: "https://example.com/a.png" },
          footer: { text: "GTA5RP" },
          fields: [{ name: "Где", value: "Мэрия", inline: true }, { name: "​", value: "​" }],
          timestamp: true,
        },
      ],
      components: [
        {
          type: "action_row",
          components: [
            { label: "Сайт", style: "link", url: "https://example.com" },
            { label: "Получить роль", style: "primary", emoji: "🚓", action: "role.toggle", params: { roleId: ROLE } },
            { label: "Чужая", disabled: true },
          ],
        },
      ],
    });
    expect(spec.version === 1 && spec.embeds).toHaveLength(2);
    expect(notes.join(" ")).toMatch(/отдельный эмбед/);
    expect(notes.join(" ")).toMatch(/Превью ссылок/);
    expect(notes.join(" ")).toMatch(/выключенными/);
    expect(notes.join(" ")).toMatch(/вложений Discord/);
  });

  it("reads Components V2: containers, sections, galleries and role dropdowns", async () => {
    const select = await createButtonAction("role.select", { roleIds: [ROLE], allowedRoleIds: ["300000000000000009"], maxValues: 1 });
    const { spec, notes } = await discordMessageToSpec({
      flags: 1 << 15,
      components: [
        { type: 10, content: "Текст вне контейнера" },
        {
          type: 17,
          accent_color: 0xff6a1a,
          components: [
            { type: 9, components: [{ type: 10, content: "Раздел" }], accessory: { type: 11, media: { url: "https://example.com/t.png" } } },
            { type: 14, divider: true, spacing: 2 },
            { type: 12, items: [{ media: { url: "https://example.com/1.png" }, description: "Фото" }] },
            {
              type: 1,
              components: [
                {
                  type: 3,
                  custom_id: select.customId,
                  placeholder: "Выберите отдел",
                  max_values: 1,
                  options: [{ label: "Патруль", value: ROLE, emoji: { id: "123", name: "badge" } }],
                },
              ],
            },
            { type: 13 },
          ],
        },
      ],
    });
    expect(spec).toEqual({
      version: 2,
      components: [
        { type: "container", components: [{ type: "text_display", content: "Текст вне контейнера" }] },
        {
          type: "container",
          accentColor: 0xff6a1a,
          components: [
            { type: "text_display", content: "Раздел" },
            { type: "media_gallery", items: [{ url: "https://example.com/t.png" }] },
            { type: "separator", spacing: "large" },
            { type: "media_gallery", items: [{ url: "https://example.com/1.png", description: "Фото" }] },
            {
              type: "role_select",
              placeholder: "Выберите отдел",
              maxValues: 1,
              allowedRoleIds: ["300000000000000009"],
              options: [{ label: "Патруль", roleDiscordId: ROLE, emoji: "<:badge:123>" }],
            },
          ],
        },
      ],
    });
    expect(notes.join(" ")).toMatch(/Файлы/);
  });

  it("opens a plain text message as Components V2 and refuses an empty one", async () => {
    const { spec } = await discordMessageToSpec({ content: "Просто текст" });
    expect(spec).toEqual({ version: 2, components: [{ type: "container", components: [{ type: "text_display", content: "Просто текст" }] }] });
    await expect(discordMessageToSpec({ content: "", embeds: [] })).rejects.toThrow(/нет ни текста/);
  });

  it("parses links and keeps the result for the person who asked", async () => {
    expect(parseDiscordMessageLink("https://ptb.discord.com/channels/100000000000000001/100000000000000002/100000000000000003")).toEqual({
      guildDiscordId: "100000000000000001",
      channelDiscordId: "100000000000000002",
      messageDiscordId: "100000000000000003",
    });
    expect(() => parseDiscordMessageLink("https://example.com/channels/1/2/3")).toThrow(/ссылка на сообщение/);

    const link = "https://discord.com/channels/100000000000000001/100000000000000002/100000000000000003";
    await expect(enqueueMessageImport(link, "500")).rejects.toThrow(/Бота нет/);
    await prisma.guild.create({ data: { discordId: "100000000000000001", name: "Main", status: RecordStatus.ACTIVE } });
    const job = await enqueueMessageImport(link, "500");
    expect(job.maxAttempts).toBe(1);
    expect(await getMessageImport(job.id, "500")).toEqual({ state: "pending" });
    await expect(getMessageImport(job.id, "600")).rejects.toThrow(/не найдена/);

    await prisma.job.update({ where: { id: job.id }, data: { status: JobStatus.RUNNING, lockedBy: "w" } });
    const spec = { version: 2, components: [{ type: "container", components: [{ type: "text_display", content: "x" }] }] };
    await completeJob(job.id, "w", { spec, notes: ["заметка"] });
    expect(await getMessageImport(job.id, "500")).toEqual({ state: "done", spec, notes: ["заметка"] });

    const refused = await enqueueMessageImport(link, "500");
    await prisma.job.update({ where: { id: refused.id }, data: { status: JobStatus.RUNNING, lockedBy: "w" } });
    await completeJob(refused.id, "w", { error: "Сообщение не найдено" });
    expect(await getMessageImport(refused.id, "500")).toEqual({ state: "failed", error: "Сообщение не найдено" });
  });
});
