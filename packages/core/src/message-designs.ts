/**
 * Message designs & sent messages CRUD for the embed manager.
 * Button actions are also managed here.
 */
import { JobStatus, RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, writeAuditEvent, type AuditContext } from "./audit.js";
import { toJsonValue, type Db } from "./db.js";
import {
  embedSpecSchema,
  makeCustomId,
  type EmbedSpec,
  type InteractiveRow,
  type V2Button,
  type V2Component,
  type V2RoleSelect,
} from "./embeds.js";
import { cancelJob, enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { UserError } from "./errors.js";

// ──────────────────────────────────────────────────────────────
// Design CRUD
// ──────────────────────────────────────────────────────────────

export const createMessageDesignSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  spec: embedSpecSchema,
});
export type CreateMessageDesignInput = z.infer<typeof createMessageDesignSchema>;

export async function createMessageDesign(input: CreateMessageDesignInput, context: AuditContext) {
  const data = createMessageDesignSchema.parse(input);
  return auditedMutation(context, "message_design.created", "message_design", async (tx) => {
    const design = await tx.messageDesign.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        spec: toJsonValue(data.spec),
        createdById: context.actorUserId ?? null,
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: design.id, after: design, result: design };
  });
}

export async function updateMessageDesign(
  id: string,
  input: Partial<CreateMessageDesignInput>,
  context: AuditContext,
) {
  return auditedMutation(context, "message_design.updated", "message_design", async (tx) => {
    const existing = await tx.messageDesign.findUnique({ where: { id } });
    if (!existing || existing.status !== RecordStatus.ACTIVE) throw new UserError("Шаблон не найден");
    const updated = await tx.messageDesign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.spec !== undefined ? { spec: toJsonValue(input.spec) } : {}),
      },
    });
    return { entityId: id, before: existing, after: updated, result: updated };
  });
}

export async function archiveMessageDesign(id: string, context: AuditContext) {
  return auditedMutation(context, "message_design.archived", "message_design", async (tx) => {
    const existing = await tx.messageDesign.findUnique({ where: { id } });
    if (!existing || existing.status !== RecordStatus.ACTIVE) throw new UserError("Шаблон не найден");
    const updated = await tx.messageDesign.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED },
    });
    return { entityId: id, before: existing, after: updated, result: updated };
  });
}

