import { listActiveChannels } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { requireSystemSettings } from "@/lib/session";

const querySchema = z.object({
  guildId: z.string().regex(/^\d{17,20}$/).optional(),
});

export async function GET(request: Request) {
  try {
    await requireSystemSettings();
    const url = new URL(request.url);
    const { guildId } = querySchema.parse({
      guildId: url.searchParams.get("guildId") ?? undefined,
    });
    const channels = await listActiveChannels(guildId);
    return Response.json({
      channels: channels.map((c) => ({
        discordId: c.discordId,
        name: c.name,
        type: c.type,
        guildDiscordId: c.guild.discordId,
        guildName: c.guild.name,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
