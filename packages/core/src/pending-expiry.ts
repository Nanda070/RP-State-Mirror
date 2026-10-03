/**
 * Applications nobody reviewed do not stay open forever: an unreviewed registration blocks its
 * static, an unreviewed transfer blocks the character. After the configured number of days they
 * are closed automatically, the review message loses its buttons and the applicant is told.
 */
import { AuditActorType, DecisionStatus, RecordStatus, TransferStatus, prisma } from "@mirror/db";
import { auditedMutation } from "./audit.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { getSetting } from "./settings.js";

const DAY_MS = 86_400_000;

function unreviewedReason(days: number): string {
  return `Заявка не рассмотрена за ${days} дн. и закрыта автоматически. При необходимости подайте её заново.`;
}

/** Closes PENDING registrations older than `registrations.pendingTtlDays`. Returns how many. */
export async function expirePendingRegistrations(now: Date = new Date(), batch = 100): Promise<number> {
  const days = await getSetting("registrations.pendingTtlDays");
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const due = await prisma.registration.findMany({
    where: { status: RecordStatus.ACTIVE, decision: DecisionStatus.PENDING, createdAt: { lte: cutoff } },
    select: { id: true },
    take: batch,
  });
  let closed = 0;
  for (const { id } of due) {
    const done = await auditedMutation(
      { actorType: AuditActorType.SYSTEM, source: "registrations.pending_expiry" },
      "registration.pending_expired",
      "registration",
      async (tx) => {
        // The guard repeats the selection: a reviewer may have decided in the meantime.
        const { count } = await tx.registration.updateMany({
          where: { id, status: RecordStatus.ACTIVE, decision: DecisionStatus.PENDING },
          data: {
            decision: DecisionStatus.REJECTED,
            status: RecordStatus.CLOSED,
            decidedAt: now,
            rejectionReason: unreviewedReason(days),
          },
        });
        if (count === 1) {
          await enqueueJob({ type: MODULE_JOB_TYPES.REGISTRATION_DECIDED, payload: { registrationId: id } }, tx);
        }
        return { entityId: id, after: { status: RecordStatus.CLOSED, reason: "unreviewed" }, result: count === 1 };
      },
    );
    if (done) closed += 1;
  }
  return closed;
}

/** Closes PENDING transfers older than `transfers.pendingTtlDays`. Returns how many. */
export async function expirePendingTransfers(now: Date = new Date(), batch = 100): Promise<number> {
  const days = await getSetting("transfers.pendingTtlDays");
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const due = await prisma.transfer.findMany({
    where: { status: TransferStatus.PENDING, createdAt: { lte: cutoff } },
    select: { id: true },
    take: batch,
  });
  let closed = 0;
  for (const { id } of due) {
    const done = await auditedMutation(
      { actorType: AuditActorType.SYSTEM, source: "transfers.pending_expiry" },
      "transfer.pending_expired",
      "transfer",
      async (tx) => {
        const { count } = await tx.transfer.updateMany({
          where: { id, status: TransferStatus.PENDING },
          data: { status: TransferStatus.CLOSED, rejectionReason: unreviewedReason(days) },
        });
        if (count === 1) {
          await enqueueJob({ type: MODULE_JOB_TYPES.TRANSFER_DECIDED, payload: { transferId: id } }, tx);
        }
        return { entityId: id, after: { status: TransferStatus.CLOSED, reason: "unreviewed" }, result: count === 1 };
      },
    );
    if (done) closed += 1;
  }
  return closed;
}
