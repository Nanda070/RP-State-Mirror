import {
  canManageSystemSettings,
  getSetting,
  listActiveChannels,
} from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsCpForm } from "@/components/settings-cp-form";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsSystemPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [guilds, mainGuildId, incidentGuildId, cpEnabled, cpExcluded, cpLogChannelId, channels] =
    await Promise.all([
      prisma.guild.findMany({
        where: { status: RecordStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { discordId: true, name: true, iconUrl: true, lastSyncedAt: true },
      }),
      getSetting("core.mainGuildId"),
      getSetting("core.incidentGuildId"),
      getSetting("cp.syncEnabled"),
      getSetting("cp.excludedRoleIds"),
      getSetting("cp.logChannelId"),
      listActiveChannels(),
    ]);

  const incidentRoles = incidentGuildId
    ? await prisma.discordRole.findMany({
        where: {
          status: RecordStatus.ACTIVE,
          guild: { discordId: incidentGuildId, status: RecordStatus.ACTIVE },
        },
        orderBy: { name: "asc" },
        select: { discordId: true, name: true },
      })
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
          ...g,
          lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
        }))}
        initialMain={mainGuildId}
        initialIncident={incidentGuildId}
      />
      <SettingsCpForm
        initialEnabled={cpEnabled}
        initialExcludedRoleIds={cpExcluded}
        initialLogChannelId={cpLogChannelId}
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
