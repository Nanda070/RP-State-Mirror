import { getDashboardEnv } from "@/env";

/**
 * Client address for rate limiting and bans. The dashboard runs behind a reverse proxy (Caddy),
 * which sets `X-Forwarded-For`; the first entry is the original client. Without a proxy header
 * (local development) every request shares one bucket.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

/** A cross-site page must not be able to submit our public forms from a visitor's browser. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients send no Origin; they are covered by captcha and limits
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function turnstileSiteKey(): string | null {
  const env = getDashboardEnv();
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Turnstile token. Returns `true` when the captcha is not configured (keys absent),
 * so forms keep working with the remaining protections.
 */
export async function verifyTurnstile(token: string | null | undefined, ip: string): Promise<boolean> {
  const env = getDashboardEnv();
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // Cloudflare unreachable: fail closed, the visitor can retry.
    return false;
  }
}
