/**
 * How fast the bot answers people: from the moment Discord created an interaction (its id is a
 * snowflake, so the time is inside it) to the bot's first answer to it — a reply, a «thinking…»,
 * a window or an update of the message. Measured on every answer the bot sends to Discord, so no
 * handler has to remember to report it. The heartbeat carries the median and the 95th percentile
 * of the last answers to the status page.
 */
import { RESTEvents, SnowflakeUtil, type Client } from "discord.js";
import type { Logger } from "@mirror/core";

const WINDOW = 500;
/** An answer slower than this is logged: Discord drops interactions not answered within 3 s. */
const SLOW_MS = 2_000;

const samples: number[] = [];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

export function answerSpeed(): { ackP50Ms: number; ackP95Ms: number; ackSamples: number } | Record<string, never> {
  if (samples.length === 0) return {};
  const sorted = [...samples].sort((a, b) => a - b);
  return { ackP50Ms: percentile(sorted, 0.5), ackP95Ms: percentile(sorted, 0.95), ackSamples: samples.length };
}

/** `/interactions/<id>/<token>/callback` — the first answer to an interaction. */
const CALLBACK_PATH = /^\/interactions\/(\d{17,20})\/[^/]+\/callback/;

export function watchAnswerSpeed(client: Client, log: Logger) {
  client.rest.on(RESTEvents.Response, (request) => {
    const match = CALLBACK_PATH.exec(String(request.path));
    if (!match?.[1]) return;
    const ms = Math.max(0, Date.now() - SnowflakeUtil.timestampFrom(match[1]));
    samples.push(ms);
    if (samples.length > WINDOW) samples.shift();
    if (ms > SLOW_MS) log.warn({ ms, route: request.route }, "slow answer to an interaction");
  });
  // Discord made the bot wait: worth seeing in the log when answers get slow.
  client.rest.on(RESTEvents.RateLimited, (info) => {
    log.warn({ route: info.route, timeToReset: info.timeToReset, global: info.global }, "Discord rate limit hit");
  });
}
