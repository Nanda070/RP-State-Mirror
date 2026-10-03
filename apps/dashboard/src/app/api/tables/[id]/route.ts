import { archiveSheetDocument, updateSheetDocumentMeta } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), title: z.string(), slug: z.string().optional() }),
  z.object({ action: z.literal("archive") }),
]);

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    if (body.action === "archive") {
      await archiveSheetDocument(id, context);
      return Response.json({ ok: true });
    }
    const document = await updateSheetDocumentMeta(
      id,
      { title: body.title, ...(body.slug ? { slug: body.slug } : {}) },
      context,
    );
    return Response.json({ ok: true, slug: document.slug, title: document.title });
  } catch (error) {
    return jsonError(error);
  }
}
