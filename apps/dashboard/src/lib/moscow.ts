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
