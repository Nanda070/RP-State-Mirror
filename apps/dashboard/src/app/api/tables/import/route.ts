import {
  MediaValidationError,
  SheetError,
  XLSX_MAX_BYTES,
  attachSheetImage,
  createSheetDocument,
  importXlsx,
  storeUploadedImage,
  type XlsxImportReport,
} from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";
import { formText } from "@/lib/uploads";

/** What did not make it into the table, in words for the admin; null when everything did. */
function leftBehind(report: XlsxImportReport): string | null {
  const parts = [
    report.skippedImages > 0 ? `картинок: ${report.skippedImages}` : null,
    report.skippedConditionalRules > 0 ? `правил условного форматирования: ${report.skippedConditionalRules}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `Не перенесено — ${parts.join(", ")}. Их можно добавить в редакторе.` : null;
}

/**
 * A new table from an `.xlsx` file (for example, one downloaded from Google Sheets). «Админ» and above.
 * Pictures of the file go to storage like the ones inserted in the editor and belong to the new table.
 */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new SheetError("Файл не выбран.");
    // Refuse by the declared size before reading the body into memory.
    if (file.size > XLSX_MAX_BYTES) throw new SheetError("Файл больше 10 МБ.");
    const title = formText(form, "title")?.trim() || file.name.replace(/\.xlsx$/i, "").trim() || "Таблица";
    const context = await dashboardAuditContext(session.user.id);
    const imageIds: string[] = [];
    const { snapshot, report } = await importXlsx(new Uint8Array(await file.arrayBuffer()), title, {
      storeImage: async (bytes, name) => {
        try {
          const media = await storeUploadedImage(bytes, { originalName: name, createdById: session.user.id }, context);
          imageIds.push(media.id);
          return `/api/tables/media/${media.id}`;
        } catch (error) {
          // A picture of a kind the site does not serve (EMF, TIFF…) is left out, the table still loads.
          if (error instanceof MediaValidationError) return null;
          throw error;
        }
      },
    });
    const document = await createSheetDocument({ title: title.slice(0, 80), snapshot }, session.user.discordId, context);
    for (const id of imageIds) await attachSheetImage(document.id, id);
    return Response.json({ id: document.id, slug: document.slug, leftBehind: leftBehind(report) });
  } catch (error) {
    return jsonError(error);
  }
}
