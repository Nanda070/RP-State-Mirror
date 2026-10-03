import { canManageSystemSettings, getSetting, listActiveChannels } from "@mirror/core";
import { prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsFinesForm } from "@/components/settings-module-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsFinesPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [dueDays, channelId, incidentGuildId, fineCount, channels] = await Promise.all([
    getSetting("fines.dueDays"),
    getSetting("fines.channelId"),
    getSetting("core.incidentGuildId"),
    prisma.fine.count(),
    listActiveChannels(),
  ]);

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
            <span className="status-dot" data-ok={Boolean(channelId)} />
            Канал штрафов
            <strong>{channelId ? "задан" : "не задан"}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{fineCount.toLocaleString("ru-RU")}</strong>
          </li>
        </ul>
      </div>

      <SettingsFinesForm
        initialDueDays={dueDays}
        initialChannelId={channelId}
        incidentGuildId={incidentGuildId}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
      />
    </div>
  );
}
