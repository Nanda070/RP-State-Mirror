import { canManageSystemSettings, listMessageDesigns } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsEmbedsPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [designs, sentCount] = await Promise.all([
    listMessageDesigns(false),
    prisma.sentMessage.count({ where: { status: RecordStatus.ACTIVE } }),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Эмбеды</span>
        </p>
        <h1>Эмбеды</h1>
        <p className="muted">
          Движок дизайнов и отправленных сообщений готов в core/bot. Визуальный конструктор UI —
          следующий инкремент; сейчас видны сохранённые шаблоны и счётчик отправок.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Состояние
        </h2>
        <ul className="status-list">
          <li>
            <span className="status-dot" data-ok />
            Активных дизайнов
            <strong>{designs.length.toLocaleString("ru-RU")}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok />
            Отправленных сообщений
            <strong>{sentCount.toLocaleString("ru-RU")}</strong>
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Сохранённые дизайны
        </h2>
        {designs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет сохранённых шаблонов. Модульные slash-команды собирают эмбеды в коде бота;
            конструктор появится позже.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody>
                {designs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="muted">{d.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
