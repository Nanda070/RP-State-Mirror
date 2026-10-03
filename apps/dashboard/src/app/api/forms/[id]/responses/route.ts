import { formSubmissionsCsv, getFormForEdit } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { requireSystemSettings } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

/** CSV export of all answers (the page itself renders the table). */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await requireSystemSettings();
    const { id } = await params;
    const form = await getFormForEdit(id);
    if (!form) return Response.json({ error: "Форма не найдена" }, { status: 404 });
    const csv = await formSubmissionsCsv(id);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // RFC 5987: the form name may contain Cyrillic.
        "Content-Disposition": `attachment; filename="form-${id}.csv"; filename*=UTF-8''${encodeURIComponent(`${form.name}.csv`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
