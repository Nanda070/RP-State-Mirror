import {
  canViewModules,
  listDocuments,
} from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { formatMoscow } from "@/lib/moscow";
import { resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  CLOSED: "Закрыт",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

export default async function DocumentsRegistryPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listDocuments({ limit: 100 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Документы</h1>
        <p className="muted">
          Реестр отправленных документов. Всего записей: {total.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет документов. Создайте через команду{" "}
            <code>/пост</code> в Discord.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Фракция</th>
                  <th>Тема</th>
                  <th>Статус</th>
                  <th>Создан (МСК)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <span className="registry-mono">{doc.number}</span>
                    </td>
                    <td>{doc.factionCode}</td>
                    <td>{doc.subject}</td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={doc.status === RecordStatus.ACTIVE ? "ok" : "muted"}
                      >
                        {STATUS_RU[doc.status] ?? doc.status}
                      </span>
                    </td>
                    <td>{formatMoscow(doc.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Настройки модуля — в{" "}
        <Link href="/settings/documents">разделе настроек</Link> (главный администратор).
      </p>
    </div>
  );
}
