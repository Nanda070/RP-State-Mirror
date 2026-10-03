/**
 * Fines module: /штраф and /штраф-оплачено.
 *
 * Fine numbers: F-001, F-002, … (global sequential).
 * Due date is calculated from the "fines.dueDays" system setting.
 * Overdue detection happens at query time (dueAt < now && status ACTIVE).
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { type Db } from "./db.js";
import { getSetting } from "./settings.js";

// ──────────────────────────────────────────────────────────────
// Input schemas
// ──────────────────────────────────────────────────────────────

export const createFineSchema = z.object({
  staticId: z.string().min(1).max(32),
  characterName: z.string().min(1).max(128),
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(2000),
  issuedByDiscordId: z.string().min(1),
  factionCode: z.string().min(1).max(32),
});
export type CreateFineInput = z.infer<typeof createFineSchema>;

export const markFinePaidSchema = z.object({
  fineNumber: z.string().min(1),
  paidByDiscordId: z.string().min(1),
});
export type MarkFinePaidInput = z.infer<typeof markFinePaidSchema>;

// ──────────────────────────────────────────────────────────────
// Number generation
// ──────────────────────────────────────────────────────────────

async function nextFineNumber(db: Db): Promise<string> {
  const last = await db.fine.findFirst({
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  let seq = 1;
  if (last) {
    const n = Number.parseInt(last.number.replace(/^F-/, ""), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `F-${String(seq).padStart(3, "0")}`;
}

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

export async function createFine(input: CreateFineInput, context: AuditContext) {
  const data = createFineSchema.parse(input);
  const dueDays = await getSetting("fines.dueDays");
  const dueAt = new Date(Date.now() + dueDays * 86_400_000);

  return auditedMutation(context, "fine.created", "fine", async (tx) => {
    const number = await nextFineNumber(tx);
    const fine = await tx.fine.create({
      data: {
        number,
        staticId: data.staticId,
        characterName: data.characterName,
        amount: data.amount,
        reason: data.reason,
        issuedByDiscordId: data.issuedByDiscordId,
        factionCode: data.factionCode,
        dueAt,
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: fine.id, after: fine, result: fine };
  });
}

export async function markFinePaid(input: MarkFinePaidInput, context: AuditContext) {
  const data = markFinePaidSchema.parse(input);

  return auditedMutation(context, "fine.paid", "fine", async (tx) => {
    const fine = await tx.fine.findUnique({ where: { number: data.fineNumber } });
    if (!fine || fine.status !== RecordStatus.ACTIVE) {
      throw new Error(`Штраф ${data.fineNumber} не найден или уже закрыт`);
    }
    const now = new Date();
    const updated = await tx.fine.update({
      where: { id: fine.id },
      data: {
        status: RecordStatus.CLOSED,
        paidAt: now,
        paidByDiscordId: data.paidByDiscordId,
      },
    });
    return { entityId: fine.id, before: { status: fine.status }, after: updated, result: updated };
  });
}

export async function cancelFine(id: string, context: AuditContext) {
  return auditedMutation(context, "fine.revoked", "fine", async (tx) => {
    const fine = await tx.fine.findUnique({ where: { id } });
    if (!fine || fine.status !== RecordStatus.ACTIVE) {
      throw new Error("Штраф не найден или не активен");
    }
    const updated = await tx.fine.update({
      where: { id },
      data: { status: RecordStatus.REVOKED },
    });
    return { entityId: id, before: { status: fine.status }, after: updated, result: updated };
  });
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

export async function getFineByNumber(number: string) {
  return prisma.fine.findUnique({ where: { number } });
}

export interface ListFinesFilter {
  staticId?: string;
  factionCode?: string;
  status?: RecordStatus;
  overdueOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listFines(filter: ListFinesFilter = {}) {
  const now = new Date();
  const where = {
    ...(filter.staticId ? { staticId: filter.staticId } : {}),
    ...(filter.factionCode ? { factionCode: filter.factionCode } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.overdueOnly ? { status: RecordStatus.ACTIVE, dueAt: { lte: now } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.fine.count({ where }),
    prisma.fine.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
  ]);
  return { total, items };
}
