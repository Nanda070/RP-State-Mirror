"use client";

import { useEffect, useState } from "react";

const TZ = "Europe/Moscow";

function formatParts(now: Date) {
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time };
}

export function MskClock() {
  const [parts, setParts] = useState(() => formatParts(new Date()));

  useEffect(() => {
    const tick = () => setParts(formatParts(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="msk-clock" title="Время по Москве">
      <span className="msk-clock-date" suppressHydrationWarning>
        {parts.date}
      </span>
      <span className="msk-clock-time" suppressHydrationWarning>
        {parts.time} <span className="msk-tz">МСК</span>
      </span>
    </div>
  );
}
