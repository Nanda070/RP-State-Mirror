import type { Client } from "discord.js";
import type { Job } from "@mirror/db";
import {
  claimNextJob,
  clearReadCache,
  clearSettingsCache,
  completeJob,
  deferJob,
  failJob,
  requeueStaleJobs,
  type Logger,
} from "@mirror/core";

/** A handler answers this when it cannot run yet (e.g. the target channel is not configured). */
function deferredReason(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const { status, reason } = result as { status?: unknown; reason?: unknown };
  if (status !== "deferred") return null;
  return typeof reason === "string" && reason.trim() ? reason : "цель доставки не настроена";
}

export interface JobContext {
  client: Client;
  job: Job;
  log: Logger;
}

export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<unknown>;

export interface JobWorkerOptions {
  /** Called when a job has failed permanently (no attempts left). */
  onPermanentFailure?: (job: Job, error: unknown) => void;
  pollIntervalMs?: number;
  staleAfterMs?: number;
  maxJobsPerTick?: number;
  /** How many jobs may run at the same time. */
  concurrency?: number;
}

/** Jobs about the same record must keep their order: «publish» before «edit». */
function entityKey(job: Job): string | null {
  const payload = job.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  for (const [name, value] of Object.entries(payload)) {
    if (name.endsWith("Id") && typeof value === "string" && value) return `${name}:${value}`;
  }
  return null;
}

export class JobWorker {
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly maxJobsPerTick: number;
  private readonly concurrency: number;
  /** Last job of each record that is still running: the next one for that record waits for it. */
  private readonly chains = new Map<string, Promise<void>>();
  private readonly onPermanentFailure: ((job: Job, error: unknown) => void) | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private staleTimer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly client: Client,
    private readonly handlers: ReadonlyMap<string, JobHandler>,
    private readonly log: Logger,
    private readonly workerId: string,
    options: JobWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
    this.maxJobsPerTick = options.maxJobsPerTick ?? 20;
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.onPermanentFailure = options.onPermanentFailure;
  }

  start() {
    this.stopping = false;
    this.pollTimer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.staleTimer = setInterval(() => void this.requeueStale(), 60_000);
    void this.requeueStale();
    void this.tick();
    this.log.info({ workerId: this.workerId, handlers: [...this.handlers.keys()] }, "job worker started");
  }

  /**
   * Looks at the queue now instead of at the next poll. Called right after the bot itself queued
   * work (a command, a button), so the reply in Discord does not wait for the poll interval.
   */
  wake() {
    if (!this.stopping) void this.tick();
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.pollTimer);
    clearInterval(this.staleTimer);
    await this.running;
  }

  private tick() {
    if (this.running || this.stopping) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async drain() {
    let processed = 0;
    // Each lane claims and runs jobs one after another; the lanes run side by side.
    const lane = async () => {
      while (processed < this.maxJobsPerTick && !this.stopping) {
        let job: Job | null;
        try {
          job = await claimNextJob(this.workerId);
        } catch (error) {
          this.log.error({ err: error }, "failed to claim job");
          return;
        }
        if (!job) return;
        processed += 1;
        await this.runInOrder(job);
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, lane));
  }

  /** Runs the job after the previous job of the same record has finished. */
  private async runInOrder(job: Job) {
    const key = entityKey(job);
    if (!key) return this.run(job);
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.run(job));
    this.chains.set(key, current);
    try {
      await current;
    } finally {
      if (this.chains.get(key) === current) this.chains.delete(key);
    }
  }

  private async run(job: Job) {
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const handler = this.handlers.get(job.type);
    if (!handler) {
      log.error("no handler registered for job type");
      await failJob(job.id, this.workerId, new Error(`No handler for job type "${job.type}"`), { retry: false });
      return;
    }
    try {
      // A job often runs right after its channel or roles were configured in the dashboard:
      // it must see the settings as they are now, not as the bot remembered them.
      clearSettingsCache();
      clearReadCache();
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      const result = await handler(payload, { client: this.client, job, log });
      const reason = deferredReason(result);
      if (reason) {
        // Not done: the job waits for configuration and is tried again later.
        const updated = await deferJob(job.id, this.workerId, reason);
        log.info({ reason, status: updated?.status, availableAt: updated?.availableAt }, "job deferred");
        return;
      }
      await completeJob(job.id, this.workerId, result);
      log.info("job succeeded");
    } catch (error) {
      const updated = await failJob(job.id, this.workerId, error);
      log.warn({ err: error, status: updated?.status, availableAt: updated?.availableAt }, "job failed");
      if (updated?.status === "FAILED") this.onPermanentFailure?.(job, error);
    }
  }

  private async requeueStale() {
    try {
      const count = await requeueStaleJobs(this.staleAfterMs);
      if (count > 0) this.log.warn({ count }, "requeued stale jobs");
    } catch (error) {
      this.log.error({ err: error }, "failed to requeue stale jobs");
    }
  }
}
