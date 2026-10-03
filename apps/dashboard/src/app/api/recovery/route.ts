import { createAccountRecovery, listAccountRecoveriesFor } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSession } from "@/lib/session";

const createSchema = z.object({
  oldDiscordId: z.string(),
  characterName: z.string(),
  staticId: z.string(),
  reason: z.string(),
});

export async function GET() {
  try {
    const session = await requireSession();
    return Response.json({ requests: await listAccountRecoveriesFor(session.user.discordId) });
  } catch (error) {
    return jsonError(error);
  }
}

/** The new account is always the signed-in one; it is never taken from the request body. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = createSchema.parse(await request.json());
    const created = await createAccountRecovery(
      { ...body, newDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ request: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
