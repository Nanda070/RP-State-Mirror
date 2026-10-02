import {
  archiveRoleMapping,
  listActiveRoleMappings,
  roleMappingInputSchema,
  upsertRoleMapping,
} from "@mirror/core";
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireSystemSettings();
    const guildDiscordId = new URL(request.url).searchParams.get("guildDiscordId") ?? undefined;
    const [mappings, guilds, factions, roles] = await Promise.all([
      listActiveRoleMappings(guildDiscordId),
      prisma.guild.findMany({
        where: { status: RecordStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { discordId: true, name: true },
      }),
      prisma.faction.findMany({
        where: { status: RecordStatus.ACTIVE },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { code: true, name: true, color: true },
      }),
      prisma.discordRole.findMany({
        where: {
          status: RecordStatus.ACTIVE,
          guild: {
            status: RecordStatus.ACTIVE,
            ...(guildDiscordId ? { discordId: guildDiscordId } : {}),
          },
        },
        orderBy: [{ position: "desc" }, { name: "asc" }],
        select: {
          discordId: true,
          name: true,
          color: true,
          guild: { select: { discordId: true, name: true } },
        },
      }),
    ]);

    return Response.json({
      mappings,
      guilds,
      factions,
      roles,
      kinds: Object.values(RoleMappingKind),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = roleMappingInputSchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);
    const mapping = await upsertRoleMapping(body, ctx);
    return Response.json({ mapping });
  } catch (error) {
    return jsonError(error);
  }
}

const archiveSchema = z.object({ id: z.string().min(1) });

export async function DELETE(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = archiveSchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);
    const mapping = await archiveRoleMapping(body.id, ctx);
    return Response.json({ mapping });
  } catch (error) {
    return jsonError(error);
  }
}
