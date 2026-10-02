import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginHero } from "@/components/login-hero";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (session?.user) {
    redirect(params.next && params.next.startsWith("/") ? params.next : "/overview");
  }
  return <LoginHero {...(params.next ? { nextPath: params.next } : {})} />;
}
