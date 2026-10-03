import {
  SYSTEM_REGISTRY_ENTITIES,
  canManageSystemSettings,
  createIcBlacklistEntry,
  enqueueIcBlacklistPublish,
  registryActionSchema,
  runRegistryAction,
} from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { ForbiddenError, requireModuleManager } from "@/lib/session";

const actionSchema = registryActionSchema.omit({ actorDiscordId: true });

const blacklistSchema = z.object({
  fullName: z.string().trim().min(1).max(128),
  staticId: z.string().trim().min(1).max(32),
  reason: z.string().trim().min(1).max(2000),
  forumLink: z.string().trim().url("Ссылка на форум должна быть адресом"),
  /** ISO date or empty for a permanent record. */
  expiresAt: z.string().trim().optional(),
});

/** One action on a registry record: «Админ» and above; the job queue — the super admin. */
export async function POST(request: Request) {
  try {
    const { session, identity } = await requireModuleManager();
    const body = actionSchema.parse(await request.json());
    if (SYSTEM_REGISTRY_ENTITIES.includes(body.entity) && !canManageSystemSettings(identity)) {
      throw new ForbiddenError("Очередью задач управляет главный администратор");
    }
    const message = await runRegistryAction(
      { ...body, actorDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ ok: true, message });
  } catch (error) {
    return jsonError(error);
  }
}

/** New IC blacklist record from the dashboard (the same as `/чс-гос`, with an optional end date). */
export async function PUT(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = blacklistSchema.parse(await request.json());
    const entry = await createIcBlacklistEntry(
      {
        fullName: body.fullName,
        staticId: body.staticId,
        reason: body.reason,
        forumLink: body.forumLink,
        createdByDiscordId: session.user.discordId,
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      },
      await dashboardAuditContext(session.user.id),
    );
    await enqueueIcBlacklistPublish(entry.id);
    return Response.json({ ok: true, message: `Запись ЧС ${entry.number} создана.` }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
