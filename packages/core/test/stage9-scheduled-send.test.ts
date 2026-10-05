import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, JobStatus } from "@mirror/db";
import {
  cancelScheduledMessageSend,
  claimNextJob,
  createMessageDesign,
  enqueueMessageDesignSend,
  listScheduledMessageSends,
  scheduleMessageDesignSend,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage9-scheduled-send.test" } as const;
const target = { guildDiscordId: "100000000000000001", channelDiscordId: "100000000000000002" };

async function design() {
  return createMessageDesign(
    { name: "Объявление", spec: { version: 1, embeds: [{ type: "embed", title: "Сбор в {time}" }] } },
    context,
  );
}

describe("scheduled sends", () => {
  it("waits for its time, is listed, audited and can be cancelled", async () => {
    const template = await design();
    const sendAt = new Date(Date.now() + 2 * 3_600_000);
    const job = await scheduleMessageDesignSend({ designId: template.id, ...target, sendAt: sendAt.toISOString() }, context);
    expect(job.availableAt.getTime()).toBe(sendAt.getTime());
    // The worker does not take it before its time.
    expect(await claimNextJob("test-worker")).toBeNull();

    const scheduled = await listScheduledMessageSends();
    expect(scheduled).toEqual([
      expect.objectContaining({ jobId: job.id, designName: "Объявление", channelDiscordId: target.channelDiscordId }),
    ]);
    expect(await prisma.auditLog.count({ where: { action: "message_design.send_scheduled", entityId: job.id } })).toBe(1);

    // A send right away is not a plan.
    await enqueueMessageDesignSend({ designId: template.id, ...target });
    expect(await listScheduledMessageSends()).toHaveLength(1);

    await cancelScheduledMessageSend(job.id, context);
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe(JobStatus.CANCELLED);
    expect(await listScheduledMessageSends()).toEqual([]);
    await expect(cancelScheduledMessageSend(job.id, context)).rejects.toThrow(/отменить нельзя/);
    expect(await prisma.auditLog.count({ where: { action: "message_design.send_cancelled" } })).toBe(1);
  });

  it("refuses times in the past and too far ahead", async () => {
    const template = await design();
    await expect(
      scheduleMessageDesignSend({ designId: template.id, ...target, sendAt: new Date(Date.now() - 60_000) }, context),
    ).rejects.toThrow(/на минуту позже/);
    await expect(
      scheduleMessageDesignSend(
        { designId: template.id, ...target, sendAt: new Date(Date.now() + 91 * 24 * 3_600_000) },
        context,
      ),
    ).rejects.toThrow(/90 дней/);
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "message_design.send_scheduled" } })).toBe(0);
  });
});
