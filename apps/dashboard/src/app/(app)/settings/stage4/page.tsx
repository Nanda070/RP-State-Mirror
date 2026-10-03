import { getSettings, migrateLegacyRegistrationChannels } from "@mirror/core";
import Link from "next/link";
import {
  Stage4SettingsManager,
  type Stage4SettingsValues,
} from "@/components/stage4-settings-manager";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getRolesForGuild,
} from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

type TabId =
  | "registrations"
  | "transfers"
  | "icBlacklist"
  | "tokens"
  | "webhooks"
  | "feedback"
  | "invites";

const TAB_IDS = new Set<TabId>([
  "registrations",
  "transfers",
  "icBlacklist",
  "tokens",
  "webhooks",
  "feedback",
  "invites",
]);

export default async function Stage4SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requireSystemSettingsPage();
  const params = searchParams ? await searchParams : {};
  const initialTab = TAB_IDS.has(params.tab as TabId) ? (params.tab as TabId) : "registrations";

  await migrateLegacyRegistrationChannels();

  const [settings, channels, guilds] = await Promise.all([
    getSettings([
      "registrations.ttlDays",
      "registrations.vehicleChannelId",
      "registrations.uniformChannelId",
      "registrations.coordinatorRoleIds",
      "transfers.channelId",
      "transfers.approvalDmText",
      "webhooks.notifyChannelId",
      "feedback.notifyChannelId",
      "icBlacklist.enabled",
      "icBlacklist.channelId",
      "icBlacklist.managerRoleIds",
      "icBlacklist.searchRoleIds",
      "invites.guildIds",
      "invites.defaultMaxAgeSeconds",
      "tokens.expandThresholdPercent",
      "tokens.finderRoleIds",
      "core.incidentGuildId",
      "core.mainGuildId",
    ] as const),
    getActiveChannelOptions(),
    getActiveGuildOptions(),
  ]);

  const incidentGuildId = settings["core.incidentGuildId"];
  const mainGuildId = settings["core.mainGuildId"];
  const [incidentRoles, mainRoles] = await Promise.all([
    incidentGuildId ? getRolesForGuild(incidentGuildId) : Promise.resolve([]),
    mainGuildId ? getRolesForGuild(mainGuildId) : Promise.resolve([]),
  ]);

  const initial: Stage4SettingsValues = {
    "registrations.ttlDays": settings["registrations.ttlDays"],
    "registrations.vehicleChannelId": settings["registrations.vehicleChannelId"],
    "registrations.uniformChannelId": settings["registrations.uniformChannelId"],
    "registrations.coordinatorRoleIds": settings["registrations.coordinatorRoleIds"],
    "transfers.channelId": settings["transfers.channelId"],
    "transfers.approvalDmText": settings["transfers.approvalDmText"] ?? "",
    "webhooks.notifyChannelId": settings["webhooks.notifyChannelId"],
    "feedback.notifyChannelId": settings["feedback.notifyChannelId"],
    "icBlacklist.enabled": settings["icBlacklist.enabled"],
    "icBlacklist.channelId": settings["icBlacklist.channelId"],
    "icBlacklist.managerRoleIds": settings["icBlacklist.managerRoleIds"],
    "icBlacklist.searchRoleIds": settings["icBlacklist.searchRoleIds"],
    "invites.guildIds": settings["invites.guildIds"],
    "invites.defaultMaxAgeSeconds": settings["invites.defaultMaxAgeSeconds"],
    "tokens.expandThresholdPercent": settings["tokens.expandThresholdPercent"],
    "tokens.finderRoleIds": settings["tokens.finderRoleIds"],
  };

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Конфигурация модулей</span>
        </p>
        <h1>Конфигурация модулей</h1>
        <p className="muted">
          Каналы, роли и параметры модулей. Реестры и конструкторы вынесены в отдельные разделы.
        </p>
      </div>
      <Stage4SettingsManager
        initial={initial}
        initialTab={initialTab}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
        incidentRoles={incidentRoles}
        mainRoles={mainRoles}
        guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
        incidentGuildId={incidentGuildId}
        mainGuildId={mainGuildId}
      />
    </div>
  );
}
