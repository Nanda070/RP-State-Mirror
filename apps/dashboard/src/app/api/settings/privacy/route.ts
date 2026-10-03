import { anonymizeUser } from "@mirror/core";
import { z } from "zod";
import { getDashboardEnv } from "@/env";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const bodySchema = z.object({ discordId: z.string() });

/** Data-erasure request: irreversible, super admin only. */
export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const { discordId } = bodySchema.parse(await request.json());
    const result = await anonymizeUser(
      { discordId, requestedByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
      { superAdminUserIds: getDashboardEnv().SUPER_ADMIN_USER_IDS },
    );
    return Response.json({
      pseudonym: result.pseudonym,
      rows: Object.values(result.tables).reduce((sum, value) => sum + value, 0),
      filesErased: result.filesErased,
    });
  } catch (error) {
    return jsonError(error);
  }
}
