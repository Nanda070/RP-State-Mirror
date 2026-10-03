import { getSettings } from "@mirror/core";
import Link from "next/link";
import { SettingsCpForm } from "@/components/settings-cp-form";
import { SettingsLockdownForm } from "@/components/settings-lockdown-form";
import { SettingsMonitoringForm } from "@/components/settings-monitoring-form";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getRolesForGuild,
} from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscow } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsSystemPage() {
  await requireSystemSettingsPage();

  const [guilds, settings, channels] = await Promise.all([
    getActiveGuildOptions(),
    getSettings([
      "core.mainGuildId",
      "core.incidentGuildId",
      "cp.syncEnabled",
      "cp.excludedRoleIds",
      "cp.logChannelId",
      "cp.maxKickPercent",
      "cp.dryRun",
      "system.lockdown",
      "monitoring.errorChannelId",
      "monitoring.alertWebhookUrl",
      "audit.archiveAfterDays",
    ] as const),
    getActiveChannelOptions(),
  ]);

  const incidentRoles = settings["core.incidentGuildId"]
    ? await getRolesForGuild(settings["core.incidentGuildId"])
    : [];

  const lockdown = settings["system.lockdown"];
  const lockdownBy = lockdown.byDiscordId
    ? ((await resolveAuthorLabels([lockdown.byDiscordId])).get(lockdown.byDiscordId) ?? lockdown.byDiscordId)
    : null;
  const channelOptions = channels.map((c) => ({
    discordId: c.discordId,
    name: c.name,
    guildDiscordId: c.guild.discordId,
    guildName: c.guild.name,
  }));

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Система</span>
        </p>
        <h1>Система</h1>
        <p className="muted">
          Главный сервер, сервер ЧП, синхронизация ролей, аварийная блокировка и мониторинг. Изменения
          пишутся в журнал аудита.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/settings/roles" className="btn btn-secondary">
            К привязке ролей
          </Link>
          <Link href="/settings/factions" className="btn btn-secondary">
            Каналы фракций
          </Link>
          <Link href="/settings/admin-roles" className="btn btn-secondary">
            Admin-роли
          </Link>
          <Link href="/settings/sessions" className="btn btn-secondary">
            Сессии
          </Link>
          <Link href="/status" className="btn btn-secondary">
            Статус системы
          </Link>
        </div>
      </div>
      <SettingsLockdownForm
        initialEnabled={lockdown.enabled}
        initialReason={lockdown.reason}
        changedBy={lockdownBy}
        changedAt={lockdown.at ? formatMoscow(lockdown.at) : null}
      />
      <SettingsGuildForm
        guilds={guilds.map((g) => ({
          discordId: g.discordId,
          name: g.name,
          iconUrl: g.iconUrl,
          lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
        }))}
        initialMain={settings["core.mainGuildId"]}
        initialIncident={settings["core.incidentGuildId"]}
      />
      <SettingsCpForm
        initialEnabled={settings["cp.syncEnabled"]}
        initialExcludedRoleIds={settings["cp.excludedRoleIds"]}
        initialLogChannelId={settings["cp.logChannelId"]}
        initialMaxKickPercent={settings["cp.maxKickPercent"]}
        initialDryRun={settings["cp.dryRun"]}
        incidentGuildId={settings["core.incidentGuildId"]}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
        roles={incidentRoles}
      />
      <SettingsMonitoringForm
        initialErrorChannelId={settings["monitoring.errorChannelId"]}
        initialAlertWebhookUrl={settings["monitoring.alertWebhookUrl"]}
        initialArchiveAfterDays={settings["audit.archiveAfterDays"]}
        channels={channelOptions}
      />
    </div>
  );
}
