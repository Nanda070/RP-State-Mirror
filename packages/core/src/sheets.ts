/**
 * Public spreadsheets (PLAN §17).
 *
 * A table is one workbook kept as a snapshot in the editor's own format; the server does not look
 * inside it beyond a few sanity checks. Anyone may read a table; «Админ» and above edit it — the
 * caller checks the role, this module checks everything else:
 *
 * - one editor at a time: an edit lock with a short lease, extended by every save;
 * - no silent overwrites: a save names the version it was made from;
 * - history: a revision at most every ten minutes of editing, and one when editing ends.
 *
 * Nothing is deleted: tables are archived, revisions stay.
 */
import { RecordStatus, prisma, type Prisma } from "@mirror/db";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditedMutation, writeAuditEvent, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import { UserError } from "./errors.js";

export class SheetError extends UserError {
  override name = "SheetError";
}

export const SHEET_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SHEET_LOCK_TTL_MS = 2 * 60_000;
export const SHEET_REVISION_INTERVAL_MS = 10 * 60_000;
export const MAX_SHEET_DOCUMENTS = 30;

const titleSchema = z.string().trim().min(1, "Укажите название таблицы.").max(80, "Название длиннее 80 символов.");
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "Адрес: 2–48 символов, латиница, цифры и дефис.");

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** «Реестр организаций» → «reestr-organizaciy». */
export function sheetSlugFromTitle(title: string): string {
  const slug = [...title.toLowerCase()]
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "table";
}

/** An empty workbook with one sheet. */
export function blankSheetSnapshot(title: string): Record<string, unknown> {
  const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
  return {
    name: title,
    sheetOrder: [sheetId],
    sheets: { [sheetId]: { id: sheetId, name: "Лист1", rowCount: 200, columnCount: 26 } },
  };
}

/** A workbook must be an object with at least one sheet; its size is bounded. Returns the size in bytes. */
export function assertSheetSnapshot(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new SheetError("Таблица повреждена: сохранение отклонено.");
  }
  const sheets = (snapshot as { sheets?: unknown }).sheets;
  if (!sheets || typeof sheets !== "object" || Array.isArray(sheets) || Object.keys(sheets).length === 0) {
    throw new SheetError("В таблице должен остаться хотя бы один лист.");
  }
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (bytes > SHEET_SNAPSHOT_MAX_BYTES) {
    throw new SheetError("Таблица больше 5 МБ. Удалите лишние листы или строки.");
  }
  return bytes;
}

const META = {
  id: true,
  slug: true,
  title: true,
  sortOrder: true,
  status: true,
  version: true,
  lockDiscordId: true,
  lockExpiresAt: true,
  updatedByDiscordId: true,
  updatedAt: true,
} satisfies Prisma.SheetDocumentSelect;

export type SheetDocumentMeta = Prisma.SheetDocumentGetPayload<{ select: typeof META }>;

/** Tabs of the «Таблицы» page: active tables in their order, without the workbooks. */
export async function listSheetDocuments(): Promise<SheetDocumentMeta[]> {
  return prisma.sheetDocument.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: META,
  });
}

export async function getSheetSnapshot(id: string) {
  return prisma.sheetDocument.findFirst({
    where: { id, status: RecordStatus.ACTIVE },
    select: { id: true, version: true, snapshot: true },
  });
}

