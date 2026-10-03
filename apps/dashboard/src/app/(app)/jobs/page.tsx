import { listJobsPage } from "@mirror/core";
import { JobStatus } from "@mirror/db";
import { RegistryActions } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Очередь задач" };
export const dynamic = "force-dynamic";

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  RUNNING: "Выполняется",
  SUCCEEDED: "Выполнена",
  FAILED: "Упала",
  CANCELLED: "Отменена",
};

const TONE: Record<JobStatus, string> = {
  PENDING: "warn",
  RUNNING: "warn",
  SUCCEEDED: "ok",
  FAILED: "bad",
  CANCELLED: "muted",
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  await requireSystemSettingsPage();
  const query = registryQuery(await searchParams);
  const { items, total, page, pages } = await listJobsPage(query);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Очередь задач</h1>
        <p className="muted">
          Всё, что бот отправляет в Discord, проходит через очередь. Задача с пометкой «Отложено» ждёт
          настройки канала и запустится сама. Упавшую задачу можно повторить после устранения причины.
        </p>
      </div>

      <RegistryToolbar path="/jobs" query={query} statuses={STATUS_RU} placeholder="Тип задачи или текст ошибки" />

      <div className="panel">
        {items.length === 0 ? (
          <EmptyState title="Задач не найдено" />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Попытки</th>
                  <th>Создана</th>
                  <th>Следующий запуск</th>
                  <th>Сообщение</th>
                  <th className="cell-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <tr key={job.id}>
                    <td className="registry-mono">{job.type}</td>
                    <td>
                      <span className="registry-status" data-status={TONE[job.status]}>
                        {STATUS_RU[job.status] ?? job.status}
                      </span>
                    </td>
                    <td className="nowrap">
                      {job.attempts} / {job.maxAttempts}
                    </td>
                    <td className="nowrap">{formatMoscowShort(job.createdAt)}</td>
                    <td className="nowrap">{job.status === JobStatus.PENDING ? formatMoscowShort(job.availableAt) : "—"}</td>
                    <td>{job.lastError ?? "—"}</td>
                    <td>
                      <RegistryActions
                        entity="job"
                        id={job.id}
                        actions={
                          job.status === JobStatus.FAILED || job.status === JobStatus.CANCELLED
                            ? [
                                {
                                  action: "retry",
                                  label: "Повторить",
                                  confirm: `Вернуть задачу ${job.type} в очередь? Бот выполнит её заново.`,
                                },
                              ]
                            : job.status === JobStatus.PENDING
                              ? [
                                  {
                                    action: "cancel",
                                    label: "Отменить",
                                    tone: "danger",
                                    confirm: `Отменить задачу ${job.type}? Сообщение в Discord не будет отправлено.`,
                                  },
                                ]
                              : []
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager path="/jobs" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
