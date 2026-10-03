/**
 * Shared text helpers ported from the legacy Python bot (utils.py).
 */
import { z } from "zod";
import { UserError } from "./errors.js";

const LINK_RE = /^https?:\/\//i;
const DURATION_RE = /^(\d+)([mhd])$/i;

/**
 * User-entered record numbers for /пост, /штраф, /объявить-розыск (legacy «номер»).
 * Letters/digits plus `. _ -`, normalized to uppercase — e.g. LSPD-042, W-12, F-7.
 */
export const recordNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Некорректный номер")
  .transform((value) => value.toUpperCase());

/** Render a URL as a Discord markdown link, or pass plain text through. */
export function normalizeLinkOrText(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "Не указано";
  if (LINK_RE.test(text)) return `[Открыть](${text})`;
  return text;
}

/**
 * Parse a short duration string used by /штраф «срок_оплаты».
 * Supported: `30m`, `24h`, `14d` (minutes / hours / days).
 */
export function parseDuration(value: string): { ms: number; text: string } {
  const trimmed = value.trim();
  const match = DURATION_RE.exec(trimmed.toLowerCase());
  if (!match) {
    throw new UserError("Формат срока оплаты: 30m, 24h или 14d");
  }
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const ms =
    unit === "m" ? amount * 60_000 : unit === "h" ? amount * 3_600_000 : amount * 86_400_000;
  return { ms, text: trimmed };
}

/** Spoiler-wrap a forum link the way the legacy document/wanted embeds did. */
export function spoilerLink(url: string): string {
  const text = url.trim();
  if (!text) return "Не указано";
  return `||${text}||`;
}

/**
 * Format a server money amount in USD for Russian UI copy.
 * Example: `5000` → `$5 000`.
 */
export function formatMoney(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(String(amount).replace(/\s/g, ""));
  if (!Number.isFinite(n)) return String(amount);
  return `$${Math.trunc(n).toLocaleString("ru-RU")}`;
}

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d{1,20}\/[\w-]+$/;

/** Only real Discord webhook URLs: the bot posts to this address, so an arbitrary host would be SSRF. */
export const discordWebhookUrlSchema = z
  .string()
  .trim()
  .regex(DISCORD_WEBHOOK_RE, "Нужна ссылка вебхука Discord вида https://discord.com/api/webhooks/…");
