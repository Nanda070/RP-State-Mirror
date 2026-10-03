/**
 * Personnel events module (кадровый аудит).
 *
 * Records promotions, dismissals, transfers, reinstatements, appointments.
 * Can be triggered from both bot slash commands and the dashboard.
 * Each event publishes a message to the faction's personnel webhook (via a job).
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";

// ──────────────────────────────────────────────────────────────
// Personnel event types
// ──────────────────────────────────────────────────────────────

export const PERSONNEL_EVENT_TYPES = [
  "promotion",
  "dismissal",
  "transfer",
  "reinstatement",
  "appointment",
] as const;

export type PersonnelEventType = (typeof PERSONNEL_EVENT_TYPES)[number];

export const PERSONNEL_EVENT_LABELS_RU: Record<PersonnelEventType, string> = {
  promotion: "Повышение",
  dismissal: "Увольнение",
  transfer: "Перевод по отделу",
  reinstatement: "Восстановление",
  appointment: "Назначение",
};

// ──────────────────────────────────────────────────────────────
// Details schemas per event type
// ──────────────────────────────────────────────────────────────

export const promotionDetailsSchema = z.object({
  fromRank: z.number().int().min(1).optional(),
  toRank: z.number().int().min(1),
  comment: z.string().max(500).optional(),
});

export const dismissalDetailsSchema = z.object({
  reason: z.string().min(1).max(500),
  canRejoin: z.boolean().default(true),
});

export const transferDetailsSchema = z.object({
  fromDepartment: z.string().max(128).optional(),
  toDepartment: z.string().min(1).max(128),
  comment: z.string().max(500).optional(),
});

export const reinstatementDetailsSchema = z.object({
  comment: z.string().max(500).optional(),
});

export const appointmentDetailsSchema = z.object({
  position: z.string().min(1).max(128),
  comment: z.string().max(500).optional(),
});

const detailsSchemas = {
  promotion: promotionDetailsSchema,
  dismissal: dismissalDetailsSchema,
  transfer: transferDetailsSchema,
  reinstatement: reinstatementDetailsSchema,
  appointment: appointmentDetailsSchema,
} as const;

// ──────────────────────────────────────────────────────────────
// Input schema
// ──────────────────────────────────────────────────────────────

export const createPersonnelEventSchema = z.object({
  factionCode: z.string().min(1).max(32),
  type: z.enum(PERSONNEL_EVENT_TYPES),
  subjectDiscordId: z.string().min(1),
  subjectName: z.string().min(1).max(128),
  actorDiscordId: z.string().min(1),
  details: z.record(z.unknown()).default({}),
});
export type CreatePersonnelEventInput = z.infer<typeof createPersonnelEventSchema>;

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

export async function createPersonnelEvent(input: CreatePersonnelEventInput, context: AuditContext) {
  const data = createPersonnelEventSchema.parse(input);

  // Validate details against the type-specific schema.
  const detailsSchema = detailsSchemas[data.type];
  const parsedDetails = detailsSchema.parse(data.details);

  return auditedMutation(context, `personnel.${data.type}`, "personnel_event", async (tx) => {
    const event = await tx.personnelEvent.create({
      data: {
        factionCode: data.factionCode,
        type: data.type,
        subjectDiscordId: data.subjectDiscordId,
        subjectName: data.subjectName,
        actorDiscordId: data.actorDiscordId,
        details: toJsonValue(parsedDetails),
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: event.id, after: event, result: event };
  });
}

export async function revokePersonnelEvent(id: string, context: AuditContext) {
  return auditedMutation(context, "personnel.revoked", "personnel_event", async (tx) => {
    const event = await tx.personnelEvent.findUnique({ where: { id } });
    if (!event || event.status !== RecordStatus.ACTIVE) {
      throw new Error("Кадровое событие не найдено или не активно");
    }
    const updated = await tx.personnelEvent.update({
      where: { id },
      data: { status: RecordStatus.REVOKED },
    });
    return { entityId: id, before: { status: event.status }, after: updated, result: updated };
  });
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

export interface ListPersonnelFilter {
  factionCode?: string;
  type?: PersonnelEventType;
  subjectDiscordId?: string;
  status?: RecordStatus;
  limit?: number;
  offset?: number;
}

export async function listPersonnelEvents(filter: ListPersonnelFilter = {}) {
  const where = {
    ...(filter.factionCode ? { factionCode: filter.factionCode } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.subjectDiscordId ? { subjectDiscordId: filter.subjectDiscordId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.personnelEvent.count({ where }),
    prisma.personnelEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
  ]);
  return { total, items };
}
