import { canManageModules, canManageSystemSettings, canViewModules } from "@mirror/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { isLockedOut } from "@/lib/session";

/**
 * Keep the shell layout cheap: cookie/session only.
 * Identity and Discord catalog data belong on the page (see loading.tsx).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.discordId) {
    redirect("/");
  }
  if (await isLockedOut(session.identity)) {
    redirect("/maintenance");
  }

  const displayName =
    session.user.name ?? session.user.username ?? session.user.discordId;
  const username = session.user.username ?? null;
  const avatarUrl = session.user.image ?? null;
  // The session identity may lag behind Discord by one refresh: it only decides which links are shown.
  // Every page and API route re-checks access against a freshly resolved identity.
  const identity = session.identity;
  const canSystemSettings = identity ? canManageSystemSettings(identity) : false;

  return (
    <AppShell
      displayName={displayName}
      username={username}
      avatarUrl={avatarUrl}
      canManageSystemSettings={canSystemSettings}
      canViewModules={identity ? canViewModules(identity) : false}
      canManageModules={identity ? canManageModules(identity) : false}
    >
      {children}
    </AppShell>
  );
}
