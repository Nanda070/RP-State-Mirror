import { listActiveFactions } from "@mirror/core";
import Link from "next/link";
import { SettingsFactionsForm } from "@/components/settings-factions-form";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getActiveRoleOptions,
} from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsFactionsPage() {
  await requireSystemSettingsPage();

  const [factions, guilds, channels, roles] = await Promise.all([
    listActiveFactions(),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
    getActiveRoleOptions(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Фракции</span>
        </p>
        <h1>Каналы фракций</h1>
        <p className="muted">
          Каналы, вебхуки документов / кадрового аудита и роль старшего состава для пинга.
          Доставка slash-команд читает эти настройки — без хардкода ID в коде.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
        </div>
      </div>

      <SettingsFactionsForm
        initialFactions={factions.map((f) => ({
          code: f.code,
          name: f.name,
          color: f.color,
          guildDiscordId: f.guild?.discordId ?? null,
          guildName: f.guild?.name ?? null,
          settings: f.settings,
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
