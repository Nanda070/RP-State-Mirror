import {
  FORM_DECISION_LABELS_RU,
  formatFormValue,
  getFormForEdit,
  listFormColumns,
  listFormSubmissions,
} from "@mirror/core";
import { DecisionStatus, RecordStatus } from "@mirror/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistryActions, type RegistryActionButton } from "@/components/registry-actions";
import { EmptyState } from "@/components/ui";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Ответы формы" };

const PAGE_SIZE = 50;

const DECISION_ACTIONS: RegistryActionButton[] = [
  { action: "approve", label: "Одобрить", confirm: "Одобрить этот ответ? Автор получит сообщение." },
  {
    action: "reject",
    label: "Отказать",
    tone: "danger",
    confirm: "Отказать по этому ответу? Автор получит причину в личные сообщения.",
    input: { label: "Причина отказа", multiline: true },
  },
];

function decisionTone(decision: DecisionStatus): "ok" | "warn" | "muted" {
  if (decision === DecisionStatus.APPROVED) return "ok";
  return decision === DecisionStatus.PENDING ? "warn" : "muted";
}

export default async function FormResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; pending?: string }>;
}) {
  await requireSystemSettingsPage();
  const { id } = await params;
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const pendingOnly = query.pending === "1";

  const form = await getFormForEdit(id);
  if (!form) notFound();
  const [columns, { total, items }, waiting] = await Promise.all([
    listFormColumns(id),
    listFormSubmissions(id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, pending: pendingOnly }),
    listFormSubmissions(id, { limit: 1, pending: true }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const people = await resolveAuthorLabels(
    items.flatMap((item) => [item.authorDiscordId, item.decidedByDiscordId].filter((value): value is string => Boolean(value))),
  );
  // Archived columns appear only when some answer on this page still has a value for them.
  const visibleColumns = columns.filter(
    (column) =>
      column.status === RecordStatus.ACTIVE ||
      items.some((item) => column.key in ((item.values ?? {}) as Record<string, unknown>)),
  );
  // The column shows up with the first answer that ever needed a decision, not only while the switch is on.
  const showDecision = form.requiresDecision || items.some((item) => item.decision !== null);
  const base = `/settings/forms/${id}/responses`;
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (pendingOnly) search.set("pending", "1");
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Ответы: {form.name}</h1>
        <p className="muted">
          {pendingOnly ? "Ждут решения" : "Всего"}: {total.toLocaleString("ru-RU")} ·{" "}
          <Link href={`/settings/forms/${id}`}>изменить форму</Link> · <Link href="/settings/forms">все формы</Link>
        </p>
      </div>

      <div className="panel">
        <div className="row builder-head">
          <h2 className="panel-title">Ответы</h2>
          <div className="row">
            {showDecision ? (
              <Link href={pendingOnly ? base : `${base}?pending=1`} className="btn btn-secondary">
                {pendingOnly ? "Показать все" : `Ждут решения: ${waiting.total.toLocaleString("ru-RU")}`}
              </Link>
            ) : null}
            {total > 0 ? (
              <a href={`/api/forms/${id}/responses`} className="btn btn-secondary">
                Скачать CSV
              </a>
            ) : null}
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={pendingOnly ? "Ответов, ждущих решения, нет" : total === 0 ? "Ответов пока нет" : "На этой странице ответов нет"}
          />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Получен</th>
                  <th>Отправитель</th>
                  {showDecision ? <th>Решение</th> : null}
                  {visibleColumns.map((column) => (
                    <th key={column.key}>
                      {column.label}
                      {column.status !== RecordStatus.ACTIVE ? " (убрано)" : ""}
                    </th>
                  ))}
                  {showDecision ? <th aria-label="Действия" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const values = (item.values ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={item.id}>
                      <td className="nowrap">{formatMoscowShort(item.createdAt)}</td>
                      <td>
                        {item.authorDiscordId
                          ? (people.get(item.authorDiscordId) ?? item.authorDiscordId)
                          : item.source === "web"
                            ? "Сайт, без входа"
                            : "—"}
                      </td>
                      {showDecision ? (
                        <td>
                          {item.decision ? (
                            <>
                              <span className="registry-status" data-status={decisionTone(item.decision)}>
                                {FORM_DECISION_LABELS_RU[item.decision]}
                              </span>
                              {item.decidedByDiscordId ? (
                                <div className="muted">
                                  {people.get(item.decidedByDiscordId) ?? item.decidedByDiscordId}
                                  {item.decidedAt ? ` · ${formatMoscowShort(item.decidedAt)}` : ""}
                                </div>
                              ) : null}
                              {item.rejectionReason ? <div className="muted">{item.rejectionReason}</div> : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      {visibleColumns.map((column) => (
                        <td key={column.key} className="responses-cell">
                          {formatFormValue(values[column.key])}
                        </td>
                      ))}
                      {showDecision ? (
                        <td>
                          {item.decision === DecisionStatus.PENDING ? (
                            <RegistryActions entity="form_submission" id={item.id} actions={DECISION_ACTIONS} />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <div className="row pager">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn btn-secondary">
                ← Новее
              </Link>
            ) : null}
            <span className="muted">
              Страница {page} из {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="btn btn-secondary">
                Старее →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
