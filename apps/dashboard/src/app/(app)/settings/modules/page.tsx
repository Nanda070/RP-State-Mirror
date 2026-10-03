import { getSettings, migrateLegacyRegistrationChannels } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { ModulesSettings } from "@/components/modules-settings";
import type { Stage4SettingsValues } from "@/components/stage4-settings-manager";
import {
  getActiveChannelOptions,
  getActiveGuildOptions,
  getActiveRoleOptions,
  getRolesForGuild,
} from "@/lib/catalog";
import { moduleTab } from "@/lib/module-tabs";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Модули" };

export default async function ModulesSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requireSystemSettingsPage();
  const params = searchParams ? await searchParams : {};
  const initialTab = moduleTab(params.tab);

  await migrateLegacyRegistrationChannels();

  const [settings, channels, guilds] = await Promise.all([
    getSettings([
      "registrations.ttlDays",
      "registrations.pendingTtlDays",
      "registrations.vehicleChannelId",
      "registrations.uniformChannelId",
      "registrations.coordinatorRoleIds",
      "transfers.channelId",
      "transfers.pingRoleIds",
      "transfers.approvalDmText",
      "transfers.pendingTtlDays",
      "vehicleRequests.channelId",
      "vehicleRequests.pingRoleIds",
      "webhooks.notifyChannelId",
      "feedback.notifyChannelId",
      "feedback.categories",
      "icBlacklist.enabled",
      "icBlacklist.channelId",
      "icBlacklist.managerRoleIds",
      "icBlacklist.searchRoleIds",
      "invites.guildIds",
      "invites.defaultMaxAgeSeconds",
      "tokens.expandThresholdPercent",
      "tokens.finderRoleIds",
      "tokens.openMessage",
      "core.incidentGuildId",
      "documents.ttlHours",
      "wanted.enabled",
      "wanted.channelId",
      "wanted.coordinatorRoleIds",
    ] as const),
    getActiveChannelOptions(),
    getActiveGuildOptions(),
  ]);
  const allRoles = await getActiveRoleOptions();

  const incidentGuildId = settings["core.incidentGuildId"];
  const govFaction = await prisma.faction.findFirst({
    where: { code: "GOV", status: RecordStatus.ACTIVE },
    select: { guild: { select: { discordId: true } } },
  });
  const govGuildId = govFaction?.guild?.discordId ?? null;
  const [incidentRoles, govRoles] = await Promise.all([
    incidentGuildId ? getRolesForGuild(incidentGuildId) : Promise.resolve([]),
    govGuildId ? getRolesForGuild(govGuildId) : Promise.resolve([]),
  ]);

  const channelOptions = channels.map((c) => ({
    discordId: c.discordId,
    name: c.name,
    guildDiscordId: c.guild.discordId,
    guildName: c.guild.name,
  }));

  const initial: Stage4SettingsValues = {
    "registrations.ttlDays": settings["registrations.ttlDays"],
    "registrations.pendingTtlDays": settings["registrations.pendingTtlDays"],
    "registrations.vehicleChannelId": settings["registrations.vehicleChannelId"],
    "registrations.uniformChannelId": settings["registrations.uniformChannelId"],
    "registrations.coordinatorRoleIds": settings["registrations.coordinatorRoleIds"],
    "transfers.channelId": settings["transfers.channelId"],
    "transfers.pingRoleIds": settings["transfers.pingRoleIds"],
    "transfers.approvalDmText": settings["transfers.approvalDmText"] ?? "",
    "transfers.pendingTtlDays": settings["transfers.pendingTtlDays"],
    "vehicleRequests.channelId": settings["vehicleRequests.channelId"],
    "vehicleRequests.pingRoleIds": settings["vehicleRequests.pingRoleIds"],
    "webhooks.notifyChannelId": settings["webhooks.notifyChannelId"],
    "feedback.notifyChannelId": settings["feedback.notifyChannelId"],
    "feedback.categories": settings["feedback.categories"],
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
        <h1>Модули</h1>
      </div>
      <ModulesSettings
        initialTab={initialTab}
        documents={{ initialTtlHours: settings["documents.ttlHours"] }}
        wanted={{
          initialEnabled: settings["wanted.enabled"],
          initialChannelId: settings["wanted.channelId"],
          initialCoordinatorRoleIds: settings["wanted.coordinatorRoleIds"],
          incidentGuildId,
          channels: channelOptions,
          roles: incidentRoles,
        }}
        manager={{
          initial,
          channels: channelOptions,
          incidentRoles,
          govRoles,
          allRoles: allRoles.map((role) => ({ discordId: role.discordId, name: role.name, guildDiscordId: role.guild.discordId })),
          guilds: guilds.map((g) => ({ discordId: g.discordId, name: g.name })),
          incidentGuildId,
          govGuildId,
          tokenOpenMessage: settings["tokens.openMessage"],
        }}
      />
    </div>
  );
}
