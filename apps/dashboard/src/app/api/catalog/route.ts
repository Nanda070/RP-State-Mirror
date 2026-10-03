import { createVehicleModel, listVehicleBrands, listVehicleCatalog } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager, requireSession } from "@/lib/session";
import { formText, storeImageField } from "@/lib/uploads";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const [models, brands] = await Promise.all([
      listVehicleCatalog({
        query: searchParams.get("q") ?? undefined,
        brand: searchParams.get("brand") ?? undefined,
      }),
      listVehicleBrands(),
    ]);
    return Response.json({ models, brands });
  } catch (error) {
    return jsonError(error);
  }
}

/** Multipart: `name`, `brand`, `year`, optional `image` file. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const form = await request.formData();
    const context = await dashboardAuditContext(session.user.id);
    const yearRaw = formText(form, "year")?.trim();
    const imageFileId = await storeImageField(form, "image", session.user.id, context);
    const model = await createVehicleModel(
      {
        name: formText(form, "name") ?? "",
        brand: formText(form, "brand") ?? null,
        year: yearRaw ? Number(yearRaw) : null,
        imageFileId: imageFileId ?? null,
      },
      context,
    );
    return Response.json({ model }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
