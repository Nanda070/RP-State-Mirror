/**
 * Message designs & sent messages CRUD for the embed manager.
 * Button actions are also managed here.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { embedSpecSchema, makeCustomId, type EmbedSpec } from "./embeds.js";
import { toJsonValue } from "./db.js";

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
    if (!existing || existing.status !== RecordStatus.ACTIVE) throw new Error("Шаблон не найден");
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
    if (!existing || existing.status !== RecordStatus.ACTIVE) throw new Error("Шаблон не найден");
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
    where: { channelDiscordId_messageDiscordId: { channelDiscordId: input.channelDiscordId, messageDiscordId: input.messageDiscordId } },
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
    },
  });
}

export async function getSentMessage(channelDiscordId: string, messageDiscordId: string) {
  return prisma.sentMessage.findUnique({
    where: { channelDiscordId_messageDiscordId: { channelDiscordId, messageDiscordId } },
  });
}

// ──────────────────────────────────────────────────────────────
// Button actions
// ──────────────────────────────────────────────────────────────

export async function createButtonAction(action: string, params: Record<string, unknown>) {
  const btn = await prisma.buttonAction.create({
    data: { action, params: toJsonValue(params), status: RecordStatus.ACTIVE },
  });
  return { id: btn.id, customId: makeCustomId(action, btn.id) };
}

export async function getButtonAction(id: string) {
  return prisma.buttonAction.findUnique({ where: { id, status: RecordStatus.ACTIVE } });
}

export async function deactivateButtonAction(id: string) {
  return prisma.buttonAction.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
}
