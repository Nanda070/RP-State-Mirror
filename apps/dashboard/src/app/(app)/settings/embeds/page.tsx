import {
  isButtonPanelSpec,
  listMessageDesigns,
  listSentMessages,
  type EmbedSpec,
} from "@mirror/core";
import Link from "next/link";
import { EmbedManagerLazy } from "@/components/embed-manager-lazy";
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

  const embedDesigns = designs.filter((d) => !isButtonPanelSpec(d.spec as EmbedSpec));
  const embedDesignIds = new Set(embedDesigns.map((d) => d.id));
  const embedSent = sent.filter(
    (s) =>
      (s.designId && embedDesignIds.has(s.designId)) ||
      (!s.designId && !isButtonPanelSpec(s.spec as EmbedSpec)),
  );

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
          выбранного сервера. Панели кнопок — отдельно в разделе «Кнопки».
        </p>
        <div className="row" style={{ marginTop: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/buttons" className="btn btn-secondary">
            К кнопкам
          </Link>
        </div>
      </div>

      <EmbedManagerLazy
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
