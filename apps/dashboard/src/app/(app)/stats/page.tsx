import { canManageModules, getAdminStats } from "@mirror/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Статистика администрации" };

const PERIODS = [
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
] as const;

function reaction(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} ч`;
  return `${Math.round(minutes / 1440)} дн`;
}

export default async function AdminStatsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageModules(identity)) redirect("/overview");

  const requested = Number((await searchParams).days);
  const days = PERIODS.some((period) => period.days === requested) ? requested : 30;
  const to = new Date();
  const stats = await getAdminStats({ from: new Date(to.getTime() - days * 86_400_000), to });
  const labels = await resolveAuthorLabels(stats.rows.map((row) => row.discordId));

  const total = stats.rows.reduce((sum, row) => sum + row.total, 0);
  const peak = Math.max(1, ...stats.byDay.map((entry) => entry.count));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Статистика администрации</h1>
        <p className="muted">
          Кто сколько обработал за период. Считается по самим записям, поэтому учтены решения и из Discord, и
          из дашборда.
        </p>
      </div>

      <nav className="settings-tabs" aria-label="Период">
        {PERIODS.map((period) => (
          <Link
            key={period.days}
            href={`/stats?days=${period.days}`}
            className="settings-tab"
            data-active={period.days === days ? "" : undefined}
            aria-current={period.days === days ? "page" : undefined}
          >
            {period.label}
          </Link>
        ))}
      </nav>

      <div className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">Всего действий</span>
          <span className="metric-value">{total}</span>
          <span className="metric-hint">за {days} дней</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Активных сотрудников</span>
          <span className="metric-value">{stats.rows.length}</span>
          <span className="metric-hint">хотя бы одно действие</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">В среднем в день</span>
          <span className="metric-value">{(total / days).toFixed(1)}</span>
          <span className="metric-hint">действий</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Активность по дням (МСК)</h2>
        {stats.byDay.length === 0 ? (
          <p className="muted">За этот период действий не было.</p>
        ) : (
          <div className="stats-bars" role="img" aria-label="Число действий по дням">
            {stats.byDay.map((entry) => (
              <div key={entry.day} className="stats-bar" title={`${entry.day}: ${entry.count}`}>
                <span className="stats-bar-fill" style={{ height: `${Math.max(4, (entry.count / peak) * 100)}%` }} />
                <span className="stats-bar-label">{entry.day.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">По сотрудникам</h2>
        {stats.rows.length === 0 ? (
          <p className="muted">Нет данных за период.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Всего</th>
                  <th title="Одобрено / отказано">Регистрации</th>
                  <th title="Среднее время от заявки до решения">Реакция</th>
                  <th>Переводы</th>
                  <th>Ответы в ОС</th>
                  <th title="Объявлено / закрыто">Розыск</th>
                  <th title="Выписано / отмечено оплаченными">Штрафы</th>
                  <th title="Внесено / снято">IC ЧС</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((row) => (
                  <tr key={row.discordId}>
                    <td>{labels.get(row.discordId) ?? row.discordId}</td>
                    <td>
                      <strong>{row.total}</strong>
                    </td>
                    <td>
                      {row.registrationsApproved} / {row.registrationsRejected}
                    </td>
                    <td>{reaction(row.avgReactionMinutes)}</td>
                    <td>{row.transferDecisions}</td>
                    <td>{row.feedbackReplies}</td>
                    <td>
                      {row.wantedIssued} / {row.wantedClosed}
                    </td>
                    <td>
                      {row.finesIssued} / {row.finesPaid}
                    </td>
                    <td>
                      {row.blacklistAdded} / {row.blacklistClosed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
