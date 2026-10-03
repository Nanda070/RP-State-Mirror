import {
  archiveFaqItem,
  archiveFaqSection,
  canViewModules,
  createFaqItem,
  createFaqSection,
  listFaq,
  reorderFaqItems,
  reorderFaqSections,
  updateFaqItem,
  updateFaqSection,
} from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { ForbiddenError, requireIdentity, requireSession } from "@/lib/session";

const id = z.string().min(1);
const ids = z.array(id).max(500);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-section"), title: z.string() }),
  z.object({ action: z.literal("update-section"), id, title: z.string() }),
  z.object({ action: z.literal("archive-section"), id }),
  z.object({ action: z.literal("reorder-sections"), ids }),
  z.object({ action: z.literal("create-item"), sectionId: id, title: z.string(), body: z.string() }),
  z.object({
    action: z.literal("update-item"),
    id,
    sectionId: id.optional(),
    title: z.string().optional(),
    body: z.string().optional(),
  }),
  z.object({ action: z.literal("archive-item"), id }),
  z.object({ action: z.literal("reorder-items"), sectionId: id, ids }),
]);

export async function GET() {
  try {
    await requireSession();
    return Response.json({ sections: await listFaq() });
  } catch (error) {
    return jsonError(error);
  }
}

/** Editing is open to «Хелпер» and above (PLAN §3). */
export async function POST(request: Request) {
  try {
    const { session, identity } = await requireIdentity();
    if (!canViewModules(identity)) throw new ForbiddenError("Редактировать FAQ может хелпер и выше");
    const body = actionSchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    const actor = session.user.discordId;

    switch (body.action) {
      case "create-section":
        await createFaqSection({ title: body.title }, context);
        break;
      case "update-section":
        await updateFaqSection(body.id, { title: body.title }, context);
        break;
      case "archive-section":
        await archiveFaqSection(body.id, context);
        break;
      case "reorder-sections":
        await reorderFaqSections(body.ids, context);
        break;
      case "create-item":
        await createFaqItem({ sectionId: body.sectionId, title: body.title, body: body.body }, actor, context);
        break;
      case "update-item":
        await updateFaqItem(
          body.id,
          {
            ...(body.sectionId !== undefined ? { sectionId: body.sectionId } : {}),
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.body !== undefined ? { body: body.body } : {}),
          },
          actor,
          context,
        );
        break;
      case "archive-item":
        await archiveFaqItem(body.id, context);
        break;
      case "reorder-items":
        await reorderFaqItems(body.sectionId, body.ids, context);
        break;
    }
    return Response.json({ sections: await listFaq() });
  } catch (error) {
    return jsonError(error);
  }
}
