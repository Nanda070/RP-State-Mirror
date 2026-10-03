import { JobStatus, type Prisma, prisma, type Job } from "@mirror/db";
import { z } from "zod";
import { toJsonValue, type Db } from "./db.js";

export const jobSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  availableAt: z.date().optional(),
  maxAttempts: z.number().int().min(1).max(50).optional(),
  initiatedById: z.string().optional(),
});

export type EnqueueJob = z.input<typeof jobSchema>;

const MAX_ERROR_LENGTH = 2000;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;

export function retryDelayMs(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS);
}

let enqueueListener: (() => void) | null = null;

/**
 * Lets the process that runs the worker hear about jobs it queued itself, so it can look at the
 * queue at once instead of at the next poll. The job may still be inside an open transaction when
 * the listener fires — the listener should wait a moment before looking.
 */
export function onJobEnqueued(listener: (() => void) | null) {
  enqueueListener = listener;
}

export function enqueueJob(job: EnqueueJob, db: Db = prisma) {
  const data = jobSchema.parse(job);
  enqueueListener?.();
  return db.job.create({
    data: {
      type: data.type,
      payload: data.payload as Prisma.InputJsonObject,
      ...(data.availableAt === undefined ? {} : { availableAt: data.availableAt }),
      ...(data.maxAttempts === undefined ? {} : { maxAttempts: data.maxAttempts }),
      ...(data.initiatedById === undefined ? {} : { initiatedById: data.initiatedById }),
    },
  });
}

/**
 * Atomically takes the next due job. `FOR UPDATE SKIP LOCKED` guarantees that
 * concurrent workers never receive the same job.
 *
 * One statement, no interactive transaction: the idle poll runs every couple of seconds and must
 * not wait for a transaction slot when the connection pool is busy (that surfaced as P2028).
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE jobs SET
      status = 'RUNNING'::"JobStatus",
      locked_at = (now() AT TIME ZONE 'UTC'),
      locked_by = ${workerId},
      attempts = attempts + 1,
      updated_at = (now() AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND available_at <= (now() AT TIME ZONE 'UTC')
      ORDER BY available_at, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  const id = rows[0]?.id;
  return id ? prisma.job.findUnique({ where: { id } }) : null;
}

export async function completeJob(jobId: string, workerId: string, result?: unknown): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, lockedBy: workerId },
    data: {
      status: JobStatus.SUCCEEDED,
      completedAt: new Date(),
      lastError: null,
      ...(result === undefined ? {} : { result: toJsonValue(result) }),
    },
  });
  return count === 1;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export interface FailJobOptions {
  /** When false, the job fails permanently regardless of remaining attempts. */
  retry?: boolean;
}

export async function failJob(
  jobId: string,
  workerId: string,
  error: unknown,
  options: FailJobOptions = {},
): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, status: JobStatus.RUNNING, lockedBy: workerId } });
    if (!job) return null;

    const canRetry = (options.retry ?? true) && job.attempts < job.maxAttempts;
    return tx.job.update({
      where: { id: jobId },
      data: canRetry
        ? {
            status: JobStatus.PENDING,
            availableAt: new Date(Date.now() + retryDelayMs(job.attempts)),
            lockedAt: null,
            lockedBy: null,
            lastError: errorMessage(error),
          }
        : {
            status: JobStatus.FAILED,
            completedAt: new Date(),
            lastError: errorMessage(error),
          },
    });
  });
}

/** How often a job waiting for configuration is looked at again. */
export const DEFER_RETRY_MS = 5 * 60_000;
/** After this long without the missing setting the job is given up on. */
export const DEFER_MAX_AGE_MS = 7 * 24 * 3_600_000;

/**
 * Puts a job back because it cannot run *yet* — typically the target channel is not configured.
 * It is tried again every few minutes, so «отправится после настройки» is literally true, and the
 * wait does not use up retry attempts. A job that has waited longer than a week fails for good.
 */
export async function deferJob(
  jobId: string,
  workerId: string,
  reason: string,
  options: { retryInMs?: number; maxAgeMs?: number } = {},
): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, status: JobStatus.RUNNING, lockedBy: workerId } });
    if (!job) return null;

    const message = `Отложено: ${reason}`.slice(0, MAX_ERROR_LENGTH);
    const expired = Date.now() - job.createdAt.getTime() > (options.maxAgeMs ?? DEFER_MAX_AGE_MS);
    return tx.job.update({
      where: { id: jobId },
      data: expired
        ? { status: JobStatus.FAILED, completedAt: new Date(), lastError: message }
        : {
            status: JobStatus.PENDING,
            availableAt: new Date(Date.now() + (options.retryInMs ?? DEFER_RETRY_MS)),
            lockedAt: null,
            lockedBy: null,
            lastError: message,
            // Waiting is not a failed attempt.
            attempts: Math.max(job.attempts - 1, 0),
          },
    });
  });
}

/**
 * Makes jobs that wait for configuration run right away. Called when settings are saved,
 * so the admin sees the effect immediately instead of after the next retry window.
 */
export async function wakeDeferredJobs(): Promise<number> {
  const { count } = await prisma.job.updateMany({
    where: { status: JobStatus.PENDING, lastError: { startsWith: "Отложено:" }, availableAt: { gt: new Date() } },
    data: { availableAt: new Date() },
  });
  return count;
}

/**
 * Returns jobs whose worker died mid-run back to the queue
 * (or fails them if no attempts are left). Returns the number of jobs touched.
 */
export function requeueStaleJobs(staleAfterMs: number): Promise<number> {
  const seconds = Math.max(staleAfterMs / 1000, 0);
  return prisma.$executeRaw`
    UPDATE jobs SET
      status = CASE WHEN attempts >= max_attempts THEN 'FAILED'::"JobStatus" ELSE 'PENDING'::"JobStatus" END,
      completed_at = CASE WHEN attempts >= max_attempts THEN (now() AT TIME ZONE 'UTC') ELSE NULL END,
      available_at = (now() AT TIME ZONE 'UTC'),
      locked_at = NULL,
      locked_by = NULL,
      last_error = 'Worker lock expired',
      updated_at = (now() AT TIME ZONE 'UTC')
    WHERE status = 'RUNNING'
      AND locked_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${seconds})`;
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.PENDING },
    data: { status: JobStatus.CANCELLED, completedAt: new Date() },
  });
  return count === 1;
}
