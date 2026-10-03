import { SHARE_ENTITY_TYPES, createShareLink, revokeShareLink } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

const createSchema = z.object({
  entityType: z.enum(SHARE_ENTITY_TYPES),
  entityId: z.string().min(1).max(64),
});
const revokeSchema = z.object({ id: z.string().min(1) });

/** Creates the record's public link, or returns the one that already exists. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = createSchema.parse(await request.json());
    const link = await createShareLink(
      { ...body, createdByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ link: { id: link.id, token: link.token } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = revokeSchema.parse(await request.json());
    await revokeShareLink(body.id, session.user.discordId, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
