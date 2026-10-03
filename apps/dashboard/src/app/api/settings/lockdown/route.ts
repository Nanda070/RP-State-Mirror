import { getLockdown, setLockdown } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const bodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(300).nullish(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    return Response.json({ lockdown: await getLockdown() });
  } catch (error) {
    return jsonError(error);
  }
}

/** Emergency switch: closes the bot's commands and the dashboard for everyone except super admins. */
export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = bodySchema.parse(await request.json());
    const lockdown = await setLockdown(
      { enabled: body.enabled, reason: body.reason ?? null, actorDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ lockdown });
  } catch (error) {
    return jsonError(error);
  }
}
