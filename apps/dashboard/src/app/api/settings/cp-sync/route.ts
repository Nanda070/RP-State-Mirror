import { enqueueCpReconcile, writeAuditEvent } from "@mirror/core";
import { prisma } from "@mirror/db";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

/** State and report of a reconcile started from the dashboard (the page polls it). */
export async function GET(request: Request) {
  try {
    await requireSystemSettings();
    const id = new URL(request.url).searchParams.get("job");
    const job = id
      ? await prisma.job.findUnique({ where: { id }, select: { id: true, status: true, result: true, lastError: true } })
      : null;
    if (!job) return Response.json({ error: "Задача не найдена" }, { status: 404 });
    return Response.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}

/** Starts a full ЧП reconcile now instead of waiting for the hourly one. */
export async function POST() {
  try {
    const { session } = await requireSystemSettings();
    const job = await enqueueCpReconcile(session.user.discordId);
    await writeAuditEvent({
      ...(await dashboardAuditContext(session.user.id)),
      action: "cp.reconcile_requested",
      entityType: "job",
      entityId: job.id,
    });
    return Response.json({ job: { id: job.id, status: job.status } }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
