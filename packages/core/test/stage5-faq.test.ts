import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  FaqError,
  archiveFaqItem,
  archiveFaqSection,
  createFaqItem,
  createFaqSection,
  listFaq,
  reorderFaqItems,
  reorderFaqSections,
  updateFaqItem,
  updateFaqSection,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.faq.test" } as const;
const ACTOR = "800000000000000001";

describe("faq", () => {
  it("keeps sections and articles in the order they were added and reorders them", async () => {
    const rules = await createFaqSection({ title: "Правила" }, context);
    const bot = await createFaqSection({ title: "Бот" }, context);
    const a = await createFaqItem({ sectionId: bot.id, title: "A", body: "текст A" }, ACTOR, context);
    const b = await createFaqItem({ sectionId: bot.id, title: "B", body: "текст B" }, ACTOR, context);
    const c = await createFaqItem({ sectionId: bot.id, title: "C", body: "текст C" }, ACTOR, context);

    let faq = await listFaq();
    expect(faq.map((s) => s.title)).toEqual(["Правила", "Бот"]);
    expect(faq[1]?.items.map((i) => i.title)).toEqual(["A", "B", "C"]);

    await reorderFaqSections([bot.id, rules.id], context);
    await reorderFaqItems(bot.id, [c.id, a.id, b.id], context);
    faq = await listFaq();
    expect(faq.map((s) => s.title)).toEqual(["Бот", "Правила"]);
    expect(faq[0]?.items.map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("refuses a reorder built from a stale list", async () => {
    const section = await createFaqSection({ title: "Бот" }, context);
    const a = await createFaqItem({ sectionId: section.id, title: "A", body: "x" }, ACTOR, context);
    const b = await createFaqItem({ sectionId: section.id, title: "B", body: "x" }, ACTOR, context);

    await expect(reorderFaqItems(section.id, [a.id], context)).rejects.toBeInstanceOf(FaqError);
    await expect(reorderFaqItems(section.id, [a.id, a.id], context)).rejects.toBeInstanceOf(FaqError);
    await expect(reorderFaqItems(section.id, [a.id, b.id, "ghost"], context)).rejects.toBeInstanceOf(FaqError);
    await expect(reorderFaqSections([], context)).rejects.toBeInstanceOf(FaqError);
    expect((await listFaq())[0]?.items.map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("edits an article, moves it to the end of another section and records the editor", async () => {
    const first = await createFaqSection({ title: "Первый" }, context);
    const second = await createFaqSection({ title: "Второй" }, context);
    const item = await createFaqItem({ sectionId: first.id, title: "Вопрос", body: "Ответ" }, ACTOR, context);
    await createFaqItem({ sectionId: second.id, title: "Старая", body: "x" }, ACTOR, context);

    const updated = await updateFaqItem(item.id, { title: "Новый вопрос" }, "800000000000000002", context);
    expect(updated).toMatchObject({ title: "Новый вопрос", body: "Ответ", sectionId: first.id });
    expect(updated.updatedByDiscordId).toBe("800000000000000002");

    await updateFaqItem(item.id, { sectionId: second.id }, ACTOR, context);
    const faq = await listFaq();
    expect(faq[0]?.items).toHaveLength(0);
    expect(faq[1]?.items.map((i) => i.title)).toEqual(["Старая", "Новый вопрос"]);

    await expect(updateFaqItem(item.id, { sectionId: "missing" }, ACTOR, context)).rejects.toBeInstanceOf(FaqError);
    await expect(updateFaqItem(item.id, { body: "   " }, ACTOR, context)).rejects.toThrow();
    await updateFaqSection(first.id, { title: "Переименован" }, context);
    expect((await listFaq())[0]?.title).toBe("Переименован");
  });

  it("archives instead of deleting, and a section takes its articles with it", async () => {
    const section = await createFaqSection({ title: "Временный" }, context);
    const keep = await createFaqSection({ title: "Остаётся" }, context);
    await createFaqItem({ sectionId: section.id, title: "A", body: "x" }, ACTOR, context);
    const single = await createFaqItem({ sectionId: keep.id, title: "B", body: "x" }, ACTOR, context);

    await archiveFaqSection(section.id, context);
    await archiveFaqItem(single.id, context);

    const faq = await listFaq();
    expect(faq.map((s) => s.title)).toEqual(["Остаётся"]);
    expect(faq[0]?.items).toHaveLength(0);
    expect(await prisma.faqItem.count({ where: { status: RecordStatus.ARCHIVED } })).toBe(2);
    expect(await prisma.faqSection.count()).toBe(2);

    await expect(archiveFaqSection(section.id, context)).rejects.toBeInstanceOf(FaqError);
    await expect(
      createFaqItem({ sectionId: section.id, title: "C", body: "x" }, ACTOR, context),
    ).rejects.toBeInstanceOf(FaqError);
  });
});
