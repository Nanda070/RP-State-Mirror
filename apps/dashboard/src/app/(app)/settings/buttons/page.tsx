import {
  isButtonPanelSpec,
  listMessageDesigns,
  listSentMessages,
  type EmbedSpec,
} from "@mirror/core";
import Link from "next/link";
import { ButtonManager } from "@/components/button-manager";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getActiveRoleOptions,
} from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsButtonsPage() {
  await requireSystemSettingsPage();

  const [designs, sent, guilds, channels, roles] = await Promise.all([
    listMessageDesigns(false),
    listSentMessages(40),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
    getActiveRoleOptions(),
  ]);

  const buttonDesigns = designs.filter((d) => isButtonPanelSpec(d.spec));
  const buttonDesignIds = new Set(buttonDesigns.map((d) => d.id));
  const buttonSent = sent.filter((s) => Boolean(s.designId && buttonDesignIds.has(s.designId)));

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Кнопки</span>
        </p>
        <h1>Кнопки</h1>
        <p className="muted">
          Панели role.toggle и callback: настройка кнопок, превью, сохранение и отправка ботом.
          Действия пишутся в button_actions при материализации.
        </p>
        <div className="row" style={{ marginTop: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/embeds" className="btn btn-secondary">
            К эмбедам
          </Link>
        </div>
      </div>

      <ButtonManager
        initialDesigns={buttonDesigns.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          spec: d.spec as EmbedSpec,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        initialSent={buttonSent.map((s) => ({
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
        roles={roles.map((r) => ({
          discordId: r.discordId,
          name: r.name,
          guildDiscordId: r.guild.discordId,
        }))}
      />
    </div>
  );
}
