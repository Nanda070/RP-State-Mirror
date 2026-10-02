import { buildStatusBadge, canManageSystemSettings } from "@mirror/core";
import { JobStatus, RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveFreshIdentity } from "@/lib/session";

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export default async function OverviewPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");

  const identity = await resolveFreshIdentity(session.user.discordId);
  const badge = buildStatusBadge(identity);
  const canSettings = canManageSystemSettings(identity);

  const [guildCount, memberCount, mappingCount, roleCount, pendingJobs] = await Promise.all([
    prisma.guild.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.guildMember.count({ where: { isPresent: true } }),
    prisma.roleMapping.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.discordRole.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.job.count({ where: { status: JobStatus.PENDING } }),
  ]);

  const displayName = session.user.name ?? session.user.username ?? "пользователь";

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Обзор</h1>
        <p className="muted">
          Добро пожаловать, {displayName}. Статус:{" "}
          <strong style={{ color: "var(--ink)" }}>{badge.primary}</strong>.
        </p>
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

      <div className="overview-split">
        <div className="panel">
          <h2 className="panel-title">Быстрые действия</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Переход к профилю и системным настройкам без лишних кликов.
          </p>
          <div className="row" style={{ marginTop: "0.85rem" }}>
            <Link href="/profile" className="btn btn-secondary">
              Профиль
            </Link>
            {canSettings ? (
              <>
                <Link href="/settings" className="btn btn-secondary">
                  Модули настроек
                </Link>
                <Link href="/settings/system" className="btn btn-primary">
                  Система
                </Link>
              </>
            ) : null}
          </div>
        </div>
        <div className="panel">
          <h2 className="panel-title">Состояние платформы</h2>
          <ul className="status-list">
            <li>
              <span className="status-dot" data-ok={guildCount > 0} />
              Синхронизация серверов
              <strong>{guildCount > 0 ? "есть данные" : "ожидает бота"}</strong>
            </li>
            <li>
              <span className="status-dot" data-ok={mappingCount > 0} />
              Карта ролей
              <strong>{mappingCount > 0 ? `${formatCount(mappingCount)} привязок` : "не настроена"}</strong>
            </li>
            <li>
              <span className="status-dot" data-ok={pendingJobs === 0} />
              Очередь задач
              <strong>{pendingJobs === 0 ? "пусто" : `${formatCount(pendingJobs)} в ожидании`}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Что дальше</h2>
        <p className="muted" style={{ marginBottom: "0.85rem" }}>
          Реестры документов, розысков, штрафов и модули бота появятся на отдельных страницах
          настроек. Сейчас доступны вход, профиль, системные серверы и привязка ролей.
        </p>
        {canSettings ? (
          <div className="module-chip-row">
            {(
              [
                { label: "Документы", href: "/settings/documents" },
                { label: "Розыск", href: "/settings/wanted" },
                { label: "Штрафы", href: "/settings/fines" },
                { label: "Токены", href: "/settings/tokens" },
              ] as const
            ).map((item) => (
              <Link key={item.href} href={item.href} className="module-chip">
                {item.label} <span className="muted">скоро</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
