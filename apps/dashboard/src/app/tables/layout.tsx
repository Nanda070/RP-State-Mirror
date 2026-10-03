import { canManageModules, canManageSystemSettings, canViewModules } from "@mirror/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { BrandMark } from "@/components/brand-mark";
import { isLockedOut, publicLockedOut } from "@/lib/session";

/**
 * «Таблицы» are open to everyone: a signed-in person sees them inside the usual shell,
 * a guest — in a plain public frame with a way to sign in.
 */
export default async function TablesLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (session?.user?.discordId) {
    if (await isLockedOut(session.identity)) redirect("/maintenance");
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
        {children}
      </AppShell>
    );
  }

  if (await publicLockedOut()) redirect("/maintenance");
  return (
    <div className="legal-page tables-public">
      <header className="public-nav">
        <Link href="/" className="public-nav-brand">
          <BrandMark />
          <div>
            <div className="brand">Mirror · GTA5RP</div>
            <span className="sub">Таблицы</span>
          </div>
        </Link>
        <Link href="/?next=/tables" className="btn btn-ghost">
          Войти
        </Link>
      </header>
      <main className="tables-public-main">{children}</main>
    </div>
  );
}
