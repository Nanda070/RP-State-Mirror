import { canManageModules, canViewModules, listShareLinksFor, listWantedPage } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistryActions } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { ShareButton } from "@/components/share-button";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Розыск" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "В розыске",
  CLOSED: "Исполнен",
  REVOKED: "Отменён",
};

export default async function WantedRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listWantedPage(query);
  const canAct = canManageModules(identity);
  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canAct ? await listShareLinksFor("wanted", items.map((item) => item.id)) : null;

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Розыск</h1>
        <p className="muted">Федеральный розыск: объявление — командой <code>/объявить-розыск</code>.</p>
      </div>

      <RegistryToolbar
        path="/wanted"
        query={query}
        statuses={STATUS_RU}
        placeholder="Номер, статик, ФИО, статья"
        exportRegistry="wanted"
      />

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted registry-empty">Записей не найдено.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>ФИО</th>
                  <th>Обвинение</th>
                  <th>Срок</th>
                  <th>Статус</th>
                  <th>Объявлен</th>
                  {canAct ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className="registry-mono nowrap">{row.number}</td>
                    <td className="registry-mono">{row.staticId}</td>
                    <td>{row.characterName}</td>
                    <td>{row.reason}</td>
                    <td className="nowrap">{row.termText}</td>
                    <td>
                      <span className="registry-status" data-status={row.status === RecordStatus.ACTIVE ? "warn" : row.status === RecordStatus.CLOSED ? "ok" : "muted"}>
                        {STATUS_RU[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                    {canAct ? (
                      <td>
                        <div className="registry-actions">
                          {shareLinks ? (
                            <ShareButton entityType="wanted" entityId={row.id} initialLink={shareLinks.get(row.id) ?? null} />
                          ) : null}
                          <RegistryActions
                            entity="wanted"
                            id={row.id}
                            actions={
                              row.status === RecordStatus.ACTIVE
                                ? [
                                    {
                                      action: "close",
                                      label: "Исполнен",
                                      confirm: `Отметить розыск ${row.number} исполненным? Карточка в Discord обновится.`,
                                      input: { label: "Доказательства", placeholder: "Ссылка или описание" },
                                    },
                                    {
                                      action: "cancel",
                                      label: "Отменить",
                                      tone: "danger",
                                      confirm: `Отменить розыск ${row.number}? Используйте, если он объявлен по ошибке.`,
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
        <Pager path="/wanted" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
