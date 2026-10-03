import { listSheetRevisions, restoreSheetRevision } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireModuleManager } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const REASON_RU: Record<string, string> = {
  create: "Создание",
  import: "Импорт файла",
  edit: "Правка",
  restore: "Возврат к версии",
};

/** History of a table: who saved it and when. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await requireModuleManager();
    const { id } = await params;
    const revisions = await listSheetRevisions(id);
    const labels = await resolveAuthorLabels(revisions.map((row) => row.createdByDiscordId));
    return Response.json({
      revisions: revisions.map((row) => ({
        id: row.id,
        version: row.version,
        reason: REASON_RU[row.reason] ?? row.reason,
        author: labels.get(row.createdByDiscordId) ?? row.createdByDiscordId,
        at: formatMoscowShort(row.createdAt),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const bodySchema = z.object({ revisionId: z.string().min(1) });

/** Puts an earlier version back; the current state stays in history. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    await params;
    const body = bodySchema.parse(await request.json());
    const document = await restoreSheetRevision(
      body.revisionId,
      session.user.discordId,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ ok: true, version: document.version });
  } catch (error) {
    return jsonError(error);
  }
}
