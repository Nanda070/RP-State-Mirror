import { formatFormValue, getFormForEdit, listFormColumns, listFormSubmissions } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Ответы формы" };

const PAGE_SIZE = 50;

export default async function FormResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSystemSettingsPage();
  const { id } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);

  const form = await getFormForEdit(id);
  if (!form) notFound();
  const [columns, { total, items }] = await Promise.all([
    listFormColumns(id),
    listFormSubmissions(id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const senders = await resolveAuthorLabels(items.flatMap((item) => (item.authorDiscordId ? [item.authorDiscordId] : [])));
  // Archived columns appear only when some answer on this page still has a value for them.
  const visibleColumns = columns.filter(
    (column) =>
      column.status === RecordStatus.ACTIVE ||
      items.some((item) => column.key in ((item.values ?? {}) as Record<string, unknown>)),
  );

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Ответы: {form.name}</h1>
        <p className="muted">
          Всего: {total.toLocaleString("ru-RU")} · <Link href={`/settings/forms/${id}`}>изменить форму</Link> ·{" "}
          <Link href="/settings/forms">все формы</Link>
        </p>
      </div>

      <div className="panel">
        <div className="row builder-head">
          <h2 className="panel-title">Ответы</h2>
          {total > 0 ? (
            <a href={`/api/forms/${id}/responses`} className="btn btn-secondary">
              Скачать CSV
            </a>
          ) : null}
        </div>
        {items.length === 0 ? (
          <EmptyState icon="inbox" title={total === 0 ? "Ответов пока нет" : "На этой странице ответов нет"} />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Получен</th>
                  <th>Отправитель</th>
                  {visibleColumns.map((column) => (
                    <th key={column.key}>
                      {column.label}
                      {column.status !== RecordStatus.ACTIVE ? " (убрано)" : ""}
                    </th>
                  ))}
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
                          ? (senders.get(item.authorDiscordId) ?? item.authorDiscordId)
                          : item.source === "web"
                            ? "Сайт, без входа"
                            : "—"}
                      </td>
                      {visibleColumns.map((column) => (
                        <td key={column.key} className="responses-cell">
                          {formatFormValue(values[column.key])}
                        </td>
                      ))}
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
              <Link href={`/settings/forms/${id}/responses?page=${page - 1}`} className="btn btn-secondary">
                ← Новее
              </Link>
            ) : null}
            <span className="muted">
              Страница {page} из {pages}
            </span>
            {page < pages ? (
              <Link href={`/settings/forms/${id}/responses?page=${page + 1}`} className="btn btn-secondary">
                Старее →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
