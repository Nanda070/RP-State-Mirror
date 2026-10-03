import {
  canManageModules,
  canManageSystemSettings,
  canViewModules,
  currentLegalVersion,
  legalConsentState,
  recordLegalConsent,
} from "@mirror/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { LegalUpdateBar } from "@/components/legal-update-bar";
import { LEGAL_VERSION } from "@/lib/legal";
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
  // Asked again only when the texts changed after the user accepted them; a first visit after this
  // feature appeared counts as acceptance at sign-in.
  const legalVersion = await currentLegalVersion(LEGAL_VERSION);
  const consent = await legalConsentState(session.user.discordId, legalVersion);
  if (consent === "none") await recordLegalConsent(session.user.discordId, legalVersion);
  const needsConsent = consent === "outdated";

  return (
    <AppShell
      displayName={displayName}
      username={username}
      avatarUrl={avatarUrl}
      canManageSystemSettings={canSystemSettings}
      canViewModules={identity ? canViewModules(identity) : false}
      canManageModules={identity ? canManageModules(identity) : false}
    >
      {needsConsent ? <LegalUpdateBar /> : null}
      {children}
    </AppShell>
  );
}
