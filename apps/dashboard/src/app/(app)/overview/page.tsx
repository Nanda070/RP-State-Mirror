import { buildStatusBadge, canManageSystemSettings } from "@mirror/core";
import { JobStatus, RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export default async function OverviewPage() {
  const session = await requireSignedIn();

  const [identity, guildCount, memberCount, mappingCount, roleCount, pendingJobs] =
    await Promise.all([
      resolveFreshIdentity(session.user.discordId),
      prisma.guild.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.guildMember.count({ where: { isPresent: true } }),
      prisma.roleMapping.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.discordRole.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.job.count({ where: { status: JobStatus.PENDING } }),
    ]);

  const badge = buildStatusBadge(identity);
  const canSettings = canManageSystemSettings(identity);

  const displayName = session.user.name ?? session.user.username ?? "пользователь";
  const newsStamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  return (
    <div className="stack overview-page">
      <div className="welcome-head">
        <h1>Добро пожаловать, {displayName}</h1>
        <p className="muted">
          Статус доступа: <strong className="ink-strong">{badge.primary}</strong>
        </p>
      </div>

      <section className="news-card panel">
        <div className="news-card-head">
          <div className="news-card-title">
            <span className="news-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <path
                  d="M12 3.5 13.8 9.2 19.5 11 13.8 12.8 12 18.5 10.2 12.8 4.5 11l5.7-1.8L12 3.5Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2>Что нового</h2>
          </div>
          <span className="news-card-date">{newsStamp}</span>
        </div>
        <ul className="news-list">
          <li>
            Реестры документов, розыска, штрафов и персонала доступны из раздела «Модули».
          </li>
          <li>
            Синхронизация серверов:{" "}
            <strong>
              {guildCount > 0
                ? `${formatCount(guildCount)} активных`
                : "ожидает подключения бота"}
            </strong>
            ; карта ролей:{" "}
            <strong>
              {mappingCount > 0
                ? `${formatCount(mappingCount)} привязок из ${formatCount(roleCount)}`
                : "ещё не настроена"}
            </strong>
            .
          </li>
          <li>
            Очередь задач:{" "}
            <strong>
              {pendingJobs === 0 ? "пусто" : `${formatCount(pendingJobs)} в ожидании`}
            </strong>
            . Участников в снимке: <strong>{formatCount(memberCount)}</strong>.
          </li>
        </ul>
      </section>

      <div className="action-btn-row">
        <Link href="/profile" className="btn btn-outline">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M5.5 19.5c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          Профиль
        </Link>
        <Link href="/documents" className="btn btn-outline">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
            <path
              d="M7 3.75h7.5L19 8.25V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M14.5 3.75V8.5H19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Документы и реестры
        </Link>
        {canSettings ? (
          <Link href="/settings" className="btn btn-outline">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.4 6.4l1.1 1.1M16.5 16.5l1.1 1.1M17.6 6.4l-1.1 1.1M7.5 16.5l-1.1 1.1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Настройки сервера
          </Link>
        ) : null}
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-card-top">
            <span className="metric-label">Серверы</span>
            <span className="metric-icon" aria-hidden>
              ⌂
            </span>
          </div>
          <div className="metric-value">{formatCount(guildCount)}</div>
          <p className="metric-hint muted">активных синхронизированных</p>
        </article>
        <article className="metric-card">
          <div className="metric-card-top">
            <span className="metric-label">Участники</span>
            <span className="metric-icon" aria-hidden>
              ◎
            </span>
          </div>
          <div className="metric-value">{formatCount(memberCount)}</div>
          <p className="metric-hint muted">присутствуют в снимке</p>
        </article>
        <article className="metric-card">
          <div className="metric-card-top">
            <span className="metric-label">Привязки ролей</span>
            <span className="metric-icon" aria-hidden>
              ◆
            </span>
          </div>
          <div className="metric-value">{formatCount(mappingCount)}</div>
          <p className="metric-hint muted">из {formatCount(roleCount)} ролей Discord</p>
        </article>
        <article className="metric-card">
          <div className="metric-card-top">
            <span className="metric-label">Задачи в очереди</span>
            <span className="metric-icon" aria-hidden>
              ▸
            </span>
          </div>
          <div className="metric-value">{formatCount(pendingJobs)}</div>
          <p className="metric-hint muted">jobs со статусом pending</p>
        </article>
      </div>

      {canSettings ? (
        <div className="panel">
          <h2 className="panel-title">Модули</h2>
          <p className="muted" style={{ marginBottom: "0.85rem" }}>
            Быстрый переход к реестрам и настройкам. Токены и регистрации — следующие модули.
          </p>
          <div className="module-chip-row">
            {(
              [
                { label: "Документы", href: "/documents", ready: true },
                { label: "Розыск", href: "/wanted", ready: true },
                { label: "Штрафы", href: "/fines", ready: true },
                { label: "Персонал", href: "/personnel", ready: true },
                { label: "Эмбеды", href: "/settings/embeds", ready: true },
                { label: "Токены", href: "/settings/tokens", ready: false },
              ] as const
            ).map((item) => (
              <Link key={item.href} href={item.href} className="module-chip">
                {item.label}{" "}
                <span className="muted">{item.ready ? "готово" : "скоро"}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
