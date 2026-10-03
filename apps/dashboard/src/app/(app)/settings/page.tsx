import { getSettings } from "@mirror/core";
import { PageTabs, currentTab } from "@/components/page-tabs";
import { SettingsCpForm } from "@/components/settings-cp-form";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import { SettingsLockdownForm } from "@/components/settings-lockdown-form";
import { SettingsMonitoringForm } from "@/components/settings-monitoring-form";
import { getActiveChannelOptions, getActiveGuildOptions, getRolesForGuild } from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscow } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Настройки" };

const TABS = [
  { key: "servers", label: "Серверы и синхронизация", icon: "server" },
  { key: "safety", label: "Защита и мониторинг", icon: "shield" },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSystemSettingsPage();
  const tab = currentTab(TABS, (await searchParams).tab);

  const [settings, channels] = await Promise.all([
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
  const channelOptions = channels.map((channel) => ({
    discordId: channel.discordId,
    name: channel.name,
    guildDiscordId: channel.guild.discordId,
    guildName: channel.guild.name,
  }));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Настройки</h1>
      </div>
      <PageTabs path="/settings" tabs={TABS} current={tab} />
      {tab === "servers" ? <ServersTab settings={settings} channels={channelOptions} /> : null}
      {tab === "safety" ? <SafetyTab settings={settings} channels={channelOptions} /> : null}
    </div>
  );
}

type Settings = Awaited<
  ReturnType<
    typeof getSettings<
      readonly [
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
      ]
    >
  >
>;
type Channels = { discordId: string; name: string; guildDiscordId: string; guildName: string }[];

async function ServersTab({ settings, channels }: { settings: Settings; channels: Channels }) {
  const guilds = await getActiveGuildOptions();
  const incidentGuildId = settings["core.incidentGuildId"];
  const incidentRoles = incidentGuildId ? await getRolesForGuild(incidentGuildId) : [];
  return (
    <>
      <SettingsGuildForm
        guilds={guilds.map((guild) => ({
          discordId: guild.discordId,
          name: guild.name,
          iconUrl: guild.iconUrl,
          lastSyncedAt: guild.lastSyncedAt?.toISOString() ?? null,
        }))}
        initialMain={settings["core.mainGuildId"]}
        initialIncident={incidentGuildId}
      />
      <SettingsCpForm
        initialEnabled={settings["cp.syncEnabled"]}
        initialExcludedRoleIds={settings["cp.excludedRoleIds"]}
        initialLogChannelId={settings["cp.logChannelId"]}
        initialMaxKickPercent={settings["cp.maxKickPercent"]}
        initialDryRun={settings["cp.dryRun"]}
        incidentGuildId={incidentGuildId}
        channels={channels}
        roles={incidentRoles}
      />
    </>
  );
}

async function SafetyTab({ settings, channels }: { settings: Settings; channels: Channels }) {
  const lockdown = settings["system.lockdown"];
  const lockdownBy = lockdown.byDiscordId
    ? ((await resolveAuthorLabels([lockdown.byDiscordId])).get(lockdown.byDiscordId) ?? lockdown.byDiscordId)
    : null;
  return (
    <>
      <SettingsLockdownForm
        initialEnabled={lockdown.enabled}
        initialReason={lockdown.reason}
        changedBy={lockdownBy}
        changedAt={lockdown.at ? formatMoscow(lockdown.at) : null}
      />
      <SettingsMonitoringForm
        initialErrorChannelId={settings["monitoring.errorChannelId"]}
        initialAlertWebhookUrl={settings["monitoring.alertWebhookUrl"]}
        initialArchiveAfterDays={settings["audit.archiveAfterDays"]}
        channels={channels}
      />
    </>
  );
}
