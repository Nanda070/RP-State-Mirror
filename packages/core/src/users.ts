import { AuditActorType, prisma } from "@mirror/db";
import { auditedMutation, type AuditContext } from "./audit.js";

export async function ensureUserByDiscordId(
  discordId: string,
  context: AuditContext = { actorType: AuditActorType.SYSTEM, source: "auth" },
) {
  const existing = await prisma.user.findUnique({ where: { discordId } });
  if (existing) return { user: existing, created: false };

  const user = await auditedMutation(context, "user.created", "user", async (tx) => {
    const created = await tx.user.create({ data: { discordId } });
    return { entityId: created.id, after: { discordId }, result: created };
  });
  return { user, created: true };
}
