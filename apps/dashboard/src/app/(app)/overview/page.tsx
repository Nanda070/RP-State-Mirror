import { ADMIN_LEVEL_LABELS_RU, buildStatusBadge, canManageSystemSettings } from "@mirror/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveFreshIdentity } from "@/lib/session";

export default async function OverviewPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");

  const identity = await resolveFreshIdentity(session.user.discordId);
  const badge = buildStatusBadge(identity);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Обзор</h1>
        <p className="muted">
          Добро пожаловать, {session.user.name ?? session.user.username}. Статус:{" "}
          <strong style={{ color: "var(--ink)" }}>{badge.primary}</strong>
          {identity.adminLevel ? ` (${ADMIN_LEVEL_LABELS_RU[identity.adminLevel]})` : null}.
        </p>
      </div>
      <div className="panel">
        <h2 className="panel-title">Быстрые действия</h2>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/profile" className="btn btn-secondary">
            Профиль
          </Link>
          {canManageSystemSettings(identity) ? (
            <Link href="/settings" className="btn btn-primary">
              Настройки системы
            </Link>
          ) : null}
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Что дальше</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Реестры документов, розысков, штрафов и модули бота появятся на следующих этапах. Сейчас
          доступны вход, профиль и базовые системные настройки.
        </p>
      </div>
    </div>
  );
}
