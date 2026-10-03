/**
 * Document module: /пост and /ответ.
 *
 * Document numbers are user-provided (legacy /пост «номер»), unique globally.
 * The TTL is read from system settings.
 *
 * Slash/field names match the legacy Python bot (main.py / embeds.py):
 * номер, уведомляемое_лицо, ссылка_на_форум, ответственный_лидер, ответственный_зам;
 * for replies: личное_дело, видеофиксация, комментарий.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { type Db } from "./db.js";
import { getSetting } from "./settings.js";
import { recordNumberSchema } from "./text.js";
import { UserError } from "./errors.js";

// ──────────────────────────────────────────────────────────────
// Input schemas
// ──────────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  number: recordNumberSchema,
  factionCode: z.string().min(1).max(32),
  authorDiscordId: z.string().min(1),
  subject: z.string().min(1).max(256),
  content: z.string().min(1).max(4000),
  notifiedPerson: z.string().min(1).max(256),
  forumLink: z.string().min(1).max(1000),
  leaderText: z.string().min(1).max(256),
  deputyText: z.string().min(1).max(256),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const createDocumentResponseSchema = z.object({
  documentNumber: z.string().min(1),
  authorDiscordId: z.string().min(1),
  personalFile: z.string().min(1).max(1000),
  video: z.string().min(1).max(1000),
  /** Комментарий (legacy /ответ) */
  content: z.string().min(1).max(4000),
});
export type CreateDocumentResponseInput = z.infer<typeof createDocumentResponseSchema>;

// ──────────────────────────────────────────────────────────────
// Number helpers (unused by /пост; kept for optional future flows)
// ──────────────────────────────────────────────────────────────

/** @deprecated /пост uses a user-provided number; kept for other flows if needed. */
export async function nextDocumentNumber(factionCode: string, db: Db = prisma): Promise<string> {
  const prefix = `${factionCode}-`;
  const last = await db.document.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  let seq = 1;
  if (last) {
    const n = Number.parseInt(last.number.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

export async function createDocument(input: CreateDocumentInput, context: AuditContext) {
  const data = createDocumentSchema.parse(input);
  const ttlHours = await getSetting("documents.ttlHours");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  return auditedMutation(context, "document.created", "document", async (tx) => {
    const existing = await tx.document.findUnique({ where: { number: data.number } });
    if (existing) {
      throw new UserError("Документ уже существует.");
    }

    const doc = await tx.document.create({
      data: {
        number: data.number,
        factionCode: data.factionCode,
        authorDiscordId: data.authorDiscordId,
        subject: data.subject,
        content: data.content,
        notifiedPerson: data.notifiedPerson,
        forumLink: data.forumLink,
        leaderText: data.leaderText,
        deputyText: data.deputyText,
        expiresAt,
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: doc.id, after: doc, result: doc };
  });
}

export async function createDocumentResponse(input: CreateDocumentResponseInput, context: AuditContext) {
  const data = createDocumentResponseSchema.parse(input);

  return auditedMutation(context, "document_response.created", "document_response", async (tx) => {
    const doc = await tx.document.findUnique({ where: { number: data.documentNumber } });
    if (!doc || doc.status !== RecordStatus.ACTIVE) {
      throw new UserError(`Документ ${data.documentNumber} не найден или не активен`);
    }

    const response = await tx.documentResponse.create({
      data: {
        documentId: doc.id,
        authorDiscordId: data.authorDiscordId,
        personalFile: data.personalFile,
        video: data.video,
        content: data.content,
        status: RecordStatus.ACTIVE,
      },
    });
    // After a successful /ответ the registry shows «Отправлено» (CLOSED).
    const updatedDoc = await tx.document.update({
      where: { id: doc.id },
      data: { status: RecordStatus.CLOSED },
    });
    return {
      entityId: response.id,
      before: { documentStatus: doc.status },
      after: { response, document: updatedDoc },
      result: { response, document: updatedDoc },
    };
  });
}

export async function expireDocuments() {
  const now = new Date();
  const { count } = await prisma.document.updateMany({
    where: { status: RecordStatus.ACTIVE, expiresAt: { lte: now } },
    data: { status: RecordStatus.EXPIRED },
  });
  return count;
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

export async function getDocumentByNumber(number: string) {
  return prisma.document.findUnique({
    where: { number },
    include: { responses: { where: { status: RecordStatus.ACTIVE }, orderBy: { createdAt: "asc" } } },
  });
}

export interface ListDocumentsFilter {
  factionCode?: string;
  status?: RecordStatus;
  authorDiscordId?: string;
  limit?: number;
  offset?: number;
}

export async function listDocuments(filter: ListDocumentsFilter = {}) {
  const where = {
    ...(filter.factionCode ? { factionCode: filter.factionCode } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.authorDiscordId ? { authorDiscordId: filter.authorDiscordId } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
  ]);
  return { total, items };
}
