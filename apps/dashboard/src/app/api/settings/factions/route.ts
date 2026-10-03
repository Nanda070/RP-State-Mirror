import { listActiveFactions, updateFactionDeliverySettings } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const putSchema = z.object({
  factionCode: z.string().min(1).max(32),
  documentsChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  personnelChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  documentsWebhookUrl: z.string().url().nullable().or(z.literal("")).optional(),
  personnelWebhookUrl: z.string().url().nullable().or(z.literal("")).optional(),
  guildDiscordId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const factions = await listActiveFactions();
    return Response.json({
      factions: factions.map((f) => ({
        code: f.code,
        name: f.name,
        color: f.color,
        guildDiscordId: f.guild?.discordId ?? null,
        guildName: f.guild?.name ?? null,
        settings: f.settings,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = putSchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);
    const updated = await updateFactionDeliverySettings(
      {
        factionCode: body.factionCode,
        documentsChannelId: body.documentsChannelId,
        personnelChannelId: body.personnelChannelId,
        documentsWebhookUrl:
          body.documentsWebhookUrl === "" ? null : body.documentsWebhookUrl,
        personnelWebhookUrl:
          body.personnelWebhookUrl === "" ? null : body.personnelWebhookUrl,
        guildDiscordId: body.guildDiscordId,
      },
      ctx,
    );
    return Response.json({
      code: updated.code,
      settings: updated.settings,
      guildDiscordId: updated.guild?.discordId ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
