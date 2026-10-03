import { canManageModules, canViewModules, formatTokenDisplay, listCharactersPage } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistryActions, type RegistryActionButton } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Нашивки и персонажи" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  ARCHIVED: "В архиве",
};

export default async function TokensRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listCharactersPage(query);
  const canAct = canManageModules(identity);
  const labels = await resolveAuthorLabels(items.map((item) => item.user.discordId));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Нашивки и персонажи</h1>
        <p className="muted">
          Персонаж создаётся, когда игрок получает нашивку. На аккаунт — до трёх персонажей; архивирование
          освобождает слот.
        </p>
      </div>

      <RegistryToolbar
        path="/tokens"
        query={query}
        statuses={STATUS_RU}
        placeholder="Статик, имя, номер нашивки, Discord ID"
        exportRegistry="tokens"
      />

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted registry-empty">Записей не найдено.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Персонаж</th>
                  <th>Статик</th>
                  <th>Владелец</th>
                  <th>Фракция</th>
                  <th>Нашивка</th>
                  <th>Статус</th>
                  <th>Создан</th>
                  {canAct ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const activeToken = row.tokens.find((token) => token.status === RecordStatus.ACTIVE);
                  const active = row.status === RecordStatus.ACTIVE;
                  const actions: RegistryActionButton[] = active
                    ? [
                        {
                          action: "set_static",
                          label: "Исправить статик",
                          confirm: `Изменить статик персонажа ${row.name} (сейчас ${row.staticId})?`,
                          input: { label: "Новый статик" },
                        },
                        {
                          action: "archive",
                          label: "В архив",
                          tone: "danger",
                          confirm: `Отправить персонажа ${row.name} в архив? Активная нашивка будет отозвана, слот освободится.`,
                          input: { label: "Причина", multiline: true },
                        },
                      ]
                    : [];
                  return (
                    <tr key={row.id}>
                      <td>
                        {row.name} <span className="muted">· слот {row.slot}</span>
                      </td>
                      <td className="registry-mono">{row.staticId}</td>
                      <td>{labels.get(row.user.discordId) ?? row.user.discordId}</td>
                      <td>
                        {[row.factionCode, row.rank !== null ? `ранг ${row.rank}` : null].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="registry-mono nowrap">
                        {activeToken ? formatTokenDisplay(activeToken.number) : <span className="muted">нет</span>}
                      </td>
                      <td>
                        <span className="registry-status" data-status={active ? "ok" : "muted"}>
                          {STATUS_RU[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                      {canAct ? (
                        <td>
                          <div className="registry-actions">
                            {activeToken ? (
                              <RegistryActions
                                entity="token"
                                id={activeToken.id}
                                actions={[
                                  {
                                    action: "revoke",
                                    label: "Отозвать нашивку",
                                    tone: "danger",
                                    confirm: `Отозвать нашивку ${formatTokenDisplay(activeToken.number)} у персонажа ${row.name}? Номер вернётся в пул.`,
                                  },
                                ]}
                              />
                            ) : null}
                            <RegistryActions entity="character" id={row.id} actions={actions} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager path="/tokens" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
