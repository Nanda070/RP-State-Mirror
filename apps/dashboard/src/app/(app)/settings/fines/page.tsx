import { getSetting } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Штрафы · настройки" };

export default async function SettingsFinesPage() {
  await requireSystemSettingsPage();

  const [managerRoleIds, fineCount, unpaid, overdue, factions] = await Promise.all([
    getSetting("fines.managerRoleIds"),
    prisma.fine.count(),
    prisma.fine.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.fine.count({ where: { status: RecordStatus.ACTIVE, dueAt: { lte: new Date() } } }),
    prisma.faction.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { sortOrder: "asc" },
      select: { code: true, settings: true },
    }),
  ]);

  const withoutChannel = factions
    .filter((faction) => {
      const settings = faction.settings as { documentsChannelId?: string; documentsWebhookUrl?: string } | null;
      return !(settings?.documentsChannelId || settings?.documentsWebhookUrl);
    })
    .map((faction) => faction.code);

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
          Команды <code>/штраф</code> и <code>/штраф-оплачено</code>. Штраф публикуется в канале документов
          фракции, которой он адресован; срок оплаты задаётся в команде (<code>1m</code>, <code>24h</code>,{" "}
          <code>14d</code>). Когда срок истекает, бот один раз пишет об этом в тот же канал.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/fines" className="btn btn-secondary">
            Открыть реестр
          </Link>
          <Link href="/settings/roles" className="btn btn-secondary">
            Кто может выписывать штрафы
          </Link>
          <Link href="/settings/factions" className="btn btn-secondary">
            Каналы фракций
          </Link>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Состояние
        </h2>
        <ul className="status-list">
          <li>
            <span className="status-dot" data-ok={withoutChannel.length === 0} />
            Канал документов у фракций
            <strong>{withoutChannel.length === 0 ? "задан у всех" : `не задан: ${withoutChannel.join(", ")}`}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Кто выписывает штрафы
            <strong>
              {managerRoleIds.length > 0 ? `администраторы и ролей: ${managerRoleIds.length}` : "только администраторы"}
            </strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{fineCount.toLocaleString("ru-RU")}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={overdue === 0} />
            Не оплачено
            <strong>
              {unpaid.toLocaleString("ru-RU")}, из них просрочено: {overdue.toLocaleString("ru-RU")}
            </strong>
          </li>
        </ul>
      </div>
    </div>
  );
}
