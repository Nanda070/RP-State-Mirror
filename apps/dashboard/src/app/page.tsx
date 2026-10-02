import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginHero } from "@/components/login-hero";
import { safeNextPath } from "@/lib/safe-next-path";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (session?.user) {
    redirect(next ?? "/overview");
  }
  return <LoginHero {...(next ? { nextPath: next } : {})} />;
}
