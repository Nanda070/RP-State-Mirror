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
      <div className="panel">
        <h1 style={{ marginTop: 0 }}>Обзор</h1>
        <p className="muted">
          Добро пожаловать, {session.user.name ?? session.user.username}. Статус:{" "}
          <strong>{badge.primary}</strong>
          {identity.adminLevel ? ` (${ADMIN_LEVEL_LABELS_RU[identity.adminLevel]})` : null}.
        </p>
        <div className="row">
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
        <h2 style={{ marginTop: 0 }}>Что дальше</h2>
        <p className="muted">
          Реестры документов, розысков, штрафов и модули бота появятся на следующих этапах. Сейчас
          доступны вход, профиль и базовые системные настройки.
        </p>
      </div>
    </div>
  );
}
