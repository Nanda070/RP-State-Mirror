import { banFormIp, listFormIpBans, unbanFormIp } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const banSchema = z.object({ ipAddress: z.string(), reason: z.string() });
const unbanSchema = z.object({ id: z.string().min(1) });

export async function GET() {
  try {
    await requireSystemSettings();
    return Response.json({ bans: await listFormIpBans() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = banSchema.parse(await request.json());
    const ban = await banFormIp(
      { ...body, createdByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ ban }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = unbanSchema.parse(await request.json());
    await unbanFormIp(body.id, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
