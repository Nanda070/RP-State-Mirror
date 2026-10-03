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
  "/stats",
  "/status",
];

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(
    req.cookies.get("authjs.session-token") ??
      req.cookies.get("__Secure-authjs.session-token") ??
      req.cookies.get("next-auth.session-token") ??
      req.cookies.get("__Secure-next-auth.session-token"),
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
    "/stats/:path*",
    "/status/:path*",
  ],
};
