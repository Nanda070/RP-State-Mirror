import { createDiscordForm, listForms } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { formPayloadSchema, normalizeFormPayload } from "@/lib/form-payload";
import { requireSystemSettings } from "@/lib/session";

export async function GET() {
  try {
    await requireSystemSettings();
    return Response.json({ forms: await listForms() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const payload = normalizeFormPayload(formPayloadSchema.parse(await request.json()));
    const form = await createDiscordForm(
      { ...payload, createdByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ form }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
