import { dashboardEnvSchema, parseEnv, type DashboardEnv } from "@mirror/core";

let cached: DashboardEnv | null = null;

export function authBaseUrl(env: DashboardEnv): string {
  const callback = new URL(env.OAUTH_REDIRECT_URL);
  return `${callback.protocol}//${callback.host}`;
}

export function getDashboardEnv(): DashboardEnv {
  if (cached) return cached;
  const env = parseEnv(dashboardEnvSchema);
  process.env.AUTH_SECRET = env.SESSION_SECRET;
  process.env.AUTH_URL = authBaseUrl(env);
  cached = env;
  return env;
}
