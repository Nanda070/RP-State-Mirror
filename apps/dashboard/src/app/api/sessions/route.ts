import { canManageSystemSettings, revokeAllUserSessions, revokeUserSession } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireIdentity } from "@/lib/session";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), id: z.string().min(1) }),
  /** Ends every other session of the signed-in user. */
  z.object({ action: z.literal("revoke-others") }),
]);

/** A user ends their own sessions; ending someone else's is for the super admin. */
export async function POST(request: Request) {
  try {
    const { session, identity } = await requireIdentity();
    const body = bodySchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    if (body.action === "revoke") {
      await revokeUserSession(
        body.id,
        { userId: session.user.id, discordId: session.user.discordId, allowForeign: canManageSystemSettings(identity) },
        context,
      );
      return Response.json({ ok: true, current: body.id === session.sid });
    }
    const revoked = await revokeAllUserSessions(
      { userId: session.user.id, exceptSessionId: session.sid ?? null },
      session.user.discordId,
      context,
    );
    return Response.json({ ok: true, revoked });
  } catch (error) {
    return jsonError(error);
  }
}
