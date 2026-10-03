/**
 * Shared text helpers ported from the legacy Python bot (utils.py).
 */

const LINK_RE = /^https?:\/\//i;
const DURATION_RE = /^(\d+)([mhd])$/i;

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
    throw new Error("Формат срока оплаты: 30m, 24h или 14d");
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
