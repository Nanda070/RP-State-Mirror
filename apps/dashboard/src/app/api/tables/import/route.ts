import { SheetError, XLSX_MAX_BYTES, createSheetDocument, xlsxToSheetSnapshot } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";
import { formText } from "@/lib/uploads";

/** A new table from an `.xlsx` file (for example, one downloaded from Google Sheets). «Админ» and above. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new SheetError("Файл не выбран.");
    // Refuse by the declared size before reading the body into memory.
    if (file.size > XLSX_MAX_BYTES) throw new SheetError("Файл больше 10 МБ.");
    const title = formText(form, "title")?.trim() || file.name.replace(/\.xlsx$/i, "").trim() || "Таблица";
    const snapshot = await xlsxToSheetSnapshot(new Uint8Array(await file.arrayBuffer()), title);
    const document = await createSheetDocument(
      { title: title.slice(0, 80), snapshot },
      session.user.discordId,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ id: document.id, slug: document.slug });
  } catch (error) {
    return jsonError(error);
  }
}
