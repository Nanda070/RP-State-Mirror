import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobStatus } from "@mirror/db";
import {
  cancelJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  requeueStaleJobs,
  retryDelayMs,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("job queue", () => {
  it("never hands the same job to two concurrent workers", async () => {
    const jobs = await Promise.all(Array.from({ length: 30 }, (_, i) => enqueueJob({ type: "test", payload: { i } })));

    const claimed: string[] = [];
    await Promise.all(
      Array.from({ length: 6 }, async (_, w) => {
        for (;;) {
          const job = await claimNextJob(`worker-${w}`);
          if (!job) return;
          claimed.push(job.id);
        }
      }),
    );

    expect(claimed).toHaveLength(jobs.length);
    expect(new Set(claimed).size).toBe(jobs.length);
  });

  it("skips jobs that are not due yet", async () => {
    await enqueueJob({ type: "later", availableAt: new Date(Date.now() + 60_000) });
    expect(await claimNextJob("w")).toBeNull();
  });

  it("completes only when the caller holds the lock", async () => {
    await enqueueJob({ type: "test" });
    const job = await claimNextJob("owner");
    expect(job).not.toBeNull();

    expect(await completeJob(job!.id, "intruder")).toBe(false);
    expect(await completeJob(job!.id, "owner", { ok: true })).toBe(true);

    const stored = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(stored.status).toBe(JobStatus.SUCCEEDED);
    expect(stored.result).toEqual({ ok: true });
  });

  it("retries with backoff, then fails permanently after maxAttempts", async () => {
    const { id } = await enqueueJob({ type: "flaky", maxAttempts: 2 });

    const first = await claimNextJob("w");
    const retried = await failJob(first!.id, "w", new Error("boom"));
    expect(retried?.status).toBe(JobStatus.PENDING);
    expect(retried?.lastError).toBe("Error: boom");
    expect(retried!.availableAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.job.update({ where: { id }, data: { availableAt: new Date() } });
    const second = await claimNextJob("w");
    expect(second?.attempts).toBe(2);
    const failed = await failJob(second!.id, "w", new Error("boom again"));
    expect(failed?.status).toBe(JobStatus.FAILED);
  });

  it("fails immediately when retry is disabled", async () => {
    await enqueueJob({ type: "unknown" });
    const job = await claimNextJob("w");
    const failed = await failJob(job!.id, "w", new Error("no handler"), { retry: false });
    expect(failed?.status).toBe(JobStatus.FAILED);
  });

  it("requeues jobs whose worker died and fails them when out of attempts", async () => {
    const alive = await enqueueJob({ type: "a", maxAttempts: 3 });
    const exhausted = await enqueueJob({ type: "b", maxAttempts: 1 });
    await claimNextJob("dead");
    await claimNextJob("dead");
    const old = new Date(Date.now() - 10 * 60_000);
    await prisma.job.updateMany({ data: { lockedAt: old } });

    expect(await requeueStaleJobs(5 * 60_000)).toBe(2);
    const [a, b] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: alive.id } }),
      prisma.job.findUniqueOrThrow({ where: { id: exhausted.id } }),
    ]);
    expect(a.status).toBe(JobStatus.PENDING);
    expect(a.lockedBy).toBeNull();
    expect(b.status).toBe(JobStatus.FAILED);
  });

  it("does not requeue jobs with a fresh lock", async () => {
    await enqueueJob({ type: "a" });
    await claimNextJob("alive");
    expect(await requeueStaleJobs(5 * 60_000)).toBe(0);
  });

  it("cancels only pending jobs", async () => {
    const pending = await enqueueJob({ type: "a" });
    expect(await cancelJob(pending.id)).toBe(true);
    expect(await cancelJob(pending.id)).toBe(false);
  });

  it("caps the retry delay", () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(50)).toBe(10 * 60_000);
  });
});
