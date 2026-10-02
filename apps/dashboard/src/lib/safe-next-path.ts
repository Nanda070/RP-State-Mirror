/**
 * Same-origin relative path only: single leading `/`, no protocol-relative
 * or backslash open-redirect tricks (`//evil`, `/\evil`, `/\\evil`).
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next.includes("\\") || next.includes("://")) return null;
  return next;
}
