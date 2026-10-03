import { canViewModules, listIcBlacklistEntries } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  CLOSED: "Снят",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

export default async function IcBlacklistRegistryPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const items = await listIcBlacklistEntries({ limit: 100 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>IC чёрный список</h1>
        <p className="muted">
          Реестр записей ЧС. Публикация через <code>/чс-гос</code> и{" "}
          <code>/снятие-чс-гос</code>. Всего: {items.length.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Записей пока нет.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статус</th>
                  <th>ФИО</th>
                  <th>Паспорт</th>
                  <th>Причина</th>
                  <th>Создан (МСК)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <span className="registry-mono">{entry.number}</span>
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={
                          entry.status === RecordStatus.ACTIVE
                            ? "warn"
                            : entry.status === RecordStatus.CLOSED
                              ? "ok"
                              : "muted"
                        }
                      >
                        {STATUS_RU[entry.status] ?? entry.status}
                      </span>
                    </td>
                    <td>{entry.fullName}</td>
                    <td>
                      <span className="registry-mono">{entry.staticId}</span>
                    </td>
                    <td>{entry.reason}</td>
                    <td>{formatMoscow(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Настройки модуля — в{" "}
        <Link href="/settings/stage4?tab=icBlacklist">конфигурации модулей</Link> (главный
        администратор).
      </p>
    </div>
  );
}
