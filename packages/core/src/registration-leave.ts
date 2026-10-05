/**
 * A dismissed person is removed from the faction's Discord server by hand, and after that the bot
 * cannot reach them: the registration of their vehicle or uniform would stay active until its term
 * ends, holding the static and the plate. So leaving the faction server counts as a dismissal.
 *
 * A registration is closed when its applicant
 *  - left a faction server after filing it (the snapshot has `leftAt` on a server tied to a faction),
 *  - is on no faction server now, and
 *  - left longer ago than `registrations.leaveGraceHours`.
 *
 * The wait covers a transfer to another faction, a kick by mistake and a snapshot that marked people
 * as gone during a Discord outage: the hourly sync puts them back long before the wait is over.
 * A server that was deleted, or that the bot was removed from, has no «left» rows and closes nothing.
 */
import { AuditActorType, DecisionStatus, RecordStatus, prisma } from "@mirror/db";
import { auditedMutation } from "./audit.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { getSetting } from "./settings.js";

const HOUR_MS = 3_600_000;

/** Stored as the reason of the closed registration and shown on its card and in the registry. */
export const REGISTRATION_LEFT_REASON = "Увольнение: выход с сервера фракции.";

export type LeaverRegistrationsResult = {
  /** Registrations closed by this pass. */
  closed: number;
  /** Registrations the pass wanted to close but did not, because there were more than the limit. */
  held: number;
};

/** Somebody closed the registration between the selection and the write: nothing to do or to record. */
class AlreadyClosed extends Error {}

export async function closeRegistrationsOfLeavers(now: Date = new Date()): Promise<LeaverRegistrationsResult> {
  if (!(await getSetting("registrations.closeOnLeave"))) return { closed: 0, held: 0 };

  const factionGuilds = await prisma.guild.findMany({
    where: { status: RecordStatus.ACTIVE, factions: { some: { status: RecordStatus.ACTIVE } } },
    select: { id: true },
  });
  const guildIds = factionGuilds.map((guild) => guild.id);
  if (guildIds.length === 0) return { closed: 0, held: 0 };

  const graceHours = await getSetting("registrations.leaveGraceHours");
  const cutoff = new Date(now.getTime() - graceHours * HOUR_MS);

  const left = await prisma.guildMember.findMany({
    where: { guildId: { in: guildIds }, isPresent: false, leftAt: { lte: cutoff } },
    select: { userDiscordId: true, leftAt: true },
  });
  if (left.length === 0) return { closed: 0, held: 0 };

  const lastLeftAt = new Map<string, Date>();
  for (const row of left) {
    const known = lastLeftAt.get(row.userDiscordId);
    if (row.leftAt && (!known || row.leftAt > known)) lastLeftAt.set(row.userDiscordId, row.leftAt);
  }
  const stillInFaction = new Set(
    (
      await prisma.guildMember.findMany({
        where: { guildId: { in: guildIds }, isPresent: true, userDiscordId: { in: [...lastLeftAt.keys()] } },
        select: { userDiscordId: true },
      })
    ).map((row) => row.userDiscordId),
  );
  const leavers = [...lastLeftAt.keys()].filter((discordId) => !stillInFaction.has(discordId));
  if (leavers.length === 0) return { closed: 0, held: 0 };

  const candidates = await prisma.registration.findMany({
    where: { status: RecordStatus.ACTIVE, applicantDiscordId: { in: leavers } },
    select: { id: true, applicantDiscordId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  // Filed after the person had already left: leaving is not what this registration is about.
  const due = candidates.filter((row) => {
    const leftAt = lastLeftAt.get(row.applicantDiscordId);
    return leftAt !== undefined && leftAt > row.createdAt;
  });
  if (due.length === 0) return { closed: 0, held: 0 };

  const limit = await getSetting("registrations.leaveMaxPerPass");
  if (due.length > limit) return { closed: 0, held: due.length };

  let closed = 0;
  for (const row of due) {
    try {
      await closeOne(row.id, now, lastLeftAt.get(row.applicantDiscordId) ?? null);
      closed += 1;
    } catch (error) {
      if (!(error instanceof AlreadyClosed)) throw error;
    }
  }
  return { closed, held: 0 };
}

function closeOne(id: string, now: Date, leftAt: Date | null) {
  return auditedMutation(
    { actorType: AuditActorType.SYSTEM, source: "registrations.left_faction" },
    "registration.left_faction",
    "registration",
    async (tx) => {
      const current = await tx.registration.findUnique({ where: { id } });
      if (!current || current.status !== RecordStatus.ACTIVE) throw new AlreadyClosed();
      const pending = current.decision === DecisionStatus.PENDING;
      const { count } = await tx.registration.updateMany({
        where: { id, status: RecordStatus.ACTIVE, decision: current.decision },
        data: pending
          ? {
              decision: DecisionStatus.REJECTED,
              status: RecordStatus.CLOSED,
              decidedAt: now,
              rejectionReason: REGISTRATION_LEFT_REASON,
            }
          : { status: RecordStatus.REVOKED, rejectionReason: REGISTRATION_LEFT_REASON },
      });
      if (count !== 1) throw new AlreadyClosed();
      // The same jobs as a refusal and an early removal: the card changes, the applicant gets a
      // message if the bot can still reach them.
      await enqueueJob(
        {
          type: pending ? MODULE_JOB_TYPES.REGISTRATION_DECIDED : MODULE_JOB_TYPES.REGISTRATION_EXPIRED,
          payload: { registrationId: id },
        },
        tx,
      );
      return {
        entityId: id,
        before: { status: current.status, decision: current.decision },
        after: {
          status: pending ? RecordStatus.CLOSED : RecordStatus.REVOKED,
          reason: "left_faction",
          leftAt: leftAt?.toISOString() ?? null,
        },
        result: true,
      };
    },
  );
}
