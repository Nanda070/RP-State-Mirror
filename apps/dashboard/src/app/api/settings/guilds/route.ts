import { getSetting, setSetting, snowflakeSchema } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const bodySchema = z.object({
  mainGuildId: snowflakeSchema.nullable(),
  incidentGuildId: snowflakeSchema.nullable(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const [guilds, mainGuildId, incidentGuildId] = await Promise.all([
      prisma.guild.findMany({
        where: { status: RecordStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { discordId: true, name: true, iconUrl: true, lastSyncedAt: true },
      }),
      getSetting("core.mainGuildId"),
      getSetting("core.incidentGuildId"),
    ]);

    return Response.json({ guilds, mainGuildId, incidentGuildId });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = bodySchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);

    await setSetting("core.mainGuildId", body.mainGuildId, ctx);
    await setSetting("core.incidentGuildId", body.incidentGuildId, ctx);

    return Response.json({
      mainGuildId: body.mainGuildId,
      incidentGuildId: body.incidentGuildId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
