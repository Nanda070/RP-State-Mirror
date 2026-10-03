import { describe, expect, it } from "vitest";
import {
  BOT_FOOTER_ICON,
  COLOR_DEFAULT,
  COLOR_ERROR,
  COLOR_FINE,
  COLOR_FINE_OVERDUE,
  COLOR_FINE_PAID,
  COLOR_RESPONSE,
  COLOR_SUCCESS,
  COLOR_WANTED,
  COLOR_WANTED_DONE,
  discordIdentity,
  footerText,
  formatPersonnelDetailsText,
  getMskTimeStr,
  makeCompactAuditEmbed,
  makeDocumentEmbed,
  makeFineEmbed,
  makeFineOverdueEmbed,
  makeFinePaidEmbed,
  makeResponseEmbed,
  makeSyncLogEmbed,
  makeWantedDoneEmbed,
  makeWantedEmbed,
  normalizeLinkOrText,
  safeAvatarUrl,
} from "../src/index.js";

const NOW = new Date(2026, 9, 3, 15, 24, 5); // local wall clock for footerText

const actor = {
  displayName: "Иван",
  username: "ivan",
  avatarUrl: "https://cdn.example/a.png",
};

describe("legacy embed helpers", () => {
  it("matches utils.py helpers", () => {
    expect(footerText(NOW)).toBe("Бот Discord | 03.10.2026 15:24:05");
    expect(discordIdentity("Иван", "ivan")).toBe("Иван (ivan)");
    expect(safeAvatarUrl(null)).toBe(BOT_FOOTER_ICON);
    expect(safeAvatarUrl("https://cdn.example/x.png")).toBe("https://cdn.example/x.png");
    expect(normalizeLinkOrText("https://forum.example/1")).toBe("[Открыть](https://forum.example/1)");
    expect(normalizeLinkOrText("")).toBe("Не указано");
    expect(getMskTimeStr(new Date("2026-10-03T12:24:00.000Z"))).toMatch(
      /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} МСК$/,
    );
  });

  it("exports exact legacy color ints", () => {
    expect(COLOR_DEFAULT).toBe(0x89_89_a8);
    expect(COLOR_RESPONSE).toBe(0x8b_6f_47);
    expect(COLOR_WANTED).toBe(0x6e_6b_73);
    expect(COLOR_WANTED_DONE).toBe(0x5a_8f_63);
    expect(COLOR_SUCCESS).toBe(0x5a_8f_63);
    expect(COLOR_ERROR).toBe(0xa6_4b_4b);
    expect(COLOR_FINE).toBe(0xb0_7a_3f);
    expect(COLOR_FINE_PAID).toBe(0x5a_8f_63);
    expect(COLOR_FINE_OVERDUE).toBe(0xa6_4b_4b);
    expect(BOT_FOOTER_ICON).toBe("https://i.imgur.com/CvzCrPA.png");
  });
});

