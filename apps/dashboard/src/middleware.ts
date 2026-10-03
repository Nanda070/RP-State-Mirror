import { type NextRequest, NextResponse } from "next/server";

/** Sections that need a session. Public pages (`/f/*`, `/s/*`, legal) are intentionally absent. */
const PROTECTED_PREFIXES = [
  "/settings",
  "/profile",
  "/overview",
  "/documents",
  "/wanted",
  "/fines",
  "/registrations",
  "/personnel",
  "/feedback",
  "/ic-blacklist",
  "/catalog",
  "/calculator",
  "/faq",
  "/bans",
  "/transfers",
  "/tokens",
  "/audit",
  "/jobs",
];

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(
    req.cookies.get("authjs.session-token") ??
      req.cookies.get("__Secure-authjs.session-token") ??
      req.cookies.get("next-auth.session-token") ??
      req.cookies.get("__Secure-next-auth.session-token"),
  );
}

// Rate limit for requests that change something. Counted per session cookie (per visitor for the
// public form), in memory: one dashboard process serves the site. Reads are not limited.
const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 90;
const writes = new Map<string, { count: number; resetAt: number }>();

function sessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get("__Secure-authjs.session-token")?.value ??
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-next-auth.session-token")?.value ??
    req.cookies.get("next-auth.session-token")?.value
  );
}

/** True when this caller has used up the minute's allowance. */
function overLimit(req: NextRequest): boolean {
  // The tail of the signed cookie is unique per session; no personal data is kept as the key.
  const key = sessionCookie(req)?.slice(-48) ?? "guest";
  const now = Date.now();
  const entry = writes.get(key);
  if (!entry || entry.resetAt <= now) {
    writes.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (writes.size > 5_000) {
      for (const [stale, value] of writes) if (value.resetAt <= now) writes.delete(stale);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_WRITES_PER_WINDOW;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD" && !pathname.startsWith("/api/auth/") && overLimit(req)) {
      return NextResponse.json(
        { error: "Слишком много действий подряд. Подождите минуту." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    return NextResponse.next();
  }
  const needsAuth = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!needsAuth || hasSessionCookie(req)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Next.js requires a static literal here; keep it in sync with PROTECTED_PREFIXES.
export const config = {
  matcher: [
    "/api/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/overview/:path*",
    "/documents/:path*",
    "/wanted/:path*",
    "/fines/:path*",
    "/registrations/:path*",
    "/personnel/:path*",
    "/feedback/:path*",
    "/ic-blacklist/:path*",
    "/catalog/:path*",
    "/calculator/:path*",
    "/faq/:path*",
    "/bans/:path*",
    "/transfers/:path*",
    "/tokens/:path*",
    "/audit/:path*",
    "/jobs/:path*",
  ],
};
