import { createSheetDocument } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

const bodySchema = z.object({ title: z.string() });

/** A new empty table: «Админ» and above. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = bodySchema.parse(await request.json());
    const document = await createSheetDocument(
      { title: body.title },
      session.user.discordId,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ id: document.id, slug: document.slug });
  } catch (error) {
    return jsonError(error);
  }
}