async function freeSlug(db: Prisma.TransactionClient, wanted: string, exceptId?: string): Promise<string> {
  const taken = new Set(
    (
      await db.sheetDocument.findMany({
        where: { status: RecordStatus.ACTIVE, slug: { startsWith: wanted }, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { slug: true },
      })
    ).map((row) => row.slug),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createSheetDocument(
  input: { title: string; snapshot?: unknown },
  actorDiscordId: string,
  context: AuditContext,
) {
  const title = titleSchema.parse(input.title);
  const snapshot = input.snapshot ?? blankSheetSnapshot(title);
  const bytes = assertSheetSnapshot(snapshot);
  return auditedMutation(context, "sheet_document.created", "sheet_document", async (tx) => {
    const count = await tx.sheetDocument.count({ where: { status: RecordStatus.ACTIVE } });
    if (count >= MAX_SHEET_DOCUMENTS) throw new SheetError(`Таблиц уже ${count}. Уберите ненужные в архив.`);
    const last = await tx.sheetDocument.findFirst({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const document = await tx.sheetDocument.create({
      data: {
        slug: await freeSlug(tx, sheetSlugFromTitle(title)),
        title,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        snapshot: toJsonValue(snapshot),
        createdByDiscordId: actorDiscordId,
        updatedByDiscordId: actorDiscordId,
        revisions: {
          create: {
            version: 1,
            snapshot: toJsonValue(snapshot),
            reason: input.snapshot ? "import" : "create",
            createdByDiscordId: actorDiscordId,
          },
        },
      },
      select: META,
    });
    return { entityId: document.id, after: document, metadata: { bytes }, result: document };
  });
}

export async function updateSheetDocumentMeta(
  id: string,
  input: { title?: string; slug?: string },
  context: AuditContext,
) {
  const title = input.title === undefined ? undefined : titleSchema.parse(input.title);
  const slug = input.slug === undefined ? undefined : slugSchema.parse(input.slug);
  return auditedMutation(context, "sheet_document.updated", "sheet_document", async (tx) => {
    const before = await tx.sheetDocument.findFirst({ where: { id, status: RecordStatus.ACTIVE }, select: META });
    if (!before) throw new SheetError("Таблица не найдена.");
    if (slug && slug !== before.slug && (await freeSlug(tx, slug, id)) !== slug) {
      throw new SheetError(`Адрес «${slug}» уже занят другой таблицей.`);
    }
    const after = await tx.sheetDocument.update({
      where: { id },
      data: { ...(title ? { title } : {}), ...(slug ? { slug } : {}) },
      select: META,
    });
    return { entityId: id, before, after, result: after };
  });
}

/** New order of the tabs: ids of all active tables, first to last. Unknown ids are ignored. */
export async function reorderSheetDocuments(ids: readonly string[], context: AuditContext) {
  return auditedMutation(context, "sheet_document.reordered", "sheet_document", async (tx) => {
    const active = await tx.sheetDocument.findMany({ where: { status: RecordStatus.ACTIVE }, select: { id: true } });
    const known = new Set(active.map((row) => row.id));
    const order = [...new Set(ids)].filter((entry) => known.has(entry));
    for (const [index, entry] of order.entries()) {
      await tx.sheetDocument.update({ where: { id: entry }, data: { sortOrder: index + 1 } });
    }
    return { entityId: order[0] ?? "none", after: { order }, result: order };
  });
}

export async function archiveSheetDocument(id: string, context: AuditContext) {
  return auditedMutation(context, "sheet_document.archived", "sheet_document", async (tx) => {
    const before = await tx.sheetDocument.findFirst({ where: { id, status: RecordStatus.ACTIVE }, select: META });
    if (!before) throw new SheetError("Таблица не найдена.");
    const after = await tx.sheetDocument.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED, lockDiscordId: null, lockExpiresAt: null },
      select: META,
    });
    return { entityId: id, before, after, result: after };
  });
}

/**
 * Takes or extends the edit lock. Fails only when someone else holds a lease that has not run out;
 * then `holderDiscordId` says who.
 */
export async function acquireSheetLock(id: string, discordId: string, now = new Date()) {
  const taken = await prisma.sheetDocument.updateMany({
    where: {
      id,
      status: RecordStatus.ACTIVE,
      OR: [{ lockDiscordId: null }, { lockDiscordId: discordId }, { lockExpiresAt: { lte: now } }],
    },
    data: { lockDiscordId: discordId, lockExpiresAt: new Date(now.getTime() + SHEET_LOCK_TTL_MS) },
  });
  const document = await prisma.sheetDocument.findFirst({
    where: { id, status: RecordStatus.ACTIVE },
    select: { version: true, lockDiscordId: true, lockExpiresAt: true },
  });
  if (!document) throw new SheetError("Таблица не найдена.");
  return { ok: taken.count === 1, holderDiscordId: document.lockDiscordId, version: document.version };
}

export async function releaseSheetLock(id: string, discordId: string) {
  await prisma.sheetDocument.updateMany({
    where: { id, lockDiscordId: discordId },
    data: { lockDiscordId: null, lockExpiresAt: null },
  });
}

/**
 * Stores the workbook. `baseVersion` is the version the editor loaded; `checkpoint` marks the end of
 * an editing session and always leaves a revision.
 */
export async function saveSheetSnapshot(
  id: string,
  input: { snapshot: unknown; baseVersion: number; checkpoint?: boolean },
  actorDiscordId: string,
  context: AuditContext,
  now = new Date(),
) {
  const bytes = assertSheetSnapshot(input.snapshot);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sheet_documents WHERE id = ${id} FOR UPDATE`;
      const current = await tx.sheetDocument.findFirst({ where: { id, status: RecordStatus.ACTIVE }, select: META });
      if (!current) throw new SheetError("Таблица не найдена.");
      const lockedByOther =
        current.lockDiscordId !== null &&
        current.lockDiscordId !== actorDiscordId &&
        current.lockExpiresAt !== null &&
        current.lockExpiresAt > now;
      if (lockedByOther) throw new SheetError("Таблицу сейчас редактирует другой администратор.");
      if (current.version !== input.baseVersion) {
        throw new SheetError("Таблицу изменили в другом окне. Обновите страницу — несохранённые правки будут потеряны.");
      }

      const version = current.version + 1;
      await tx.sheetDocument.update({
        where: { id },
        data: {
          snapshot: toJsonValue(input.snapshot),
          version,
          updatedByDiscordId: actorDiscordId,
          lockDiscordId: actorDiscordId,
          lockExpiresAt: new Date(now.getTime() + SHEET_LOCK_TTL_MS),
        },
      });

      const lastRevision = await tx.sheetRevision.findFirst({
        where: { documentId: id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const due = !lastRevision || now.getTime() - lastRevision.createdAt.getTime() >= SHEET_REVISION_INTERVAL_MS;
      let revision = false;
      if (input.checkpoint || due) {
        await tx.sheetRevision.create({
          data: {
            documentId: id,
            version,
            snapshot: toJsonValue(input.snapshot),
            reason: "edit",
            createdByDiscordId: actorDiscordId,
            createdAt: now,
          },
        });
        // The journal records sessions, not every autosave; the workbook itself stays out of it.
        await writeAuditEvent(
          {
            ...context,
            action: "sheet_document.saved",
            entityType: "sheet_document",
            entityId: id,
            metadata: { ...context.metadata, version, bytes },
          },
          tx,
        );
        revision = true;
      }
      return { version, bytes, revision };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export async function listSheetRevisions(documentId: string) {
  return prisma.sheetRevision.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, version: true, reason: true, createdByDiscordId: true, createdAt: true },
  });
}

/** Puts an earlier workbook back as a new version; the state before the return stays in history too. */
export async function restoreSheetRevision(
  revisionId: string,
  actorDiscordId: string,
  context: AuditContext,
  now = new Date(),
) {
  return auditedMutation(context, "sheet_document.restored", "sheet_document", async (tx) => {
    const revision = await tx.sheetRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new SheetError("Версия не найдена.");
    await tx.$queryRaw`SELECT id FROM sheet_documents WHERE id = ${revision.documentId} FOR UPDATE`;
    const current = await tx.sheetDocument.findFirst({
      where: { id: revision.documentId, status: RecordStatus.ACTIVE },
      select: META,
    });
    if (!current) throw new SheetError("Таблица не найдена.");
    const lockedByOther =
      current.lockDiscordId !== null &&
      current.lockDiscordId !== actorDiscordId &&
      current.lockExpiresAt !== null &&
      current.lockExpiresAt > now;
    if (lockedByOther) throw new SheetError("Таблицу сейчас редактирует другой администратор.");

    const version = current.version + 1;
    const snapshot = revision.snapshot as Prisma.InputJsonValue;
    const after = await tx.sheetDocument.update({
      where: { id: current.id },
      data: { snapshot, version, updatedByDiscordId: actorDiscordId },
      select: META,
    });
    await tx.sheetRevision.create({
      data: { documentId: current.id, version, snapshot, reason: "restore", createdByDiscordId: actorDiscordId, createdAt: now },
    });
    return {
      entityId: current.id,
      before: { version: current.version },
      after: { version },
      metadata: { fromVersion: revision.version },
      result: after,
    };
  });
}

/** Ties an uploaded picture to its table: only such files are handed out to visitors. */
export async function attachSheetImage(documentId: string, mediaFileId: string) {
  return prisma.sheetImage.create({ data: { documentId, mediaFileId } });
}

export async function isSheetImage(mediaFileId: string): Promise<boolean> {
  const image = await prisma.sheetImage.findUnique({
    where: { mediaFileId },
    select: { document: { select: { status: true } } },
  });
  return image?.document.status === RecordStatus.ACTIVE;
}
