import { setMutedDmKinds } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireIdentity } from "@/lib/session";

const bodySchema = z.object({ muted: z.array(z.string().max(40)).max(40) });

/** The signed-in person chooses which direct messages the bot may send them. */
export async function PUT(request: Request) {
  try {
    const { session } = await requireIdentity();
    const body = bodySchema.parse(await request.json());
    const muted = await setMutedDmKinds(session.user.discordId, body.muted, await dashboardAuditContext(session.user.id));
    return Response.json({ muted });
  } catch (error) {
    return jsonError(error);
  }
}
