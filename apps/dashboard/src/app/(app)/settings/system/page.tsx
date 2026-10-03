import { getSettings } from "@mirror/core";
import Link from "next/link";
import { SettingsCpForm } from "@/components/settings-cp-form";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getRolesForGuild,
} from "@/lib/catalog";
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
    ] as const),
    getActiveChannelOptions(),
  ]);

  const incidentRoles = settings["core.incidentGuildId"]
    ? await getRolesForGuild(settings["core.incidentGuildId"])
    : [];

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
          Главный сервер, сервер ЧП и синхронизация ролей. Изменения пишутся в журнал аудита.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/settings/roles" className="btn btn-secondary">
            К привязке ролей
          </Link>
          <Link href="/settings/factions" className="btn btn-secondary">
            Каналы фракций
          </Link>
        </div>
      </div>
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
    </div>
  );
}
