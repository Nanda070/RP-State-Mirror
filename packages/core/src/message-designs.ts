/**
 * Message designs & sent messages CRUD for the embed manager.
 * Button actions are also managed here.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
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
import { enqueueJob } from "./jobs.js";
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

export const sendMessageDesignSchema = z.object({
  designId: z.string().min(1),
  guildDiscordId: z.string().regex(/^\d{17,20}$/),
  channelDiscordId: z.string().regex(/^\d{17,20}$/),
});
export type SendMessageDesignInput = z.infer<typeof sendMessageDesignSchema>;

export async function enqueueMessageDesignSend(input: SendMessageDesignInput, db?: Db) {
  const data = sendMessageDesignSchema.parse(input);
  const design = await prisma.messageDesign.findUnique({ where: { id: data.designId } });
  if (!design || design.status !== RecordStatus.ACTIVE) throw new UserError("Шаблон не найден");
  return enqueueJob(
    {
      type: MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND,
      payload: {
        designId: data.designId,
        guildDiscordId: data.guildDiscordId,
        channelDiscordId: data.channelDiscordId,
      },
    },
    db,
  );
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
