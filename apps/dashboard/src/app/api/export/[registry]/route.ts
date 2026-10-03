import {
  EXPORT_REGISTRIES,
  EXPORT_TITLES,
  canViewModules,
  exportRegistryCsv,
  writeAuditEvent,
  type ExportRegistry,
} from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { ForbiddenError, requireIdentity } from "@/lib/session";

type RouteContext = { params: Promise<{ registry: string }> };

/** Whole registry as CSV. Staff only; every export is written to the audit log. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { session, identity } = await requireIdentity();
    if (!canViewModules(identity)) throw new ForbiddenError("Экспорт доступен сотрудникам администрации");
    const { registry } = await params;
    if (!(EXPORT_REGISTRIES as readonly string[]).includes(registry)) {
      return Response.json({ error: "Неизвестный реестр" }, { status: 404 });
    }
    const csv = await exportRegistryCsv(registry as ExportRegistry);
    await writeAuditEvent({
      ...(await dashboardAuditContext(session.user.id)),
      action: "registry.exported",
      entityType: "registry",
      entityId: registry,
    });
    const title = EXPORT_TITLES[registry as ExportRegistry];
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${registry}-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`${title} ${stamp}.csv`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
