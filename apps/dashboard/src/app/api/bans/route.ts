import { TECH_BAN_KINDS, createTechBan, listTechBans, revokeTechBan } from "@mirror/core";
import { z } from "zod";
import { getDashboardEnv } from "@/env";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

const createSchema = z.object({
  kind: z.enum(TECH_BAN_KINDS),
  value: z.string(),
  reason: z.string(),
});
const revokeSchema = z.object({ id: z.string().min(1) });

export async function GET() {
  try {
    await requireModuleManager();
    return Response.json({ bans: await listTechBans() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = createSchema.parse(await request.json());
    const ban = await createTechBan(
      { ...body, createdByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
      { superAdminUserIds: getDashboardEnv().SUPER_ADMIN_USER_IDS },
    );
    return Response.json({ ban }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = revokeSchema.parse(await request.json());
    await revokeTechBan(body.id, session.user.discordId, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
