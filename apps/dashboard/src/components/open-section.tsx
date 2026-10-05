import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { PublicSectionNav } from "@/components/public-section-nav";
import { SignedInShell } from "@/components/signed-in-shell";
import { isLockedOut, publicLockedOut } from "@/lib/session";

/**
 * Frame of a section that is open to everyone: a signed-in person sees it inside the usual
 * shell, a guest — in a plain public frame with the open sections and a way to sign in.
 */
export async function OpenSection({ children, tables = false }: { children: ReactNode; tables?: boolean }) {
  const session = await auth();

  if (session?.user?.discordId) {
    if (await isLockedOut(session.identity)) redirect("/maintenance");
    return <SignedInShell session={session}>{children}</SignedInShell>;
  }

  if (await publicLockedOut()) redirect("/maintenance");
  return (
    <div className={tables ? "legal-page tables-public" : "legal-page"}>
      <header className="public-nav">
        <Link href="/" className="public-nav-brand">
          <BrandMark />
          <div className="brand">Mirror · GTA5RP</div>
        </Link>
        <PublicSectionNav />
      </header>
      <main className={tables ? "tables-public-main" : "content"}>{children}</main>
    </div>
  );
}
