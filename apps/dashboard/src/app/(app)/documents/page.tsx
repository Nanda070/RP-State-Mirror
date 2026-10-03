import {
  canManageModules,
  canViewModules,
  listShareLinksFor,
  listDocuments,
} from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShareButton } from "@/components/share-button";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  CLOSED: "Отправлено",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

export default async function DocumentsRegistryPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listDocuments({ limit: 100 });

  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canManageModules(identity)
    ? await listShareLinksFor("document", items.map((item) => item.id))
    : null;

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
                  {shareLinks ? <th>Ссылка</th> : null}
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
                        data-status={
                          doc.status === RecordStatus.ACTIVE
                            ? "warn"
                            : doc.status === RecordStatus.CLOSED
                              ? "ok"
                              : "muted"
                        }
                      >
                        {STATUS_RU[doc.status] ?? doc.status}
                      </span>
                    </td>
                    <td>{formatMoscow(doc.createdAt)}</td>
                    {shareLinks ? (
                      <td>
                        <ShareButton entityType="document" entityId={doc.id} initialLink={shareLinks.get(doc.id) ?? null} />
                      </td>
                    ) : null}
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
