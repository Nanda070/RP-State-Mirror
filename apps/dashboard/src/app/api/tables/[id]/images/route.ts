import { MediaValidationError, attachSheetImage, getSheetSnapshot } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";
import { storeImageField } from "@/lib/uploads";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A picture inserted into a table: the file goes to storage, the workbook keeps only its address.
 * «Админ» and above.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    if (!(await getSheetSnapshot(id))) return Response.json({ error: "Таблица не найдена" }, { status: 404 });
    const fileId = await storeImageField(
      await request.formData(),
      "file",
      session.user.id,
      await dashboardAuditContext(session.user.id),
    );
    if (!fileId) throw new MediaValidationError("Файл не выбран.");
    await attachSheetImage(id, fileId);
    return Response.json({ id: fileId, url: `/api/tables/media/${fileId}` });
  } catch (error) {
    return jsonError(error);
  }
}
