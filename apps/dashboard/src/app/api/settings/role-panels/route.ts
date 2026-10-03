import {
  archiveRolePanel,
  createRolePanelFromInput,
  listRolePanels,
  republishRolePanel,
  rolePanelInputSchema,
} from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), id: z.string().min(1) }),
  z.object({ action: z.literal("republish"), id: z.string().min(1) }),
]);

export async function GET() {
  try {
    await requireSystemSettings();
    return Response.json({ panels: await listRolePanels() });
  } catch (error) {
    return jsonError(error);
  }
}

/** Creates a panel; the bot publishes it through the job queue. */
export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const input = rolePanelInputSchema.parse(await request.json());
    const panel = await createRolePanelFromInput(
      input,
      session.user.discordId,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ panel: { id: panel.id } }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = actionSchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    if (body.action === "archive") await archiveRolePanel(body.id, context);
    else await republishRolePanel(body.id, context);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
