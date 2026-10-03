import { ZodError, type ZodIssue } from "zod";

function messagesFromIssues(issues: readonly ZodIssue[]): string {
  const parts = issues.map((issue) => issue.message.trim()).filter(Boolean);
  if (parts.length === 0) return "Некорректные данные";
  return [...new Set(parts)].join("; ");
}

/** True when `text` looks like a stringified Zod issues array dumped into Error.message. */
function tryParseZodIssuesJson(text: string): ZodIssue[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first = parsed[0];
    if (!first || typeof first !== "object" || !("message" in first) || !("code" in first)) return null;
    return parsed as ZodIssue[];
  } catch {
    return null;
  }
}

/**
 * Format an unknown thrown value for Discord / end-user Russian UI.
 * Never returns raw Zod issue JSON arrays.
 */
export function formatUserError(error: unknown, fallback = "Неизвестная ошибка"): string {
  if (error instanceof ZodError) {
    return messagesFromIssues(error.issues);
  }
  if (error instanceof Error) {
    const fromJson = tryParseZodIssuesJson(error.message);
    if (fromJson) return messagesFromIssues(fromJson);
    const message = error.message.trim();
    return message || fallback;
  }
  if (typeof error === "string") {
    const fromJson = tryParseZodIssuesJson(error);
    if (fromJson) return messagesFromIssues(fromJson);
    const message = error.trim();
    return message || fallback;
  }
  return fallback;
}
