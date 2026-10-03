import { archiveVehicleModel, updateVehicleModel } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";
import { formText, storeImageField } from "@/lib/uploads";

type RouteContext = { params: Promise<{ id: string }> };

/** Multipart: `name`, `brand`, `year`, optional `image` file, `removeImage=1` to clear the photo. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    const form = await request.formData();
    const context = await dashboardAuditContext(session.user.id);
    // An absent field keeps the stored value; an empty one clears it.
    const yearRaw = formText(form, "year")?.trim();
    const uploaded = await storeImageField(form, "image", session.user.id, context);
    const model = await updateVehicleModel(
      id,
      {
        name: formText(form, "name"),
        brand: formText(form, "brand"),
        ...(yearRaw === undefined ? {} : { year: yearRaw ? Number(yearRaw) : null }),
        ...(uploaded ? { imageFileId: uploaded } : formText(form, "removeImage") === "1" ? { imageFileId: null } : {}),
      },
      context,
    );
    return Response.json({ model });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    await archiveVehicleModel(id, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
