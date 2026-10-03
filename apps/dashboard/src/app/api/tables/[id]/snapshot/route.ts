import { LOCKDOWN_MESSAGE, canViewSheet, getSheetSnapshot, saveSheetSnapshot } from "@mirror/core";
import { z } from "zod";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { isLockedOut, publicLockedOut, requireModuleManager } from "@/lib/session";
import { tableViewer } from "@/lib/tables";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The workbook, for whoever may open the table. A public table asked with `?v=<version>` equal to
 * the current one never changes and may be cached for good; a restricted one is never cached.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (session?.user ? await isLockedOut(session.identity) : await publicLockedOut()) {
      return Response.json({ error: LOCKDOWN_MESSAGE }, { status: 503 });
    }
    const { id } = await params;
    const document = await getSheetSnapshot(id);
    // No access looks the same as no table: the address must not confirm that a closed table exists.
    if (!document || !canViewSheet(document, await tableViewer())) {
      return Response.json({ error: "Таблица не найдена" }, { status: 404 });
    }
    const asked = new URL(request.url).searchParams.get("v");
    return Response.json(
      { version: document.version, snapshot: document.snapshot },
      {
        headers: {
          "Cache-Control":
            document.access === "PUBLIC" && asked === String(document.version)
              ? "public, max-age=31536000, immutable"
              : "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}

const bodySchema = z.object({
  snapshot: z.record(z.unknown()),
  baseVersion: z.number().int().positive(),
  checkpoint: z.boolean().optional(),
});

/** Autosave and «Готово»: «Админ» and above, holding the edit lock. */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const saved = await saveSheetSnapshot(
      id,
      { snapshot: body.snapshot, baseVersion: body.baseVersion, checkpoint: body.checkpoint ?? false },
      session.user.discordId,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ version: saved.version });
  } catch (error) {
    return jsonError(error);
  }
}
