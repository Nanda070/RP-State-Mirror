import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { SignedInShell } from "@/components/signed-in-shell";
import { isLockedOut } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.discordId) {
    redirect("/");
  }
  if (await isLockedOut(session.identity)) {
    redirect("/maintenance");
  }
  return <SignedInShell session={session}>{children}</SignedInShell>;
}