export async function listMessageDesigns(includeArchived = false) {
  return prisma.messageDesign.findMany({
    where: includeArchived ? {} : { status: RecordStatus.ACTIVE },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getMessageDesign(id: string) {
  return prisma.messageDesign.findUnique({ where: { id } });
}

// ──────────────────────────────────────────────────────────────
// Sent messages
// ──────────────────────────────────────────────────────────────

export interface RecordSentMessageInput {
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
  designId?: string;
  spec: EmbedSpec;
}

export async function recordSentMessage(input: RecordSentMessageInput) {
  return prisma.sentMessage.upsert({
    where: {
      channelDiscordId_messageDiscordId: {
        channelDiscordId: input.channelDiscordId,
        messageDiscordId: input.messageDiscordId,
      },
    },
    create: {
      guildDiscordId: input.guildDiscordId,
      channelDiscordId: input.channelDiscordId,
      messageDiscordId: input.messageDiscordId,
      designId: input.designId ?? null,
      spec: toJsonValue(input.spec),
      status: RecordStatus.ACTIVE,
    },
    update: {
      spec: toJsonValue(input.spec),
      designId: input.designId ?? null,
      status: RecordStatus.ACTIVE,
    },
  });
}

export async function getSentMessage(channelDiscordId: string, messageDiscordId: string) {
  return prisma.sentMessage.findUnique({
    where: { channelDiscordId_messageDiscordId: { channelDiscordId, messageDiscordId } },
  });
}

export async function listSentMessages(limit = 50) {
  return prisma.sentMessage.findMany({
    where: { status: RecordStatus.ACTIVE },
    include: { design: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function archiveSentMessage(id: string, context: AuditContext) {
  return auditedMutation(context, "sent_message.archived", "sent_message", async (tx) => {
    const existing = await tx.sentMessage.findUnique({ where: { id } });
    if (!existing || existing.status !== RecordStatus.ACTIVE) throw new UserError("Сообщение не найдено");
    const updated = await tx.sentMessage.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED },
    });
    return { entityId: id, before: existing, after: updated, result: updated };
  });
}

// ──────────────────────────────────────────────────────────────
// Button actions
// ──────────────────────────────────────────────────────────────

export async function createButtonAction(action: string, params: Record<string, unknown>, db: Db = prisma) {
  const btn = await db.buttonAction.create({
    data: { action, params: toJsonValue(params), status: RecordStatus.ACTIVE },
  });
  return { id: btn.id, customId: makeCustomId(action, btn.id) };
}

export async function getButtonAction(id: string) {
  return prisma.buttonAction.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
}

export async function deactivateButtonAction(id: string) {
  return prisma.buttonAction.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
}

async function materializeButton(button: V2Button): Promise<V2Button> {
  if (button.style === "link" || button.url) {
    return { ...button, customId: undefined, action: undefined, params: undefined };
  }
  if (button.customId && !button.action) {
    return button;
  }
  const action = button.action ?? "callback";
  const params = button.params ?? {};
  const created = await createButtonAction(action, params);
  return {
    ...button,
    customId: created.customId,
    action: undefined,
    params: undefined,
  };
}

/** The dropdown keeps its own action row: role ids, usage restriction and the per-member limit. */
async function materializeRoleSelect(select: V2RoleSelect): Promise<V2RoleSelect> {
  if (select.customId) return select;
  const created = await createButtonAction("role.select", {
    roleIds: select.options.map((option) => option.roleDiscordId),
    allowedRoleIds: select.allowedRoleIds ?? [],
    maxValues: select.maxValues ?? select.options.length,
  });
  return { ...select, customId: created.customId };
}

async function materializeRow<T extends InteractiveRow>(row: T): Promise<T> {
  if (row.type === "role_select") return (await materializeRoleSelect(row)) as T;
  const components: V2Button[] = [];
  for (const btn of row.components) {
    components.push(await materializeButton(btn));
  }
  return { type: "action_row", components } as T;
}

/**
 * Persist button_actions for interactive buttons and rewrite customIds.
 * Safe to call before Discord send — link buttons keep their url.
 */
export async function materializeEmbedSpecButtons(spec: EmbedSpec): Promise<EmbedSpec> {
  if (spec.version === 1) {
    if (!spec.components?.length) return spec;
    const components: InteractiveRow[] = [];
    for (const row of spec.components) components.push(await materializeRow(row));
    return { ...spec, components };
  }

  const containers = [];
  for (const container of spec.components) {
    const components: V2Component[] = [];
    for (const node of container.components) {
      if (node.type === "action_row" || node.type === "role_select") {
        components.push(await materializeRow(node));
      } else {
        components.push(node);
      }
    }
    containers.push({ ...container, components });
  }
  return { version: 2, components: containers };
}

// ──────────────────────────────────────────────────────────────
// Send / resend jobs
// ──────────────────────────────────────────────────────────────

/** How far ahead a message can be scheduled. */
export const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 3_600_000;

export const sendMessageDesignSchema = z.object({
  designId: z.string().min(1),
  guildDiscordId: z.string().regex(/^\d{17,20}$/),
  channelDiscordId: z.string().regex(/^\d{17,20}$/),
  /** Values for `{name}` placeholders of the template. */
  variables: z.record(z.string().max(1000)).optional(),
  /** Send later: the bot posts the template as it is at that moment. Absent — right away. */
  sendAt: z.coerce.date().optional(),
});
export type SendMessageDesignInput = z.input<typeof sendMessageDesignSchema>;

export async function enqueueMessageDesignSend(input: SendMessageDesignInput, db?: Db, now = new Date()) {
  const data = sendMessageDesignSchema.parse(input);
  const design = await prisma.messageDesign.findUnique({ where: { id: data.designId } });
  if (!design || design.status !== RecordStatus.ACTIVE) throw new UserError("Шаблон не найден");
  if (data.sendAt) {
    if (Number.isNaN(data.sendAt.getTime())) throw new UserError("Не удалось прочитать время отправки.");
    if (data.sendAt.getTime() < now.getTime() + 60_000) {
      throw new UserError("Время отправки должно быть хотя бы на минуту позже текущего.");
    }
    if (data.sendAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
      throw new UserError("Отправку можно запланировать не дальше чем на 90 дней вперёд.");
    }
  }
  return enqueueJob(
    {
      type: MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND,
      payload: {
        designId: data.designId,
        guildDiscordId: data.guildDiscordId,
        channelDiscordId: data.channelDiscordId,
        ...(data.variables ? { variables: data.variables } : {}),
        ...(data.sendAt ? { scheduledFor: data.sendAt.toISOString() } : {}),
      },
      ...(data.sendAt ? { availableAt: data.sendAt } : {}),
    },
    db,
  );
}

/** Schedules a template and leaves the plan in the audit log. */
export async function scheduleMessageDesignSend(
  input: Omit<SendMessageDesignInput, "sendAt"> & { sendAt: Date | string },
  context: AuditContext,
) {
  return auditedMutation(context, "message_design.send_scheduled", "job", async (tx) => {
    const job = await enqueueMessageDesignSend({ ...input, sendAt: new Date(input.sendAt) }, tx);
    return {
      entityId: job.id,
      after: { designId: input.designId, channelDiscordId: input.channelDiscordId, sendAt: job.availableAt.toISOString() },
      result: job,
    };
  });
}

export type ScheduledSend = {
  jobId: string;
  designId: string;
  designName: string;
  guildDiscordId: string;
  channelDiscordId: string;
  sendAt: Date;
};

/** Sends that wait for their time, soonest first. */
export async function listScheduledMessageSends(now = new Date()): Promise<ScheduledSend[]> {
  const jobs = await prisma.job.findMany({
    where: { type: MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND, status: JobStatus.PENDING, availableAt: { gt: now } },
    orderBy: { availableAt: "asc" },
    take: 100,
  });
  const scheduled = jobs.filter((job) => {
    const payload = job.payload as Record<string, unknown> | null;
    // A send that failed and waits for its retry is not a plan.
    return typeof payload?.scheduledFor === "string" && job.attempts === 0;
  });
  const designIds = [...new Set(scheduled.map((job) => String((job.payload as Record<string, unknown>).designId ?? "")))];
  const designs = await prisma.messageDesign.findMany({ where: { id: { in: designIds } }, select: { id: true, name: true } });
  const names = new Map(designs.map((design) => [design.id, design.name]));
  return scheduled.map((job) => {
    const payload = job.payload as Record<string, unknown>;
    const designId = String(payload.designId ?? "");
    return {
      jobId: job.id,
      designId,
      designName: names.get(designId) ?? "шаблон удалён",
      guildDiscordId: String(payload.guildDiscordId ?? ""),
      channelDiscordId: String(payload.channelDiscordId ?? ""),
      sendAt: job.availableAt,
    };
  });
}

/** Cancels a planned send before its time. */
export async function cancelScheduledMessageSend(jobId: string, context: AuditContext): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.type !== MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND) throw new UserError("Запланированная отправка не найдена.");
  if (!(await cancelJob(jobId))) throw new UserError("Сообщение уже отправляется или отправлено — отменить нельзя.");
  await writeAuditEvent({
    ...context,
    action: "message_design.send_cancelled",
    entityType: "job",
    entityId: jobId,
    before: { sendAt: job.availableAt.toISOString(), payload: job.payload },
  });
}

export async function enqueueMessageDesignResend(sentMessageId: string, db?: Db) {
  const sent = await prisma.sentMessage.findUnique({ where: { id: sentMessageId } });
  if (!sent || sent.status !== RecordStatus.ACTIVE) throw new UserError("Отправленное сообщение не найдено");
  return enqueueJob(
    {
      type: MODULE_JOB_TYPES.MESSAGE_DESIGN_RESEND,
      payload: { sentMessageId },
    },
    db,
  );
}
