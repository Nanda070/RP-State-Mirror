import {
  canManageModules,
  canManageSystemSettings,
  canViewModules,
  currentLegalVersion,
  getAppearance,
  legalConsentState,
  recordLegalConsent,
} from "@mirror/core";
import type { Session } from "next-auth";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AppearanceSync } from "@/components/appearance-sync";
import { LegalUpdateBar } from "@/components/legal-update-bar";
import { getDashboardEnv } from "@/env";
import { LEGAL_VERSION } from "@/lib/legal";

/**
 * The dashboard shell of a signed-in person: menu, colour preset, the «texts changed» bar.
 * Kept cheap — cookie/session only; identity and data belong on the page (see loading.tsx).
 */
export async function SignedInShell({ session, children }: { session: Session; children: ReactNode }) {
  const discordId = session.user.discordId;
  // The session identity may lag behind Discord by one refresh: it only decides which links are shown.
  // Every page and API route re-checks access against a freshly resolved identity.
  const identity = session.identity;
  // Asked again only when the texts changed after the user accepted them; a first visit after this
  // feature appeared counts as acceptance at sign-in.
  const legalVersion = await currentLegalVersion(LEGAL_VERSION);
  const consent = await legalConsentState(discordId, legalVersion);
  if (consent === "none") await recordLegalConsent(discordId, legalVersion);
  const appearance = await getAppearance(discordId);

  return (
    <AppShell
      displayName={session.user.name ?? session.user.username ?? discordId}
      username={session.user.username ?? null}
      avatarUrl={session.user.image ?? null}
      canManageSystemSettings={identity ? canManageSystemSettings(identity) : false}
      canViewModules={identity ? canViewModules(identity) : false}
      canManageModules={identity ? canManageModules(identity) : false}
      instanceLabel={getDashboardEnv().INSTANCE_LABEL ?? null}
    >
      <AppearanceSync value={appearance} />
      {consent === "outdated" ? <LegalUpdateBar /> : null}
      {children}
    </AppShell>
  );
}