describe("legacy embed builders", () => {
  it("makeDocumentEmbed uses non-inline fields for width", () => {
    const embed = makeDocumentEmbed({
      actor,
      faction: "LSPD",
      docNumber: "D-1",
      description: "обыск",
      notifiedPerson: "Капитан",
      forumLink: "https://forum.example/d",
      leaderText: "Лидер",
      deputyText: "Зам",
      now: NOW,
    });
    expect(embed.color).toBe(COLOR_DEFAULT);
    expect(embed.title).toBe("Новый документ от Иван");
    expect(embed.description).toBeUndefined();
    expect(embed.fields?.every((f) => f.inline === false)).toBe(true);
    expect(embed.fields?.find((f) => f.name === "Краткое описание")?.value).toBe("обыск");
    expect(embed.fields?.find((f) => f.name === "Ссылка на форум")?.value).toBe(
      "||https://forum.example/d||",
    );
    expect(embed.author).toEqual({
      name: "Автор: ivan",
      iconUrl: "https://cdn.example/a.png",
    });
    expect(embed.footer).toEqual({
      text: "Бот Discord | 03.10.2026 15:24:05",
      iconUrl: BOT_FOOTER_ICON,
    });
    expect(embed.timestamp).toBeUndefined();
  });

  it("makeResponseEmbed uses non-inline fields", () => {
    const embed = makeResponseEmbed({
      docNumber: "D-1",
      actor,
      personalFile: "https://file.example/1",
      video: "нет",
      comment: "ок",
      now: NOW,
    });
    expect(embed.color).toBe(COLOR_RESPONSE);
    expect(embed.title).toBe("Ответ на Документ D-1");
    expect(embed.description).toBeUndefined();
    expect(embed.fields).toEqual([
      { name: "Личное дело", value: "[Открыть](https://file.example/1)", inline: false },
      { name: "Видеофиксация", value: "нет", inline: false },
      { name: "Комментарий", value: "ок", inline: false },
    ]);
    expect(embed.author?.name).toBe("Автор ответа: ivan");
  });

  it("makeWantedEmbed active + closed (fields, no forum when closed)", () => {
    const active = makeWantedEmbed({
      actorName: "Иван",
      actorUsername: "ivan",
      actorAvatarUrl: actor.avatarUrl,
      fio: "Петров",
      passport: "12",
      orderNumber: "W-1",
      article: "УК",
      termText: "10 лет",
      forumLink: "https://forum.example/w",
      now: NOW,
    });
    expect(active.color).toBe(COLOR_WANTED);
    expect(active.title).toBe("Новый ордер от правительства штата");
    expect(active.description).toBeUndefined();
    expect(active.fields?.find((f) => f.name === "Издал ордер")?.value).toBe("Иван");
    expect(active.fields?.find((f) => f.name === "Ссылка на форум")?.value).toBe(
      "||https://forum.example/w||",
    );

    const closed = makeWantedEmbed({
      actorName: "Иван",
      actorUsername: "ivan",
      actorAvatarUrl: actor.avatarUrl,
      fio: "Петров",
      passport: "12",
      orderNumber: "W-1",
      article: "УК",
      termText: "10 лет",
      forumLink: "https://forum.example/w",
      closed: true,
      closedBy: "Сергей (serg)",
      evidenceLink: "https://ev.example/1",
      now: NOW,
    });
    expect(closed.color).toBe(COLOR_WANTED_DONE);
    expect(closed.title).toBe("Исполненный ордер правительства штата");
    expect(closed.fields?.find((f) => f.name === "Издал ордер")?.value).toBe("~~Иван~~");
    expect(closed.fields?.find((f) => f.name === "Статус")?.value).toBe("Исполнено");
    expect(closed.fields?.some((f) => f.name === "Ссылка на форум")).toBe(false);
  });

  it("makeWantedDoneEmbed / fine embeds / overdue / audit / sync", () => {
    const done = makeWantedDoneEmbed({
      actor,
      wantedNumber: "W-1",
      evidenceLink: "photo",
      now: NOW,
    });
    expect(done.color).toBe(COLOR_WANTED_DONE);
    expect(done.fields?.some((f) => f.value.includes("Иван (ivan)"))).toBe(true);

    const fine = makeFineEmbed({
      actor,
      faction: "LSPD",
      fineNumber: "F-1",
      fio: "Петров",
      passport: "12",
      article: "ст.1",
      amount: 5000,
      paymentDeadlineText: "24h",
      now: NOW,
    });
    expect(fine.color).toBe(COLOR_FINE);
    expect(fine.title).toBe("Новый штраф от Иван");
    expect(fine.description).toBeUndefined();
    expect(fine.fields?.every((f) => f.inline === false)).toBe(true);
    expect(fine.fields?.find((f) => f.name === "Уведомляемая фракция")?.value).toBe("LSPD");

    const paid = makeFinePaidEmbed({
      fineNumber: "F-1",
      fio: "Петров",
      passport: "12",
      amount: 5000,
      actor,
      now: NOW,
    });
    expect(paid.color).toBe(COLOR_FINE_PAID);
    expect(paid.title).toBe("Штраф оплачен");
    expect(paid.fields?.find((f) => f.name === "Сумма")?.value).toBe("5000");

    const overdue = makeFineOverdueEmbed({
      fine: {
        fineNumber: "F-1",
        faction: "LSPD",
        fio: "Петров",
        passport: "12",
        article: "ст.1",
        amount: 5000,
        paymentDeadlineText: "24h",
        createdByDisplayName: "Иван",
        createdByUsername: "ivan",
      },
      now: NOW,
    });
    expect(overdue.color).toBe(COLOR_FINE_OVERDUE);
    expect(overdue.title).toBe("Неоплаченный штраф");
    expect(overdue.author).toBeUndefined();
    expect(overdue.fields?.find((f) => f.name === "Фракция")?.value).toBe("LSPD");

    const audit = makeCompactAuditEmbed({
      actionTitle: "повышения",
      actorDisplayName: "Иван",
      actorId: "1",
      targetDisplayName: "Петр",
      targetId: "2",
      actorLabel: "Повысил:",
      targetLabel: "Повышаемый:",
      detailsText: "**Был:** 1 | **Стал:** 2 | **Причина:** —",
      targetAvatarUrl: "https://cdn.example/t.png",
      now: NOW,
    });
    expect(audit.color).toBe(COLOR_DEFAULT);
    expect(audit.title).toBe("Кадровый-Аудит повышения");
    expect(audit.footer?.text).toMatch(/^Бот Orbit \| /);
    expect(audit.footer?.iconUrl).toBe(BOT_FOOTER_ICON);
    expect(audit.thumbnail).toBe("https://cdn.example/t.png");
    expect(audit.fields?.every((f) => f.inline === false)).toBe(true);

    const sync = makeSyncLogEmbed({
      memberMention: "<@9>",
      displayName: "Иван",
      username: "ivan",
      userId: "9",
      action: "UPDATE",
      details: "**Выданы роли:** <@&1>",
      color: COLOR_SUCCESS,
      avatarUrl: actor.avatarUrl,
      now: NOW,
    });
    expect(sync.title).toBe("Синхронизация доступов: UPDATE");
    expect(sync.timestamp).toBe(true);
    expect(sync.description).toBeUndefined();
    expect(sync.fields?.find((f) => f.name === "User ID")?.value).toBe("`9`");
  });

  it("formats personnel details like legacy audit lines", () => {
    expect(formatPersonnelDetailsText("promotion", { fromRank: 1, toRank: 2, comment: "ok" })).toBe(
      "**Был:** 1 | **Стал:** 2 | **Причина:** ok",
    );
    expect(formatPersonnelDetailsText("dismissal", { reason: "НКО" })).toBe("**Причина:** НКО");
    expect(
      formatPersonnelDetailsText("transfer", { fromDepartment: "A", toDepartment: "B" }),
    ).toBe("**Был:** A | **Стал:** B");
  });
});
