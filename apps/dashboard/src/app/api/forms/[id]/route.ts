import { updateForm } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { formPayloadSchema, normalizeFormPayload } from "@/lib/form-payload";
import { requireSystemSettings } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireSystemSettings();
    const { id } = await params;
    const payload = normalizeFormPayload(formPayloadSchema.parse(await request.json()));
    const form = await updateForm(id, payload, await dashboardAuditContext(session.user.id));
    return Response.json({ form });
  } catch (error) {
    return jsonError(error);
  }
}
