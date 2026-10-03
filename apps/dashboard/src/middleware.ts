import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/settings", "/profile", "/overview", "/documents", "/wanted", "/fines"];

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

export const config = {
  matcher: [
    "/settings",
    "/settings/:path*",
    "/profile",
    "/profile/:path*",
    "/overview",
    "/overview/:path*",
    "/documents",
    "/documents/:path*",
    "/wanted",
    "/wanted/:path*",
    "/fines",
    "/fines/:path*",
  ],
};
