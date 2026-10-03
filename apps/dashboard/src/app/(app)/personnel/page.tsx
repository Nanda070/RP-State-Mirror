import { canManageModules, canViewModules, listPersonnelPage, PERSONNEL_EVENT_LABELS_RU } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistryActions } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Персонал" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Действует",
  REVOKED: "Отозвано",
};

export default async function PersonnelRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listPersonnelPage(query);
  const canAct = canManageModules(identity);
  const labels = await resolveAuthorLabels(items.map((item) => item.actorDiscordId));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Персонал</h1>
        <p className="muted">
          Кадровый аудит фракций: события создаются командой <code>/кадровый-аудит</code>.
        </p>
      </div>

      <RegistryToolbar
        path="/personnel"
        query={query}
        statuses={STATUS_RU}
        placeholder="Фракция, сотрудник, Discord ID"
        exportRegistry="personnel"
      />

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted registry-empty">Записей не найдено.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Событие</th>
                  <th>Фракция</th>
                  <th>Сотрудник</th>
                  <th>Оформил</th>
                  <th>Статус</th>
                  <th>Создано</th>
                  {canAct ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((event) => (
                  <tr key={event.id}>
                    <td>{PERSONNEL_EVENT_LABELS_RU[event.type as keyof typeof PERSONNEL_EVENT_LABELS_RU] ?? event.type}</td>
                    <td>{event.factionCode}</td>
                    <td>
                      {event.subjectName} <span className="muted registry-mono">({event.subjectDiscordId})</span>
                    </td>
                    <td>{labels.get(event.actorDiscordId) ?? event.actorDiscordId}</td>
                    <td>
                      <span className="registry-status" data-status={event.status === RecordStatus.ACTIVE ? "ok" : "muted"}>
                        {STATUS_RU[event.status] ?? event.status}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(event.createdAt)}</td>
                    {canAct ? (
                      <td>
                        <RegistryActions
                          entity="personnel"
                          id={event.id}
                          actions={
                            event.status === RecordStatus.ACTIVE
                              ? [
                                  {
                                    action: "revoke",
                                    label: "Отозвать",
                                    tone: "danger",
                                    confirm: `Отозвать событие по сотруднику ${event.subjectName}? Запись останется в реестре с пометкой «Отозвано».`,
                                  },
                                ]
                              : []
                          }
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager path="/personnel" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
