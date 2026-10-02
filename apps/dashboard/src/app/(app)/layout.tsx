import { canAccessAdminArea, canManageSystemSettings } from "@mirror/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { resolveFreshIdentity } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.discordId) {
    redirect("/");
  }

  const identity = await resolveFreshIdentity(session.user.discordId);
  const displayName =
    session.user.name ?? session.user.username ?? session.user.discordId;
  const username = session.user.username ?? null;
  const avatarUrl = session.user.image ?? null;

  // Keep identity helpers warm for route gates; shell itself is available to all signed-in users.
  void canAccessAdminArea(identity);
  void canManageSystemSettings(identity);

  return (
    <AppShell displayName={displayName} username={username} avatarUrl={avatarUrl}>
      {children}
    </AppShell>
  );
}
