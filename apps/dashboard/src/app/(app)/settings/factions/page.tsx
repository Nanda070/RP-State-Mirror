import {
  adminRoleReportSchema,
  getSetting,
  getSettings,
  listActiveFactions,
  listActiveRoleMappings,
  listAdminRoleOperations,
} from "@mirror/core";
import { AdminRolesManager } from "@/components/admin-roles-manager";
import { CommandRolesForm } from "@/components/command-roles-form";
import { AdminPositionsForm } from "@/components/legal-editor";
import { PageTabs, currentTab } from "@/components/page-tabs";
import { SettingsFactionsForm } from "@/components/settings-factions-form";
import { SettingsRolesForm } from "@/components/settings-roles-form";
import {
  getActiveChannelOptions,
  getActiveFactionOptions,
  getActiveGuildOptions,
  getActiveRoleOptions,
} from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Фракции" };

const TABS = [
  { key: "roles", label: "Роли", icon: "roles" },
  { key: "admin", label: "Роли администрации", icon: "crown" },
  { key: "channels", label: "Каналы фракций", icon: "channel" },
  { key: "commands", label: "Права команд", icon: "terminal" },
] as const;

export default async function FactionsSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSystemSettingsPage();
  const tab = currentTab(TABS, (await searchParams).tab);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Фракции</h1>
      </div>
      <PageTabs path="/settings/factions" tabs={TABS} current={tab} />
      {tab === "roles" ? <RolesTab /> : null}
      {tab === "admin" ? <AdminRolesTab /> : null}
      {tab === "channels" ? <ChannelsTab /> : null}
      {tab === "commands" ? <CommandsTab /> : null}
    </div>
  );
}

/** Roles of every guild without @everyone, grouped by guild. */
async function guildRoles() {
  const [guilds, roles] = await Promise.all([getActiveGuildOptions(), getActiveRoleOptions()]);
  return guilds.map((guild) => ({
    discordId: guild.discordId,
    name: guild.name,
    roles: roles
      .filter((role) => role.guild.discordId === guild.discordId && role.name !== "@everyone")
      .map((role) => ({ discordId: role.discordId, name: role.name })),
  }));
}

async function RolesTab() {
  const [mappings, guilds, factions, roles] = await Promise.all([
    listActiveRoleMappings(),
    getActiveGuildOptions(),
    getActiveFactionOptions(),
    getActiveRoleOptions(),
  ]);
  return (
    <SettingsRolesForm
      initialMappings={mappings.map((mapping) => ({
        id: mapping.id,
        roleDiscordId: mapping.roleDiscordId,
        kind: mapping.kind,
        value: mapping.value,
        guild: mapping.guild,
        faction: mapping.faction,
      }))}
      guilds={guilds.map((guild) => ({ discordId: guild.discordId, name: guild.name }))}
      factions={factions}
      roles={roles}
    />
  );
}

async function AdminRolesTab() {
  const [guilds, sets, operations] = await Promise.all([
    guildRoles(),
    getSetting("adminRoles.byGuild"),
    listAdminRoleOperations(20),
  ]);
  const labels = await resolveAuthorLabels(
    operations.flatMap((operation) => [operation.targetDiscordId, operation.requestedByDiscordId]),
  );
  const positions = await getSetting("admins.positions");
  const positionLabels = await resolveAuthorLabels(positions.map((row) => row.discordId));
  return (
    <>
    <AdminPositionsForm
      initial={positions.map((row) => ({ ...row, label: positionLabels.get(row.discordId) ?? "" }))}
    />
    <AdminRolesManager
      guilds={guilds}
      initialSets={sets}
      operations={operations.map((operation) => {
        const report = adminRoleReportSchema.safeParse(operation.report);
        return {
          id: operation.id,
          target: labels.get(operation.targetDiscordId) ?? operation.targetDiscordId,
          level: operation.level,
          status: operation.status,
          requestedBy: labels.get(operation.requestedByDiscordId) ?? operation.requestedByDiscordId,
          createdAt: formatMoscowShort(operation.createdAt),
          report: report.success ? report.data : [],
        };
      })}
    />
    </>
  );
}

async function ChannelsTab() {
  const [factions, guilds, channels, roles] = await Promise.all([
    listActiveFactions(),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
    getActiveRoleOptions(),
  ]);
  return (
    <SettingsFactionsForm
      initialFactions={factions.map((faction) => ({
        code: faction.code,
        name: faction.name,
        color: faction.color,
        guildDiscordId: faction.guild?.discordId ?? null,
        guildName: faction.guild?.name ?? null,
        settings: faction.settings,
      }))}
      guilds={guilds.map((guild) => ({ discordId: guild.discordId, name: guild.name }))}
      channels={channels.map((channel) => ({
        discordId: channel.discordId,
        name: channel.name,
        guildDiscordId: channel.guild.discordId,
      }))}
      roles={roles.map((role) => ({
        discordId: role.discordId,
        name: role.name,
        guildDiscordId: role.guild.discordId,
      }))}
    />
  );
}

async function CommandsTab() {
  const [guilds, commandRoles] = await Promise.all([
    guildRoles(),
    getSettings([
      "documents.posterRoleIds",
      "documents.responderRoleIds",
      "fines.managerRoleIds",
      "personnel.managerRoleIds",
    ] as const),
  ]);
  return <CommandRolesForm guilds={guilds} initial={commandRoles} />;
}
