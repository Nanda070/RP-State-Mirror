import { listMessageDesigns, listSentMessages, type EmbedSpec } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { EmbedManager } from "@/components/embed-manager";
import { getActiveChannelOptions, getActiveGuildOptions, getActiveRoleOptions } from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsEmbedsPage() {
  await requireSystemSettingsPage();

  const [embedDesigns, sent, guilds, channels, roles, forms] = await Promise.all([
    listMessageDesigns(false),
    listSentMessages(40),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
    getActiveRoleOptions(),
    prisma.discordForm.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const embedDesignIds = new Set(embedDesigns.map((d) => d.id));
  // Only deliveries tied to embed templates — not ad-hoc module notifications.
  const embedSent = sent.filter((s) => Boolean(s.designId && embedDesignIds.has(s.designId)));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Эмбеды</h1>
        <p className="muted">Сообщения от имени бота: составить, посмотреть, отправить в канал.</p>
      </div>

      <EmbedManager
        initialDesigns={embedDesigns.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          spec: d.spec as EmbedSpec,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        initialSent={embedSent.map((s) => ({
          id: s.id,
          guildDiscordId: s.guildDiscordId,
          channelDiscordId: s.channelDiscordId,
          messageDiscordId: s.messageDiscordId,
          design: s.design,
          createdAt: s.createdAt.toISOString(),
        }))}
        guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
        roles={roles
          .filter((role) => role.name !== "@everyone")
          .map((role) => ({ discordId: role.discordId, name: role.name, guildName: role.guild.name }))}
        forms={forms}
      />
    </div>
  );
}
