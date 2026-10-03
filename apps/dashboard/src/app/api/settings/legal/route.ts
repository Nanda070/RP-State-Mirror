import { LEGAL_KINDS, publishLegalDocument, unpublishLegalDocument } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const publishSchema = z.object({ kind: z.enum(LEGAL_KINDS), body: z.string() });
const kindSchema = z.object({ kind: z.enum(LEGAL_KINDS) });

/** Publishes a new edition of a legal text. */
export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = publishSchema.parse(await request.json());
    const document = await publishLegalDocument(
      { ...body, createdByDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ version: document.version }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

/** Returns a page to its built-in text. */
export async function DELETE(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const { kind } = kindSchema.parse(await request.json());
    await unpublishLegalDocument(kind, await dashboardAuditContext(session.user.id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
