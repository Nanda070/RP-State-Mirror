import { canViewModules, listWanted } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { formatMoscow } from "@/lib/moscow";
import { resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  CLOSED: "Исполнен",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

export default async function WantedRegistryPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listWanted({ limit: 100 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Розыск</h1>
        <p className="muted">
          Федеральный розыск. Всего записей: {total.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет розысков. Создайте через{" "}
            <code>/объявить-розыск</code>.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>ФИО</th>
                  <th>Статус</th>
                  <th>Создан (МСК)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="registry-mono">{row.number}</span>
                    </td>
                    <td>{row.staticId}</td>
                    <td>{row.characterName}</td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={row.status === RecordStatus.ACTIVE ? "warn" : "ok"}
                      >
                        {STATUS_RU[row.status] ?? row.status}
                      </span>
                    </td>
                    <td>{formatMoscow(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Настройки модуля — в{" "}
        <Link href="/settings/wanted">разделе настроек</Link> (главный администратор).
      </p>
    </div>
  );
}
