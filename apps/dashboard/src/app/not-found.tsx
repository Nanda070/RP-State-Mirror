import { canManageModules, canManageSystemSettings, canViewModules } from "@mirror/core";
import Link from "next/link";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { NoticePage } from "@/components/notice-page";
import { isLockedOut } from "@/lib/session";

export const metadata = { title: "Страница не найдена" };

/**
 * 404. A signed-in user stays inside the dashboard — menu and search are at hand; a guest gets the
 * standalone page in the login style.
 */
export default async function NotFound() {
  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user?.discordId) && !(await isLockedOut(session?.identity));

  if (!signedIn || !session) {
    return (
      <NoticePage
        code="404"
        title="Страница не найдена"
        actions={
          <Link href="/" className="btn btn-primary">
            На страницу входа
          </Link>
        }
      >
        <p>Такой страницы нет: ссылка устарела, была отозвана или в адресе опечатка.</p>
        <p>Публичные ссылки на записи и формы перестают работать, когда администратор их закрывает.</p>
      </NoticePage>
    );
  }

  const identity = session.identity;
  return (
    <AppShell
      displayName={session.user.name ?? session.user.username ?? session.user.discordId}
      username={session.user.username ?? null}
      avatarUrl={session.user.image ?? null}
      canManageSystemSettings={identity ? canManageSystemSettings(identity) : false}
      canViewModules={identity ? canViewModules(identity) : false}
      canManageModules={identity ? canManageModules(identity) : false}
    >
      <div className="panel empty-state notice-inline">
        <p className="notice-code">404</p>
        <h1>Страница не найдена</h1>
        <p className="muted">Такой страницы нет: ссылка устарела или в адресе опечатка.</p>
        <div className="notice-actions">
          <Link href="/overview" className="btn btn-primary">
            На главную
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
