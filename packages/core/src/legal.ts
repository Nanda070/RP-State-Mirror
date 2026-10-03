/**
 * Legal texts with versions (PLAN §8) and the record of who accepted which version.
 *
 * The site ships with built-in texts. When the super admin publishes a text in the dashboard, that
 * text replaces the built-in one for its page; earlier versions stay as history. The «current
 * version» of the terms as a whole is the newest date among the built-in edition and everything
 * published — when it changes, users are asked to accept again.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

export const LEGAL_KINDS = ["terms", "privacy", "cookies"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const LEGAL_KIND_TITLES: Record<LegalKind, string> = {
  terms: "Условия использования",
  privacy: "Политика конфиденциальности",
  cookies: "Cookie",
};

export class LegalError extends UserError {
  override name = "LegalError";
}

const moscowDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" });

/** The text the site shows for this page, or null when the built-in one is in use. */
export async function getPublishedLegal(kind: LegalKind) {
  return prisma.legalDocument.findFirst({ where: { kind, status: RecordStatus.ACTIVE } });
}

export async function listLegalVersions(kind: LegalKind) {
  return prisma.legalDocument.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, take: 50 });
}

export const publishLegalSchema = z.object({
  kind: z.enum(LEGAL_KINDS),
  body: z.string().trim().min(50, "Текст слишком короткий").max(60_000),
  createdByDiscordId: z.string().min(1).max(32),
});

/** Publishes a new edition: the previous one goes to history, the version is today's Moscow date. */
export async function publishLegalDocument(input: z.input<typeof publishLegalSchema>, context: AuditContext) {
  const data = publishLegalSchema.parse(input);
  return auditedMutation(context, "legal.published", "legal_document", async (tx) => {
    const previous = await tx.legalDocument.findFirst({ where: { kind: data.kind, status: RecordStatus.ACTIVE } });
    if (previous?.body.trim() === data.body) throw new LegalError("Текст не изменился.");
    const day = moscowDay.format(new Date());
    const sameDay = await tx.legalDocument.count({ where: { kind: data.kind, version: { startsWith: day } } });
    if (previous) {
      await tx.legalDocument.update({ where: { id: previous.id }, data: { status: RecordStatus.ARCHIVED } });
    }
    const document = await tx.legalDocument.create({
      data: { ...data, version: sameDay === 0 ? day : `${day}.${sameDay + 1}` },
    });
    return {
      entityId: document.id,
      before: previous ? { version: previous.version } : undefined,
      after: { kind: document.kind, version: document.version },
      result: document,
    };
  });
}

/** Returns the page to the built-in text; the published editions stay in history. */
export async function unpublishLegalDocument(kind: LegalKind, context: AuditContext) {
  return auditedMutation(context, "legal.unpublished", "legal_document", async (tx) => {
    const current = await tx.legalDocument.findFirst({ where: { kind, status: RecordStatus.ACTIVE } });
    if (!current) throw new LegalError("Для этой страницы используется встроенный текст.");
    await tx.legalDocument.update({ where: { id: current.id }, data: { status: RecordStatus.ARCHIVED } });
    return { entityId: current.id, before: { version: current.version }, after: { status: "ARCHIVED" }, result: true };
  });
}

/**
 * Version of the terms as a whole: the newest edition date among the built-in texts and whatever
 * is published. Version strings start with a date (YYYY-MM-DD), so they compare as text.
 */
export async function currentLegalVersion(builtInVersion: string): Promise<string> {
  const published = await prisma.legalDocument.findMany({
    where: { status: RecordStatus.ACTIVE },
    select: { version: true },
  });
  return [builtInVersion, ...published.map((document) => document.version)].sort().at(-1) ?? builtInVersion;
}

export async function recordLegalConsent(discordId: string, version: string) {
  await prisma.legalConsent.upsert({
    where: { discordId_version: { discordId, version } },
    create: { discordId, version },
    update: {},
  });
}

export async function hasLegalConsent(discordId: string, version: string): Promise<boolean> {
  return (await prisma.legalConsent.count({ where: { discordId, version } })) > 0;
}

/**
 * Where a user stands with the edition in force: accepted it, accepted only an older one, or has
 * no record at all (signed in before acceptance was recorded — signing in was the acceptance).
 */
export async function legalConsentState(discordId: string, version: string): Promise<"accepted" | "outdated" | "none"> {
  const rows = await prisma.legalConsent.findMany({ where: { discordId }, select: { version: true } });
  if (rows.length === 0) return "none";
  return rows.some((row) => row.version === version) ? "accepted" : "outdated";
}
