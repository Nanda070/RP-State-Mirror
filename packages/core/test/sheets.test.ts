import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  SHEET_LOCK_TTL_MS,
  SHEET_REVISION_INTERVAL_MS,
  SheetError,
  acquireSheetLock,
  archiveSheetDocument,
  assertSheetSnapshot,
  attachSheetImage,
  blankSheetSnapshot,
  createSheetDocument,
  getSheetSnapshot,
  isSheetImage,
  listSheetDocuments,
  listSheetRevisions,
  releaseSheetLock,
  reorderSheetDocuments,
  restoreSheetRevision,
  saveSheetSnapshot,
  sheetSlugFromTitle,
  updateSheetDocumentMeta,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "sheets.test" } as const;
const ADMIN = "910000000000000001";
const OTHER = "910000000000000002";

function workbook(value: string) {
  return { name: "t", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Лист1", cellData: { 0: { 0: { v: value } } } } } };
}

describe("sheet documents", () => {
  it("makes an address from the title and keeps it unique among active tables", async () => {
    expect(sheetSlugFromTitle("Реестр организаций")).toBe("reestr-organizaciy");
    expect(sheetSlugFromTitle("!!!")).toBe("table");

    const first = await createSheetDocument({ title: "Реестр организаций" }, ADMIN, context);
    const second = await createSheetDocument({ title: "Реестр организаций" }, ADMIN, context);
    expect(first.slug).toBe("reestr-organizaciy");
    expect(second.slug).toBe("reestr-organizaciy-2");
    await expect(updateSheetDocumentMeta(second.id, { slug: first.slug }, context)).rejects.toThrow(/уже занят/);

    // An archived table frees its address and leaves the list; nothing is deleted.
    await archiveSheetDocument(first.id, context);
    expect((await listSheetDocuments()).map((row) => row.id)).toEqual([second.id]);
    expect(await getSheetSnapshot(first.id)).toBeNull();
    expect(await prisma.sheetDocument.count()).toBe(2);
    const renamed = await updateSheetDocumentMeta(second.id, { title: "Организации", slug: "reestr-organizaciy" }, context);
    expect(renamed).toMatchObject({ title: "Организации", slug: "reestr-organizaciy" });
  });

  it("orders the tabs", async () => {
    const a = await createSheetDocument({ title: "Первая" }, ADMIN, context);
    const b = await createSheetDocument({ title: "Вторая" }, ADMIN, context);
    const c = await createSheetDocument({ title: "Третья" }, ADMIN, context);
    await reorderSheetDocuments([c.id, "unknown", a.id, b.id], context);
    expect((await listSheetDocuments()).map((row) => row.title)).toEqual(["Третья", "Первая", "Вторая"]);
  });

  it("rejects a workbook that is broken, empty or too large", () => {
    expect(() => assertSheetSnapshot(null)).toThrow(SheetError);
    expect(() => assertSheetSnapshot({ sheets: {} })).toThrow(/хотя бы один лист/);
    expect(() => assertSheetSnapshot(workbook("x".repeat(6 * 1024 * 1024)))).toThrow(/5 МБ/);
    expect(assertSheetSnapshot(blankSheetSnapshot("Новая"))).toBeGreaterThan(0);
  });
});

describe("editing a sheet", () => {
  it("lets one person edit at a time and hands the lock over when the lease runs out", async () => {
    const document = await createSheetDocument({ title: "Реестр" }, ADMIN, context);
    const start = new Date("2026-10-04T10:00:00Z");

    expect(await acquireSheetLock(document.id, ADMIN, start)).toMatchObject({ ok: true, holderDiscordId: ADMIN });
    expect(await acquireSheetLock(document.id, OTHER, start)).toMatchObject({ ok: false, holderDiscordId: ADMIN });
    await expect(
      saveSheetSnapshot(document.id, { snapshot: workbook("чужое"), baseVersion: 1 }, OTHER, context, start),
    ).rejects.toThrow(/редактирует другой/);

    // The holder left without «Готово»: after the lease the next person takes over.
    const later = new Date(start.getTime() + SHEET_LOCK_TTL_MS + 1000);
    expect(await acquireSheetLock(document.id, OTHER, later)).toMatchObject({ ok: true, holderDiscordId: OTHER });
    await releaseSheetLock(document.id, OTHER);
    expect(await acquireSheetLock(document.id, ADMIN, later)).toMatchObject({ ok: true });
  });

  it("refuses a save made from an older version", async () => {
    const document = await createSheetDocument({ title: "Реестр" }, ADMIN, context);
    const saved = await saveSheetSnapshot(document.id, { snapshot: workbook("первое"), baseVersion: 1 }, ADMIN, context);
    expect(saved.version).toBe(2);
    await expect(
      saveSheetSnapshot(document.id, { snapshot: workbook("из старой вкладки"), baseVersion: 1 }, ADMIN, context),
    ).rejects.toThrow(/в другом окне/);
    expect((await getSheetSnapshot(document.id))?.snapshot).toEqual(workbook("первое"));
  });

  it("keeps history: a revision per ten minutes of editing and one when editing ends", async () => {
    const document = await createSheetDocument({ title: "Реестр" }, ADMIN, context);
    const start = new Date(Date.now() + 60_000);
    const at = (ms: number) => new Date(start.getTime() + ms);

    // Autosaves inside the interval do not multiply revisions.
    const first = await saveSheetSnapshot(document.id, { snapshot: workbook("1"), baseVersion: 1 }, ADMIN, context, at(1000));
    const second = await saveSheetSnapshot(document.id, { snapshot: workbook("2"), baseVersion: 2 }, ADMIN, context, at(2000));
    expect([first.revision, second.revision]).toEqual([false, false]);

    const due = await saveSheetSnapshot(
      document.id,
      { snapshot: workbook("3"), baseVersion: 3 },
      ADMIN,
      context,
      at(SHEET_REVISION_INTERVAL_MS + 61_000),
    );
    expect(due.revision).toBe(true);
    const done = await saveSheetSnapshot(
      document.id,
      { snapshot: workbook("4"), baseVersion: 4, checkpoint: true },
      ADMIN,
      context,
      at(SHEET_REVISION_INTERVAL_MS + 62_000),
    );
    expect(done.revision).toBe(true);

    const revisions = await listSheetRevisions(document.id);
    expect(revisions.map((row) => [row.version, row.reason])).toEqual([
      [5, "edit"],
      [4, "edit"],
      [1, "create"],
    ]);
    // The journal records sessions without the workbook itself.
    const events = await prisma.auditLog.findMany({ where: { action: "sheet_document.saved" } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.after === null)).toBe(true);

    // Going back makes a new version; the state before the return stays in history.
    const target = revisions.find((row) => row.version === 4);
    const restored = await restoreSheetRevision(target?.id ?? "", ADMIN, context, at(SHEET_REVISION_INTERVAL_MS + 63_000));
    expect(restored.version).toBe(6);
    expect((await getSheetSnapshot(document.id))?.snapshot).toEqual(workbook("3"));
    expect((await listSheetRevisions(document.id)).map((row) => row.reason)).toEqual(["restore", "edit", "edit", "create"]);
  });

  it("hands out pictures only while their table is active", async () => {
    const document = await createSheetDocument({ title: "Реестр" }, ADMIN, context);
    const file = await prisma.mediaFile.create({
      data: { objectKey: "media/test/pic.png", originalName: "pic.png", contentType: "image/png", sizeBytes: 10 },
    });
    expect(await isSheetImage(file.id)).toBe(false);
    await attachSheetImage(document.id, file.id);
    expect(await isSheetImage(file.id)).toBe(true);
    await archiveSheetDocument(document.id, context);
    expect(await isSheetImage(file.id)).toBe(false);
    expect((await prisma.sheetDocument.findUniqueOrThrow({ where: { id: document.id } })).status).toBe(RecordStatus.ARCHIVED);
  });
});
