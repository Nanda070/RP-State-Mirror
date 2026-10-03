import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Keep the shell layout cheap: cookie/session only.
 * Identity and Discord catalog data belong on the page (see loading.tsx).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.discordId) {
    redirect("/");
  }

  const displayName =
    session.user.name ?? session.user.username ?? session.user.discordId;
  const username = session.user.username ?? null;
  const avatarUrl = session.user.image ?? null;

  return (
    <AppShell displayName={displayName} username={username} avatarUrl={avatarUrl}>
      {children}
    </AppShell>
  );
}
