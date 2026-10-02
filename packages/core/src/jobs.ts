import { JobStatus, Prisma, prisma } from "@mirror/db";
import { z } from "zod";

export const jobSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  availableAt: z.date().optional(),
  initiatedById: z.string().optional(),
});

export type EnqueueJob = z.input<typeof jobSchema>;

export function enqueueJob(job: EnqueueJob) {
  const data = jobSchema.parse(job);
  return prisma.job.create({
    data: {
      type: data.type,
      payload: data.payload as Prisma.InputJsonObject,
      ...(data.availableAt === undefined ? {} : { availableAt: data.availableAt }),
      ...(data.initiatedById === undefined ? {} : { initiatedById: data.initiatedById }),
    },
  });
}

export function claimNextJob(workerId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        status: JobStatus.PENDING,
        availableAt: { lte: new Date() },
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });

    if (!job) return null;

    return tx.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });
  });
}