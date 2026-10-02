import {
  archiveRoleMapping,
  archiveRoleMappingsForTarget,
  canMapSuperAdminLevel,
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
    const { session, identity } = await requireSystemSettings();
    const body = roleMappingInputSchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);
    const mapping = await upsertRoleMapping(body, ctx, {
      allowSuperAdminLevel: canMapSuperAdminLevel(identity),
    });
    return Response.json({ mapping });
  } catch (error) {
    return jsonError(error);
  }
}

const archiveSchema = z.object({ id: z.string().min(1) });
const archiveTargetSchema = z.object({
  kind: z.nativeEnum(RoleMappingKind),
  value: z.string().min(1).max(128),
  factionCode: z.string().min(1).max(32).nullable(),
});

export async function DELETE(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const ctx = await dashboardAuditContext(session.user.id);
    const url = new URL(request.url);
    const idFromQuery = url.searchParams.get("id");

    if (idFromQuery) {
      const mapping = await archiveRoleMapping(idFromQuery, ctx);
      return Response.json({ mapping });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const asId = archiveSchema.safeParse(body);
    if (asId.success) {
      const mapping = await archiveRoleMapping(asId.data.id, ctx);
      return Response.json({ mapping });
    }

    const asTarget = archiveTargetSchema.safeParse(body);
    if (asTarget.success) {
      const result = await archiveRoleMappingsForTarget(asTarget.data, ctx);
      return Response.json(result);
    }

    return Response.json({ error: "Укажите id привязки или цель (kind/value/factionCode)" }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
