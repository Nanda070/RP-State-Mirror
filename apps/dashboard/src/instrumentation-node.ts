import { createLogger, runBotDownAlert } from "@mirror/core";

/**
 * The dashboard is the bot's watchdog: the bot cannot report its own death, so the site checks the
 * bot's heartbeat every minute and posts one alert to the webhook from Настройки → Система when
 * the bot goes silent.
 */
const state = globalThis as typeof globalThis & { __mirrorWatchdog?: ReturnType<typeof setInterval> };

// Dev server re-runs the registration on reload: one timer is enough.
if (!state.__mirrorWatchdog) {
  const log = createLogger("dashboard.watchdog");
  state.__mirrorWatchdog = setInterval(() => {
    runBotDownAlert().catch((error: unknown) => {
      log.error({ err: error }, "bot heartbeat check failed");
    });
  }, 60_000);
  state.__mirrorWatchdog.unref();
}
