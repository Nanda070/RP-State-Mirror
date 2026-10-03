import { auditActorDiscordId, listAuditEntityTypes, listAuditLogPage } from "@mirror/core";
import type { AuditActorType } from "@mirror/db";
import { Pager, RegistryToolbar, registryQuery } from "@/components/registry-toolbar";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Журнал аудита" };

type AuditSearch = { q?: string; page?: string; entity?: string; actor?: string; from?: string; to?: string };

const ACTOR_RU: Record<AuditActorType, string> = {
  USER: "Пользователь",
  BOT: "Бот",
  SYSTEM: "Система",
};

/** A calendar day typed in the filter is a Moscow day. */
function moscowDay(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}+03:00`);
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<AuditSearch> }) {
  await requireSystemSettingsPage();
  const params = await searchParams;
  const query = registryQuery(params);
  const filters = {
    entity: params.entity?.trim() || undefined,
    actor: params.actor?.trim() || undefined,
    from: params.from?.trim() || undefined,
    to: params.to?.trim() || undefined,
  };

  const [{ items, total, page, pages }, entityTypes] = await Promise.all([
    listAuditLogPage({
      q: query.q,
      page: query.page,
      entityType: filters.entity,
      actorDiscordId: filters.actor,
      from: moscowDay(filters.from, false),
      to: moscowDay(filters.to, true),
    }),
    listAuditEntityTypes(),
  ]);
  const actorIds = items.map((item) => auditActorDiscordId(item)).filter((id): id is string => Boolean(id));
  const labels = await resolveAuthorLabels(actorIds);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Журнал аудита</h1>
        <p className="muted">
          Каждое изменение в системе: кто, что и когда. Записи не удаляются; старше года переносятся в архив.
        </p>
      </div>

      <RegistryToolbar path="/audit" query={{ q: query.q }} placeholder="Действие, id записи, источник">
        <div className="field">
          <label htmlFor="audit-entity">Сущность</label>
          <select id="audit-entity" name="entity" defaultValue={filters.entity ?? ""}>
            <option value="">Все</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-actor">Discord ID автора</label>
          <input id="audit-actor" name="actor" inputMode="numeric" defaultValue={filters.actor ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="audit-from">С даты</label>
          <input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="audit-to">По дату</label>
          <input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
      </RegistryToolbar>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted registry-empty">Записей не найдено.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кто</th>
                  <th>Действие</th>
                  <th>Запись</th>
                  <th>Источник</th>
                  <th>Изменение</th>
                </tr>
              </thead>
              <tbody>
                {items.map((event) => {
                  const actorId = auditActorDiscordId(event);
                  return (
                    <tr key={event.id}>
                      <td className="nowrap">{formatMoscowShort(event.createdAt)}</td>
                      <td>{actorId ? (labels.get(actorId) ?? actorId) : ACTOR_RU[event.actorType]}</td>
                      <td className="registry-mono">{event.action}</td>
                      <td>
                        {event.entityType} <span className="muted registry-mono">{event.entityId}</span>
                      </td>
                      <td className="muted">{event.source}</td>
                      <td>
                        {event.before || event.after ? (
                          <details className="audit-diff">
                            <summary>показать</summary>
                            {event.before ? <pre>было: {compact(event.before)}</pre> : null}
                            {event.after ? <pre>стало: {compact(event.after)}</pre> : null}
                          </details>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          path="/audit"
          params={{ q: query.q, entity: filters.entity, actor: filters.actor, from: filters.from, to: filters.to }}
          page={page}
          pages={pages}
          total={total}
        />
      </div>
    </div>
  );
}
