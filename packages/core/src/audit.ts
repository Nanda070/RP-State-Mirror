import { AuditActorType, Prisma, prisma } from "@mirror/db";
import { z } from "zod";
import { toJsonValue, type Db } from "./db.js";

export const auditContextSchema = z.object({
  actorType: z.nativeEnum(AuditActorType),
  actorUserId: z.string().optional(),
  source: z.string().min(1),
  ipAddress: z.string().optional(),
  guildId: z.string().optional(),
  channelId: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type AuditContext = z.input<typeof auditContextSchema>;

export const auditEventSchema = auditContextSchema.extend({
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

export type AuditEvent = z.input<typeof auditEventSchema>;

function toAuditCreateInput(event: AuditEvent): Prisma.AuditLogUncheckedCreateInput {
  const data = auditEventSchema.parse(event);
  return {
    actorType: data.actorType,
    actorUserId: data.actorUserId ?? null,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    source: data.source,
    ipAddress: data.ipAddress ?? null,
    guildId: data.guildId ?? null,
    channelId: data.channelId ?? null,
    ...(data.before === undefined ? {} : { before: toJsonValue(data.before) }),
    ...(data.after === undefined ? {} : { after: toJsonValue(data.after) }),
    metadata: toJsonValue(data.metadata) as Prisma.InputJsonObject,
  };
}

export function writeAuditEvent(event: AuditEvent, db: Db = prisma) {
  return db.auditLog.create({ data: toAuditCreateInput(event) });
}

export function writeAuditEvents(events: AuditEvent[], db: Db = prisma) {
  if (events.length === 0) return Promise.resolve({ count: 0 });
  return db.auditLog.createMany({ data: events.map(toAuditCreateInput) });
}

export interface AuditedChange<T> {
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  result: T;
}

/**
 * Runs a mutation and its audit record in one transaction:
 * if either fails, neither is persisted.
 */
export async function auditedMutation<T>(
  context: AuditContext,
  action: string,
  entityType: string,
  run: (tx: Prisma.TransactionClient) => Promise<AuditedChange<T>>,
): Promise<T> {
  const ctx = auditContextSchema.parse(context);
  return prisma.$transaction(async (tx) => {
    const change = await run(tx);
    await writeAuditEvent(
      {
        ...context,
        action,
        entityType,
        entityId: change.entityId,
        before: change.before,
        after: change.after,
        metadata: { ...ctx.metadata, ...change.metadata },
      },
      tx,
    );
    return change.result;
  });
}
