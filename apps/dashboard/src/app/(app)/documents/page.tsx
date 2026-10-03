import { canManageModules, canViewModules, listDocumentsPage, listShareLinksFor } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { ShareButton } from "@/components/share-button";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Документы" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Ждёт ответа",
  CLOSED: "Отвечен",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
};

export default async function DocumentsRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listDocumentsPage(query);
  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canManageModules(identity)
    ? await listShareLinksFor("document", items.map((item) => item.id))
    : null;

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Документы</h1>
        <p className="muted">
          Реестр документов: отправка — командой <code>/пост</code>, ответ — <code>/ответ</code>.
        </p>
      </div>

      <RegistryToolbar
        path="/documents"
        query={query}
        statuses={STATUS_RU}
        placeholder="Номер, фракция, текст, уведомляемое лицо"
        exportRegistry="documents"
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
                  <th>Фракция</th>
                  <th>Тема</th>
                  <th>Ответов</th>
                  <th>Статус</th>
                  <th>Создан</th>
                  <th>Истекает</th>
                  {shareLinks ? <th>Ссылка</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id}>
                    <td className="registry-mono nowrap">{doc.number}</td>
                    <td>{doc.factionCode}</td>
                    <td>{doc.subject}</td>
                    <td>{doc._count.responses}</td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={doc.status === RecordStatus.ACTIVE ? "warn" : doc.status === RecordStatus.CLOSED ? "ok" : "muted"}
                      >
                        {STATUS_RU[doc.status] ?? doc.status}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(doc.createdAt)}</td>
                    <td className="nowrap">{formatMoscowShort(doc.expiresAt)}</td>
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
        <Pager path="/documents" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
