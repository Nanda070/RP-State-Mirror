import { listTransferRankRules, replaceTransferPairRules, replaceTransferPairRulesSchema } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSession, requireSystemSettings } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const rules = await listTransferRankRules({
      fromFactionCode: searchParams.get("from") ?? undefined,
      toFactionCode: searchParams.get("to") ?? undefined,
    });
    return Response.json({ rules });
  } catch (error) {
    return jsonError(error);
  }
}

/** Replaces the whole rule table of one faction pair (главный админ). */
export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = replaceTransferPairRulesSchema.parse(await request.json());
    const rules = await replaceTransferPairRules(body, await dashboardAuditContext(session.user.id));
    return Response.json({ rules });
  } catch (error) {
    return jsonError(error);
  }
}
