/**
 * Runs once when the dashboard server starts. The dashboard is the bot's watchdog: the bot cannot
 * report its own death, so the site checks the bot's heartbeat every minute and posts one alert to
 * the webhook from Настройки → Система when the bot goes silent.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const state = globalThis as typeof globalThis & { __mirrorWatchdog?: ReturnType<typeof setInterval> };
  // Dev server re-runs register() on reload: one timer is enough.
  if (state.__mirrorWatchdog) return;

  const { createLogger, runBotDownAlert } = await import("@mirror/core");
  const log = createLogger("dashboard.watchdog");
  state.__mirrorWatchdog = setInterval(() => {
    runBotDownAlert().catch((error: unknown) => {
      log.error({ err: error }, "bot heartbeat check failed");
    });
  }, 60_000);
  state.__mirrorWatchdog.unref();
}
