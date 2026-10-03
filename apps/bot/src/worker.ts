import type { Client } from "discord.js";
import type { Job } from "@mirror/db";
import { claimNextJob, completeJob, failJob, requeueStaleJobs, type Logger } from "@mirror/core";

export interface JobContext {
  client: Client;
  job: Job;
  log: Logger;
}

export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<unknown>;

export interface JobWorkerOptions {
  pollIntervalMs?: number;
  staleAfterMs?: number;
  maxJobsPerTick?: number;
}

export class JobWorker {
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly maxJobsPerTick: number;
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
  }

  start() {
    this.stopping = false;
    this.pollTimer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.staleTimer = setInterval(() => void this.requeueStale(), 60_000);
    void this.requeueStale();
    void this.tick();
    this.log.info({ workerId: this.workerId, handlers: [...this.handlers.keys()] }, "job worker started");
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
    for (let processed = 0; processed < this.maxJobsPerTick && !this.stopping; processed += 1) {
      let job: Job | null;
      try {
        job = await claimNextJob(this.workerId);
      } catch (error) {
        this.log.error({ err: error }, "failed to claim job");
        // Back off on DB/transaction pressure (P2028) so we do not hammer the pool every tick.
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return;
      }
      if (!job) return;
      await this.run(job);
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
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      const result = await handler(payload, { client: this.client, job, log });
      await completeJob(job.id, this.workerId, result);
      log.info("job succeeded");
    } catch (error) {
      const updated = await failJob(job.id, this.workerId, error);
      log.warn({ err: error, status: updated?.status, availableAt: updated?.availableAt }, "job failed");
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
