/**
 * FAQ and documentation (§5.3): sections with Markdown articles, ordered by `position`.
 * Readable by any signed-in user; edited by «Хелпер» and above.
 */
import { RecordStatus, prisma, type Prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

export class FaqError extends UserError {
  override name = "FaqError";
}

const titleSchema = z.string().trim().min(1, "Укажите заголовок").max(160);
const bodySchema = z.string().trim().min(1, "Текст статьи не может быть пустым").max(20_000);

export const faqSectionInputSchema = z.object({ title: titleSchema });
export const faqItemInputSchema = z.object({
  sectionId: z.string().min(1),
  title: titleSchema,
  body: bodySchema,
});
export const faqItemUpdateSchema = faqItemInputSchema.partial();

export async function listFaq() {
  return prisma.faqSection.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        where: { status: RecordStatus.ACTIVE },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

async function requireSection(tx: Prisma.TransactionClient, id: string) {
  const section = await tx.faqSection.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
  if (!section) throw new FaqError("Раздел не найден.");
  return section;
}

async function requireItem(tx: Prisma.TransactionClient, id: string) {
  const item = await tx.faqItem.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
  if (!item) throw new FaqError("Статья не найдена.");
  return item;
}

async function nextItemPosition(tx: Prisma.TransactionClient, sectionId: string) {
  const last = await tx.faqItem.aggregate({
    where: { sectionId, status: RecordStatus.ACTIVE },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}

export async function createFaqSection(input: z.input<typeof faqSectionInputSchema>, context: AuditContext) {
  const data = faqSectionInputSchema.parse(input);
  return auditedMutation(context, "faq_section.created", "faq_section", async (tx) => {
    const last = await tx.faqSection.aggregate({ where: { status: RecordStatus.ACTIVE }, _max: { position: true } });
    const section = await tx.faqSection.create({
      data: { title: data.title, position: (last._max.position ?? -1) + 1 },
    });
    return { entityId: section.id, after: section, result: section };
  });
}

export async function updateFaqSection(
  id: string,
  input: z.input<typeof faqSectionInputSchema>,
  context: AuditContext,
) {
  const data = faqSectionInputSchema.parse(input);
  return auditedMutation(context, "faq_section.updated", "faq_section", async (tx) => {
    const current = await requireSection(tx, id);
    const section = await tx.faqSection.update({ where: { id }, data: { title: data.title } });
    return { entityId: id, before: current, after: section, result: section };
  });
}

/** Archives the section together with its articles. */
export async function archiveFaqSection(id: string, context: AuditContext) {
  return auditedMutation(context, "faq_section.archived", "faq_section", async (tx) => {
    const current = await requireSection(tx, id);
    const { count } = await tx.faqItem.updateMany({
      where: { sectionId: id, status: RecordStatus.ACTIVE },
      data: { status: RecordStatus.ARCHIVED },
    });
    const section = await tx.faqSection.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
    return { entityId: id, before: current, after: section, metadata: { archivedItems: count }, result: section };
  });
}

/**
 * Applies a new order. `orderedIds` must list exactly the ACTIVE ids of the scope,
 * so a stale client cannot silently drop or duplicate entries.
 */
function assertSameIds(current: readonly string[], orderedIds: readonly string[]) {
  const wanted = new Set(orderedIds);
  if (wanted.size !== orderedIds.length || wanted.size !== current.length || current.some((id) => !wanted.has(id))) {
    throw new FaqError("Список изменился. Обновите страницу и повторите.");
  }
}

export async function reorderFaqSections(orderedIds: string[], context: AuditContext) {
  return auditedMutation(context, "faq_section.reordered", "faq_section", async (tx) => {
    const sections = await tx.faqSection.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const before = sections.map((section) => section.id);
    assertSameIds(before, orderedIds);
    for (const [position, id] of orderedIds.entries()) {
      await tx.faqSection.update({ where: { id }, data: { position } });
    }
    return { entityId: "order", before, after: orderedIds, result: orderedIds };
  });
}

export async function reorderFaqItems(sectionId: string, orderedIds: string[], context: AuditContext) {
  return auditedMutation(context, "faq_item.reordered", "faq_section", async (tx) => {
    await requireSection(tx, sectionId);
    const items = await tx.faqItem.findMany({
      where: { sectionId, status: RecordStatus.ACTIVE },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const before = items.map((item) => item.id);
    assertSameIds(before, orderedIds);
    for (const [position, id] of orderedIds.entries()) {
      await tx.faqItem.update({ where: { id }, data: { position } });
    }
    return { entityId: sectionId, before, after: orderedIds, result: orderedIds };
  });
}

export async function createFaqItem(
  input: z.input<typeof faqItemInputSchema>,
  actorDiscordId: string,
  context: AuditContext,
) {
  const data = faqItemInputSchema.parse(input);
  return auditedMutation(context, "faq_item.created", "faq_item", async (tx) => {
    await requireSection(tx, data.sectionId);
    const item = await tx.faqItem.create({
      data: {
        sectionId: data.sectionId,
        title: data.title,
        body: data.body,
        position: await nextItemPosition(tx, data.sectionId),
        updatedByDiscordId: actorDiscordId,
      },
    });
    return { entityId: item.id, after: item, result: item };
  });
}

export async function updateFaqItem(
  id: string,
  input: z.input<typeof faqItemUpdateSchema>,
  actorDiscordId: string,
  context: AuditContext,
) {
  const data = faqItemUpdateSchema.parse(input);
  return auditedMutation(context, "faq_item.updated", "faq_item", async (tx) => {
    const current = await requireItem(tx, id);
    const moved = data.sectionId !== undefined && data.sectionId !== current.sectionId;
    if (moved) await requireSection(tx, data.sectionId as string);
    const item = await tx.faqItem.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        // A moved article goes to the end of its new section.
        ...(moved
          ? { sectionId: data.sectionId as string, position: await nextItemPosition(tx, data.sectionId as string) }
          : {}),
        updatedByDiscordId: actorDiscordId,
      },
    });
    return { entityId: id, before: current, after: item, result: item };
  });
}

export async function archiveFaqItem(id: string, context: AuditContext) {
  return auditedMutation(context, "faq_item.archived", "faq_item", async (tx) => {
    const current = await requireItem(tx, id);
    const item = await tx.faqItem.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
    return { entityId: id, before: current, after: item, result: item };
  });
}
