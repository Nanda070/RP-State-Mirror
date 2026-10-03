import { canManageModules, canViewModules, listTransfersPage } from "@mirror/core";
import { DecisionStatus, TransferStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistryActions, type RegistryActionButton } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Переводы" };

const STATUS_RU: Record<string, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрен",
  REJECTED: "Отказано",
  CLOSED: "Закрыт",
};

const DECISION_RU: Record<DecisionStatus, string> = {
  PENDING: "ждёт",
  APPROVED: "да",
  REJECTED: "нет",
};

function sideActions(side: "source" | "target", faction: string, decision: DecisionStatus): RegistryActionButton[] {
  if (decision !== DecisionStatus.PENDING) return [];
  const label = side === "source" ? "отдающей" : "принимающей";
  return [
    {
      action: `approve_${side}`,
      label: `${faction}: одобрить`,
      confirm: `Одобрить перевод за ${label} сторону (${faction})?`,
    },
    {
      action: `reject_${side}`,
      label: `${faction}: отказать`,
      tone: "danger",
      confirm: `Отказать в переводе за ${label} сторону (${faction})? Перевод будет закрыт.`,
      input: { label: "Причина отказа", multiline: true },
    },
  ];
}

export default async function TransfersRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listTransfersPage(query);
  const canAct = canManageModules(identity);
  const labels = await resolveAuthorLabels(items.map((item) => item.createdByDiscordId));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Переводы между фракциями</h1>
        <p className="muted">
          Заявки подаются командой <code>/перевод-фракции</code>. Перевод одобрен, когда согласны обе стороны.
        </p>
      </div>

      <RegistryToolbar path="/transfers" query={query} statuses={STATUS_RU} placeholder="Статик, имя, фракция" />

      <div className="panel">
        {items.length === 0 ? (
          <EmptyState title="Записей не найдено" />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Персонаж</th>
                  <th>Откуда → куда</th>
                  <th>Ранг</th>
                  <th>Решения сторон</th>
                  <th>Статус</th>
                  <th>Подал</th>
                  <th>Подана</th>
                  {canAct ? <th className="cell-actions">Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.character.name} <span className="muted registry-mono">{row.character.staticId}</span>
                    </td>
                    <td className="nowrap">
                      {row.fromFactionCode} → {row.toFactionCode}
                    </td>
                    <td className="nowrap">
                      {row.fromRank} → {row.toRank}
                    </td>
                    <td className="nowrap">
                      {row.fromFactionCode}: {DECISION_RU[row.sourceDecision]} · {row.toFactionCode}:{" "}
                      {DECISION_RU[row.targetDecision]}
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={
                          row.status === TransferStatus.PENDING ? "warn" : row.status === TransferStatus.APPROVED ? "ok" : "muted"
                        }
                      >
                        {STATUS_RU[row.status] ?? row.status}
                      </span>
                      {row.rejectionReason ? <span className="muted registry-note">{row.rejectionReason}</span> : null}
                    </td>
                    <td>{labels.get(row.createdByDiscordId) ?? row.createdByDiscordId}</td>
                    <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                    {canAct ? (
                      <td>
                        <RegistryActions
                          entity="transfer"
                          id={row.id}
                          actions={
                            row.status === TransferStatus.PENDING
                              ? [
                                  ...sideActions("source", row.fromFactionCode, row.sourceDecision),
                                  ...sideActions("target", row.toFactionCode, row.targetDecision),
                                  {
                                    action: "cancel",
                                    label: "Отменить",
                                    tone: "danger",
                                    confirm: "Отменить перевод? Используйте, если заявка подана по ошибке.",
                                    input: { label: "Причина отмены", multiline: true },
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
        <Pager path="/transfers" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
