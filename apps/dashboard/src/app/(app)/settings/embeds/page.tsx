import {
  isButtonPanelSpec,
  listMessageDesigns,
  listSentMessages,
  type EmbedSpec,
} from "@mirror/core";
import Link from "next/link";
import { EmbedManager } from "@/components/embed-manager";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
} from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsEmbedsPage() {
  await requireSystemSettingsPage();

  const [designs, sent, guilds, channels] = await Promise.all([
    listMessageDesigns(false),
    listSentMessages(40),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
  ]);

  const embedDesigns = designs.filter((d) => !isButtonPanelSpec(d.spec));
  const embedDesignIds = new Set(embedDesigns.map((d) => d.id));
  // Only deliveries tied to embed templates — not ad-hoc module notifications.
  const embedSent = sent.filter((s) => Boolean(s.designId && embedDesignIds.has(s.designId)));

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Эмбеды</span>
        </p>
        <h1>Эмбеды</h1>
        <p className="muted">
          Конструктор Classic / Components V2: превью, сохранение, архив и отправка ботом в канал
          выбранного сервера.
        </p>
        <div className="status-link-row">
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/forms" className="stub-link">
            К формам
          </Link>
        </div>
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
      />
    </div>
  );
}
