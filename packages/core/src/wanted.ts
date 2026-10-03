/**
 * Federal wanted module: /объявить-розыск and /розыск-исполнено.
 *
 * Wanted numbers are sequential global counters: W-001, W-002, …
 * Closing a wanted stores who closed it and the evidence text,
 * then the bot edits the original webhook message via a job.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { type Db } from "./db.js";

// ──────────────────────────────────────────────────────────────
// Input schemas
// ──────────────────────────────────────────────────────────────

export const createWantedSchema = z.object({
  staticId: z.string().min(1).max(32),
  characterName: z.string().min(1).max(128),
  reason: z.string().min(1).max(2000),
  issuedByDiscordId: z.string().min(1),
});
export type CreateWantedInput = z.infer<typeof createWantedSchema>;

export const closeWantedSchema = z.object({
  wantedNumber: z.string().min(1),
  closedByDiscordId: z.string().min(1),
  evidence: z.string().min(1).max(2000),
});
export type CloseWantedInput = z.infer<typeof closeWantedSchema>;

// ──────────────────────────────────────────────────────────────
// Number generation
// ──────────────────────────────────────────────────────────────

async function nextWantedNumber(db: Db): Promise<string> {
  const last = await db.wanted.findFirst({
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  let seq = 1;
  if (last) {
    const n = Number.parseInt(last.number.replace(/^W-/, ""), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `W-${String(seq).padStart(3, "0")}`;
}

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

export async function createWanted(input: CreateWantedInput, context: AuditContext) {
  const data = createWantedSchema.parse(input);

  return auditedMutation(context, "wanted.created", "wanted", async (tx) => {
    const number = await nextWantedNumber(tx);
    const wanted = await tx.wanted.create({
      data: {
        number,
        staticId: data.staticId,
        characterName: data.characterName,
        reason: data.reason,
        issuedByDiscordId: data.issuedByDiscordId,
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: wanted.id, after: wanted, result: wanted };
  });
}

export async function closeWanted(input: CloseWantedInput, context: AuditContext) {
  const data = closeWantedSchema.parse(input);

  return auditedMutation(context, "wanted.closed", "wanted", async (tx) => {
    const wanted = await tx.wanted.findUnique({ where: { number: data.wantedNumber } });
    if (!wanted || wanted.status !== RecordStatus.ACTIVE) {
      throw new Error(`Розыск ${data.wantedNumber} не найден или уже закрыт`);
    }

    const updated = await tx.wanted.update({
      where: { id: wanted.id },
      data: {
        status: RecordStatus.CLOSED,
        closedByDiscordId: data.closedByDiscordId,
        evidence: data.evidence,
      },
    });
    return { entityId: wanted.id, before: { status: wanted.status }, after: updated, result: updated };
  });
}

export async function cancelWanted(id: string, context: AuditContext) {
  return auditedMutation(context, "wanted.revoked", "wanted", async (tx) => {
    const wanted = await tx.wanted.findUnique({ where: { id } });
    if (!wanted || wanted.status !== RecordStatus.ACTIVE) {
      throw new Error("Розыск не найден или не активен");
    }
    const updated = await tx.wanted.update({
      where: { id },
      data: { status: RecordStatus.REVOKED },
    });
    return { entityId: id, before: { status: wanted.status }, after: updated, result: updated };
  });
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

export async function getWantedByNumber(number: string) {
  return prisma.wanted.findUnique({ where: { number } });
}

export interface ListWantedFilter {
  staticId?: string;
  status?: RecordStatus;
  limit?: number;
  offset?: number;
}

export async function listWanted(filter: ListWantedFilter = {}) {
  const where = {
    ...(filter.staticId ? { staticId: filter.staticId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.wanted.count({ where }),
    prisma.wanted.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
  ]);
  return { total, items };
}
