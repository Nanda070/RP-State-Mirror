import { PERSONNEL_EVENT_TYPES, createPersonnelEvent, enqueuePersonnelPublish, getActiveFactionByCode, UserError } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireModuleManager } from "@/lib/session";

const bodySchema = z.object({
  type: z.enum(PERSONNEL_EVENT_TYPES),
  factionCode: z.string().trim().min(1).max(32),
  subjectDiscordId: z.string().trim().regex(/^\d{17,20}$/, "Discord ID — это число из 17–20 цифр"),
  subjectName: z.string().trim().min(1).max(128),
  details: z.record(z.unknown()),
});

/** New personnel event from the dashboard: saved and published exactly as `/кадровый-аудит` does. */
export async function POST(request: Request) {
  try {
    const { session } = await requireModuleManager();
    const body = bodySchema.parse(await request.json());
    const faction = await getActiveFactionByCode(body.factionCode);
    if (!faction) throw new UserError("Фракция не найдена или не активна.");
    const event = await createPersonnelEvent(
      { ...body, factionCode: faction.code, actorDiscordId: session.user.discordId },
      await dashboardAuditContext(session.user.id),
    );
    await enqueuePersonnelPublish(event.id);
    return Response.json({ ok: true, message: `Событие по сотруднику ${event.subjectName} создано.` }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
