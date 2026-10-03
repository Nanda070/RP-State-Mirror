import { canViewModules, searchRecords } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { requireIdentity } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Records for the command palette (Ctrl+K). What is searched depends on the viewer's rights. */
export async function GET(request: Request) {
  try {
    const { identity } = await requireIdentity();
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 64);
    const hits = await searchRecords(q, { staff: canViewModules(identity) });
    return Response.json({ hits }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
