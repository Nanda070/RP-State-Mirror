import { reorderSheetDocuments } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

const bodySchema = z.object({ ids: z.array(z.string().min(1)).max(100) });

/** New order of the tabs. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = bodySchema.parse(await request.json());
    await reorderSheetDocuments(body.ids, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
