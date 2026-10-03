import { canManageSystemSettings, getSetting, listActiveChannels } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsWantedForm } from "@/components/settings-module-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsWantedPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [enabled, channelId, pingRoleIds, incidentGuildId, wantedCount, channels] =
    await Promise.all([
      getSetting("wanted.enabled"),
      getSetting("wanted.channelId"),
      getSetting("wanted.pingRoleIds"),
      getSetting("core.incidentGuildId"),
      prisma.wanted.count(),
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
            <span className="status-dot" data-ok={enabled} />
            Модуль
            <strong>{enabled ? "включён" : "выключен"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={Boolean(incidentGuildId)} />
            Сервер ЧП
            <strong>{incidentGuildId ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={Boolean(channelId)} />
            Канал розыска
            <strong>{channelId ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{wantedCount.toLocaleString("ru-RU")}</strong>
          </li>
        </ul>
      </div>

      <SettingsWantedForm
        initialEnabled={enabled}
        initialChannelId={channelId}
        initialPingRoleIds={pingRoleIds}
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
