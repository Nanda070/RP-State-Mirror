import { decideAccountRecovery } from "@mirror/core";
import { DecisionStatus } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const decideSchema = z.object({
  decision: z.enum([DecisionStatus.APPROVED, DecisionStatus.REJECTED]),
  reason: z.string().trim().max(1000).nullish(),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { session } = await requireModuleManager();
    const { id } = await params;
    const body = decideSchema.parse(await request.json());
    const updated = await decideAccountRecovery(
      id,
      body.decision,
      session.user.discordId,
      body.reason ?? null,
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ request: updated });
  } catch (error) {
    return jsonError(error);
  }
}
