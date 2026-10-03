import { canViewModules } from "@mirror/core";
import { DecisionStatus, RecordStatus, RegistrationKind } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { listRegistrations } from "@/lib/registrations";
import { ForbiddenError, requireSession, resolveFreshIdentity } from "@/lib/session";

const querySchema = z.object({
  kind: z.nativeEnum(RegistrationKind),
  decision: z.nativeEnum(DecisionStatus).optional(),
  status: z.nativeEnum(RecordStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const identity = await resolveFreshIdentity(session.user.discordId);
    if (!canViewModules(identity)) {
      throw new ForbiddenError("Недостаточно прав для просмотра реестра регистраций");
    }

    const url = new URL(request.url);
    const parsed = querySchema.parse({
      kind: url.searchParams.get("kind") ?? undefined,
      decision: url.searchParams.get("decision") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const { total, items } = await listRegistrations({
      kind: parsed.kind,
      ...(parsed.decision !== undefined ? { decision: parsed.decision } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      ...(parsed.offset !== undefined ? { offset: parsed.offset } : {}),
    });
    return Response.json({
      total,
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        decidedAt: item.decidedAt?.toISOString() ?? null,
        expiresAt: item.expiresAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
