/**
 * Fines module: /штраф and /штраф-оплачено.
 *
 * Fine numbers are user-provided (legacy «номер»), unique globally.
 * Due date is parsed from legacy-style срок_оплаты (1m / 24h / 14d).
 *
 * Legacy fields: фракция, номер, фио, паспорт, статья, сумма, срок_оплаты.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { type Db } from "./db.js";
import { recordNumberSchema } from "./text.js";

// ──────────────────────────────────────────────────────────────
// Duration helper (legacy utils.parse_duration + days)
// ──────────────────────────────────────────────────────────────

const DURATION_RE = /^(\d+)([mhd])$/i;

/** Parse «1m», «24h», «14d» into milliseconds. */
export function parsePaymentDeadline(value: string): { ms: number; text: string } {
  const trimmed = value.trim();
  const match = DURATION_RE.exec(trimmed);
  if (!match) {
    throw new Error("Формат срока оплаты: 1m, 24h или 14d");
  }
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const ms =
    unit === "m" ? amount * 60_000 : unit === "h" ? amount * 3_600_000 : amount * 86_400_000;
  return { ms, text: `${amount}${unit}` };
}

// ──────────────────────────────────────────────────────────────
// Input schemas
// ──────────────────────────────────────────────────────────────

export const createFineSchema = z.object({
  number: recordNumberSchema,
  /** Паспорт / статик */
  staticId: z.string().min(1).max(32),
  /** ФИО */
  characterName: z.string().min(1).max(128),
  amount: z.number().int().positive(),
  /** Статья */
  reason: z.string().min(1).max(2000),
  issuedByDiscordId: z.string().min(1),
  factionCode: z.string().min(1).max(32),
  /** Срок оплаты as entered (1m / 24h / 14d) */
  paymentDeadlineText: z.string().min(1).max(32),
});
export type CreateFineInput = z.infer<typeof createFineSchema>;

export const markFinePaidSchema = z.object({
  fineNumber: z.string().min(1),
  paidByDiscordId: z.string().min(1),
});
export type MarkFinePaidInput = z.infer<typeof markFinePaidSchema>;

// ──────────────────────────────────────────────────────────────
// Number helpers (unused by /штраф; kept for optional flows)
// ──────────────────────────────────────────────────────────────

/** @deprecated /штраф uses a user-provided number. */
export async function nextFineNumber(db: Db = prisma): Promise<string> {
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
  const deadline = parsePaymentDeadline(data.paymentDeadlineText);
  const dueAt = new Date(Date.now() + deadline.ms);

  return auditedMutation(context, "fine.created", "fine", async (tx) => {
    const existing = await tx.fine.findUnique({ where: { number: data.number } });
    if (existing) {
      throw new Error("Штраф уже есть.");
    }

    const fine = await tx.fine.create({
      data: {
        number: data.number,
        staticId: data.staticId,
        characterName: data.characterName,
        amount: data.amount,
        reason: data.reason,
        issuedByDiscordId: data.issuedByDiscordId,
        factionCode: data.factionCode,
        paymentDeadlineText: deadline.text,
        dueAt,
        overdueNotified: false,
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
