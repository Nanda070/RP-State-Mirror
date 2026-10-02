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
  const label =
    session.user.name ??
    session.user.username ??
    session.user.discordId;

  // Helpers and above see admin nav; others still get profile via /profile route group later.
  void canAccessAdminArea(identity);
  void canManageSystemSettings(identity);

  return <AppShell userLabel={label}>{children}</AppShell>;
}
