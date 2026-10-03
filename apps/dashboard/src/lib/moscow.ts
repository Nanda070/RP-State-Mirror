const TZ = "Europe/Moscow";

export function formatMoscow(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

/** Compact form for tables: «03.10.26 07:18». */
export function formatMoscowShort(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(value)
    .replace(",", "");
}
