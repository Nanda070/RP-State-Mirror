import { acquireSheetLock, releaseSheetLock } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { requireModuleManager } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ action: z.enum(["acquire", "release"]) });

/** «Редактировать» takes the lock (and extends it while the editor is open), «Готово» gives it back. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const me = session.user.discordId;
    if (body.action === "release") {
      await releaseSheetLock(id, me);
      return Response.json({ ok: true });
    }
    const lock = await acquireSheetLock(id, me);
    if (lock.ok) return Response.json({ ok: true, version: lock.version });
    const holder = lock.holderDiscordId ?? "";
    const label = (await resolveAuthorLabels([holder])).get(holder) ?? "другой администратор";
    return Response.json({ ok: false, holder: label });
  } catch (error) {
    return jsonError(error);
  }
}
