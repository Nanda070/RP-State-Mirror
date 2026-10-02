import { AuditActorType, Prisma, prisma } from "@mirror/db";
import { z } from "zod";

export const auditEventSchema = z.object({
  actorType: z.nativeEnum(AuditActorType),
  actorUserId: z.string().optional(),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  source: z.string().min(1),
  ipAddress: z.string().optional(),
  guildId: z.string().optional(),
  channelId: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type AuditEvent = z.input<typeof auditEventSchema>;

export async function writeAuditEvent(event: AuditEvent) {
  const data = auditEventSchema.parse(event);
  return prisma.auditLog.create({
    data: {
      actorType: data.actorType,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      source: data.source,
      ...(data.actorUserId === undefined
        ? {}
        : { actorUser: { connect: { id: data.actorUserId } } }),
      ...(data.ipAddress === undefined ? {} : { ipAddress: data.ipAddress }),
      ...(data.guildId === undefined ? {} : { guildId: data.guildId }),
      ...(data.channelId === undefined ? {} : { channelId: data.channelId }),
      ...(data.before === undefined
        ? {}
        : { before: data.before === null ? Prisma.JsonNull : (data.before as Prisma.InputJsonValue) }),
      ...(data.after === undefined
        ? {}
        : { after: data.after === null ? Prisma.JsonNull : (data.after as Prisma.InputJsonValue) }),
      metadata: data.metadata as Prisma.InputJsonObject,
    },
  });
}