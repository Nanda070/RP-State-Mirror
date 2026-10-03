import { getSettings } from "@mirror/core";
import { prisma } from "@mirror/db";
import Link from "next/link";
import { SettingsWantedForm } from "@/components/settings-module-form";
import { getActiveChannelOptions, getRolesForGuild } from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsWantedPage() {
  await requireSystemSettingsPage();

  const [settings, wantedCount, channels] = await Promise.all([
    getSettings([
      "wanted.enabled",
      "wanted.channelId",
      "wanted.pingRoleIds",
      "wanted.coordinatorRoleIds",
      "core.incidentGuildId",
    ] as const),
    prisma.wanted.count(),
    getActiveChannelOptions(),
  ]);

  const incidentGuildId = settings["core.incidentGuildId"];
  const incidentRoles = incidentGuildId ? await getRolesForGuild(incidentGuildId) : [];

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Розыск</span>
        </p>
        <h1>Розыск</h1>
        <p className="muted">
          Команды <code>/объявить-розыск</code> и <code>/розыск-исполнено</code>, публикация на
          сервере ЧП, реестр.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/wanted" className="btn btn-secondary">
            Открыть реестр
          </Link>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Состояние
        </h2>
        <ul className="status-list">
          <li>
            <span className="status-dot" data-ok={settings["wanted.enabled"]} />
            Модуль
            <strong>{settings["wanted.enabled"] ? "включён" : "выключен"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={Boolean(incidentGuildId)} />
            Сервер ЧП
            <strong>{incidentGuildId ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={Boolean(settings["wanted.channelId"])} />
            Канал розыска
            <strong>{settings["wanted.channelId"] ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{wantedCount.toLocaleString("ru-RU")}</strong>
          </li>
        </ul>
      </div>

      <SettingsWantedForm
        initialEnabled={settings["wanted.enabled"]}
        initialChannelId={settings["wanted.channelId"]}
        initialPingRoleIds={settings["wanted.pingRoleIds"]}
        initialCoordinatorRoleIds={settings["wanted.coordinatorRoleIds"]}
        incidentGuildId={incidentGuildId}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
        roles={incidentRoles}
      />
    </div>
  );
}
