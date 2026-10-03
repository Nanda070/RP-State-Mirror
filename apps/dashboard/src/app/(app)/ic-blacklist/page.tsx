import { canManageModules, canViewModules, listIcBlacklistPage, listShareLinksFor } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { IcBlacklistAddForm } from "@/components/ic-blacklist-add-form";
import { RegistryActions } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { ShareButton } from "@/components/share-button";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "IC чёрный список" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Действует",
  CLOSED: "Снят",
  EXPIRED: "Истёк",
};

export default async function IcBlacklistRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listIcBlacklistPage(query);
  const canAct = canManageModules(identity);
  // Public links are created and revoked by «Админ» and above; everyone else only reads the registry.
  const shareLinks = canAct ? await listShareLinksFor("ic_blacklist", items.map((item) => item.id)) : null;

  return (
    <div className="stack">
      <div className="section-head">
        <h1>IC чёрный список</h1>
        <p className="muted">
          Список носит информационный характер: запись не блокирует бота и заявки.
        </p>
      </div>

      {canAct ? <IcBlacklistAddForm /> : null}

      <RegistryToolbar
        path="/ic-blacklist"
        query={query}
        statuses={STATUS_RU}
        placeholder="Номер, паспорт, ФИО, причина"
        {...(canViewModules(identity) ? { exportRegistry: "ic-blacklist" } : {})}
      />

      <div className="panel">
        {items.length === 0 ? (
          <EmptyState title="Записей не найдено" />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>ФИО</th>
                  <th>Паспорт</th>
                  <th>Причина</th>
                  <th>Статус</th>
                  <th>Внесён</th>
                  <th>Действует до</th>
                  {canAct ? <th className="cell-actions">Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="registry-mono nowrap">{entry.number}</td>
                    <td>{entry.fullName}</td>
                    <td className="registry-mono">{entry.staticId}</td>
                    <td>
                      {entry.reason}
                      {entry.closeReason ? <span className="muted"> · снят: {entry.closeReason}</span> : null}
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={entry.status === RecordStatus.ACTIVE ? "warn" : entry.status === RecordStatus.CLOSED ? "ok" : "muted"}
                      >
                        {STATUS_RU[entry.status] ?? entry.status}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(entry.createdAt)}</td>
                    <td className="nowrap">{entry.expiresAt ? formatMoscowShort(entry.expiresAt) : "бессрочно"}</td>
                    {canAct ? (
                      <td className="cell-actions">
                        <div className="registry-actions">
                          {shareLinks ? (
                            <ShareButton
                              entityType="ic_blacklist"
                              entityId={entry.id}
                              initialLink={shareLinks.get(entry.id) ?? null}
                            />
                          ) : null}
                          <RegistryActions
                            entity="ic_blacklist"
                            id={entry.id}
                            actions={
                              entry.status === RecordStatus.ACTIVE
                                ? [
                                    {
                                      action: "close",
                                      label: "Снять",
                                      confirm: `Снять запись ${entry.number} (${entry.fullName})? Карточка в Discord обновится.`,
                                      input: { label: "Причина снятия", multiline: true },
                                    },
                                  ]
                                : []
                            }
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager path="/ic-blacklist" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
