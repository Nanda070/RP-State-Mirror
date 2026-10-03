/**
 * Audit log archiving (§6): the log is never deleted, but rows older than a year move to
 * `audit_log_archive`, so the working table and its indexes stay small.
 */
import { prisma } from "@mirror/db";
import { toJsonValue } from "./db.js";
import { getSetting } from "./settings.js";

/**
 * Moves one batch of old rows. Copy and removal happen in one transaction: a row is never lost
 * and never present in both tables. Returns how many rows were moved; call again until it returns 0.
 */
export async function archiveOldAuditLog(now: Date = new Date(), batch = 1000): Promise<number> {
  const days = await getSetting("audit.archiveAfterDays");
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: batch,
    });
    if (rows.length === 0) return 0;
    await tx.auditLogArchive.createMany({
      data: rows.map((row) => ({ id: row.id, payload: toJsonValue(row) })),
      skipDuplicates: true,
    });
    await tx.auditLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return rows.length;
  });
}
