/**
 * Admin statistics (§5.9): who processed how many applications, how fast, and when.
 * Counted from the records themselves, so every decision is attributed to the Discord account
 * that made it regardless of where it was made (Discord button or dashboard).
 */
import { DecisionStatus, prisma } from "@mirror/db";

export interface AdminStatsRow {
  discordId: string;
  registrationsApproved: number;
  registrationsRejected: number;
  /** Mean time from application to decision, minutes; null when there were no decisions. */
  avgReactionMinutes: number | null;
  transferDecisions: number;
  feedbackReplies: number;
  wantedIssued: number;
  wantedClosed: number;
  finesIssued: number;
  finesPaid: number;
  blacklistAdded: number;
  blacklistClosed: number;
  total: number;
}

export interface AdminStats {
  from: Date;
  to: Date;
  rows: AdminStatsRow[];
  /** Processed items per Moscow calendar day, oldest first. */
  byDay: { day: string; count: number }[];
}

function emptyRow(discordId: string): AdminStatsRow & { reactionSum: number; reactionCount: number } {
  return {
    discordId,
    registrationsApproved: 0,
    registrationsRejected: 0,
    avgReactionMinutes: null,
    transferDecisions: 0,
    feedbackReplies: 0,
    wantedIssued: 0,
    wantedClosed: 0,
    finesIssued: 0,
    finesPaid: 0,
    blacklistAdded: 0,
    blacklistClosed: 0,
    total: 0,
    reactionSum: 0,
    reactionCount: 0,
  };
}

const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" });

export async function getAdminStats(period: { from: Date; to: Date }): Promise<AdminStats> {
  const range = { gte: period.from, lte: period.to };
  const rows = new Map<string, ReturnType<typeof emptyRow>>();
  const days = new Map<string, number>();
  const row = (discordId: string) => {
    let entry = rows.get(discordId);
    if (!entry) {
      entry = emptyRow(discordId);
      rows.set(discordId, entry);
    }
    return entry;
  };
  const count = (discordId: string | null, key: keyof AdminStatsRow, at: Date | null) => {
    if (!discordId) return;
    const entry = row(discordId);
    (entry[key] as number) += 1;
    entry.total += 1;
    if (at) days.set(dayFormat.format(at), (days.get(dayFormat.format(at)) ?? 0) + 1);
  };

  const [registrations, transfers, feedback, wantedIssued, wantedClosed, finesIssued, finesPaid, blAdded, blClosed] =
    await Promise.all([
      prisma.registration.findMany({
        where: { decidedAt: range, decidedByDiscordId: { not: null }, decision: { not: DecisionStatus.PENDING } },
        select: { decidedByDiscordId: true, decision: true, decidedAt: true, createdAt: true },
      }),
      prisma.transfer.findMany({
        where: { updatedAt: range },
        select: { sourceDecidedByDiscordId: true, targetDecidedByDiscordId: true, updatedAt: true },
      }),
      prisma.feedbackMessage.findMany({
        where: { createdAt: range },
        select: { authorDiscordId: true, createdAt: true, ticket: { select: { authorDiscordId: true } } },
      }),
      prisma.wanted.findMany({ where: { createdAt: range }, select: { issuedByDiscordId: true, createdAt: true } }),
      prisma.wanted.findMany({
        where: { updatedAt: range, closedByDiscordId: { not: null } },
        select: { closedByDiscordId: true, updatedAt: true },
      }),
      prisma.fine.findMany({ where: { createdAt: range }, select: { issuedByDiscordId: true, createdAt: true } }),
      prisma.fine.findMany({
        where: { paidAt: range, paidByDiscordId: { not: null } },
        select: { paidByDiscordId: true, paidAt: true },
      }),
      prisma.icBlacklistEntry.findMany({ where: { createdAt: range }, select: { createdByDiscordId: true, createdAt: true } }),
      prisma.icBlacklistEntry.findMany({
        where: { updatedAt: range, closedByDiscordId: { not: null } },
        select: { closedByDiscordId: true, updatedAt: true },
      }),
    ]);

  for (const item of registrations) {
    count(
      item.decidedByDiscordId,
      item.decision === DecisionStatus.APPROVED ? "registrationsApproved" : "registrationsRejected",
      item.decidedAt,
    );
    if (item.decidedByDiscordId && item.decidedAt) {
      const entry = row(item.decidedByDiscordId);
      entry.reactionSum += item.decidedAt.getTime() - item.createdAt.getTime();
      entry.reactionCount += 1;
    }
  }
  for (const item of transfers) {
    count(item.sourceDecidedByDiscordId, "transferDecisions", item.updatedAt);
    count(item.targetDecidedByDiscordId, "transferDecisions", item.updatedAt);
  }
  for (const item of feedback) {
    // Only replies count: the ticket author's own messages are not admin work.
    if (item.authorDiscordId !== item.ticket.authorDiscordId) count(item.authorDiscordId, "feedbackReplies", item.createdAt);
  }
  for (const item of wantedIssued) count(item.issuedByDiscordId, "wantedIssued", item.createdAt);
  for (const item of wantedClosed) count(item.closedByDiscordId, "wantedClosed", item.updatedAt);
  for (const item of finesIssued) count(item.issuedByDiscordId, "finesIssued", item.createdAt);
  for (const item of finesPaid) count(item.paidByDiscordId, "finesPaid", item.paidAt);
  for (const item of blAdded) count(item.createdByDiscordId, "blacklistAdded", item.createdAt);
  for (const item of blClosed) count(item.closedByDiscordId, "blacklistClosed", item.updatedAt);

  return {
    from: period.from,
    to: period.to,
    rows: [...rows.values()]
      .map(({ reactionSum, reactionCount, ...entry }) => ({
        ...entry,
        avgReactionMinutes: reactionCount > 0 ? Math.round(reactionSum / reactionCount / 60_000) : null,
      }))
      .sort((a, b) => b.total - a.total || a.discordId.localeCompare(b.discordId)),
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, count: value })),
  };
}
