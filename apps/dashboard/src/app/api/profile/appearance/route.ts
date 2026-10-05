import { appearanceSchema, setAppearance } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireIdentity } from "@/lib/session";

/** The signed-in person picks the colour preset of the dashboard and, if they like, their own accent. */
export async function PUT(request: Request) {
  try {
    const { session } = await requireIdentity();
    const body = appearanceSchema.parse(await request.json());
    const appearance = await setAppearance(session.user.discordId, body, await dashboardAuditContext(session.user.id));
    return Response.json(appearance);
  } catch (error) {
    return jsonError(error);
  }
}
