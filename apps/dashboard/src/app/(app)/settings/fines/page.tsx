import { getSettings } from "@mirror/core";
import { prisma } from "@mirror/db";
import Link from "next/link";
import { SettingsFinesForm } from "@/components/settings-module-form";
import { getActiveChannelOptions, getRolesForGuild } from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsFinesPage() {
  await requireSystemSettingsPage();

  const [settings, fineCount, channels] = await Promise.all([
    getSettings([
      "fines.dueDays",
      "fines.channelId",
      "fines.pingRoleIds",
      "core.incidentGuildId",
    ] as const),
    prisma.fine.count(),
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
          <span>Штрафы</span>
        </p>
        <h1>Штрафы</h1>
        <p className="muted">
          Команды <code>/штраф</code> и <code>/штраф-оплачено</code>, публикация на сервере ЧП,
          реестр.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/fines" className="btn btn-secondary">
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
            <span className="status-dot" data-ok={Boolean(incidentGuildId)} />
            Сервер ЧП
            <strong>{incidentGuildId ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={Boolean(settings["fines.channelId"])} />
            Канал штрафов
            <strong>{settings["fines.channelId"] ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{fineCount.toLocaleString("ru-RU")}</strong>
          </li>
        </ul>
      </div>

      <SettingsFinesForm
        initialDueDays={settings["fines.dueDays"]}
        initialChannelId={settings["fines.channelId"]}
        initialPingRoleIds={settings["fines.pingRoleIds"]}
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
