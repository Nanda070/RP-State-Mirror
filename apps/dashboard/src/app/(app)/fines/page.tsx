import { canViewModules, listFines } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Не оплачен",
  CLOSED: "Оплачен",
  EXPIRED: "Истёк",
  REVOKED: "Отменён",
  ARCHIVED: "В архиве",
};

export default async function FinesRegistryPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listFines({ limit: 100 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Штрафы</h1>
        <p className="muted">
          Реестр штрафов. Всего записей: {total.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет штрафов. Создайте через <code>/штраф</code>.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>ФИО</th>
                  <th>Сумма</th>
                  <th>Фракция</th>
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
                    <td>{row.amount.toLocaleString("ru-RU")} ₽</td>
                    <td>{row.factionCode}</td>
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
        <Link href="/settings/fines">разделе настроек</Link> (главный администратор).
      </p>
    </div>
  );
}
