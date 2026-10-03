import { canManageModules, canViewModules, listIcBlacklistEntries, listShareLinksFor } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { ShareButton } from "@/components/share-button";
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

  const items = await listIcBlacklistEntries({ limit: 100 });

  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canManageModules(identity)
    ? await listShareLinksFor("ic_blacklist", items.map((item) => item.id))
    : null;

  return (
    <div className="stack">
      <div className="section-head">
        <h1>IC чёрный список</h1>
        <p className="muted">
          Реестр записей ЧС. Публикация через <code>/чс-гос</code> и{" "}
          <code>/снятие-чс-гос</code>. Всего: {items.length.toLocaleString("ru-RU")}.
        </p>
        {canViewModules(identity) ? (
          <a className="btn btn-secondary export-link" href="/api/export/ic-blacklist" download>
            Скачать CSV
          </a>
        ) : null}
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
                  {shareLinks ? <th>Ссылка</th> : null}
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
                    {shareLinks ? (
                      <td>
                        <ShareButton entityType="ic_blacklist" entityId={entry.id} initialLink={shareLinks.get(entry.id) ?? null} />
                      </td>
                    ) : null}
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
