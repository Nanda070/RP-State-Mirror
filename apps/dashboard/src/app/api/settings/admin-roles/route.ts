import { AdminLevel } from "@mirror/db";
import { getAdminRoleOperation, requestAdminRolesApply, setSetting } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const snowflake = z.string().regex(/^\d{17,20}$/);
const roleIds = z.array(snowflake).max(10);

const putSchema = z.object({
  sets: z.record(
    snowflake,
    z.object({ SUPER_ADMIN: roleIds, SENIOR_ADMIN: roleIds, ADMIN: roleIds, HELPER: roleIds }),
  ),
});

const postSchema = z.object({
  targetDiscordId: z.string(),
  level: z.nativeEnum(AdminLevel).nullable(),
});

/** Operation status and per-guild report (the page polls it while the bot works). */
export async function GET(request: Request) {
  try {
    await requireSystemSettings();
    const id = new URL(request.url).searchParams.get("operation");
    const operation = id ? await getAdminRoleOperation(id) : null;
    if (!operation) return Response.json({ error: "Операция не найдена" }, { status: 404 });
    return Response.json({ operation });
  } catch (error) {
    return jsonError(error);
  }
}

/** Saves which Discord roles belong to each admin level on each guild. */
export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = putSchema.parse(await request.json());
    const sets = await setSetting("adminRoles.byGuild", body.sets, await dashboardAuditContext(session.user.id));
    return Response.json({ sets });
  } catch (error) {
    return jsonError(error);
  }
}

/** Grants a level (or removes every admin role when `level` is null) on all guilds. */
export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = postSchema.parse(await request.json());
    const operation = await requestAdminRolesApply(
      { ...body, requestedByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ operation }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
