"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type Notice = { key: string; text: string; href: string; count: number; tone: "warn" | "bad" };

const REFRESH_MS = 60_000;

/**
 * Things that wait for the viewer: applications to decide, open tickets, failed jobs, unpaid fines.
 * The list is counted on the server from the registries themselves, so it is always current and
 * needs no «mark as read».
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notices?: Notice[] };
        if (!cancelled) setNotices(data.notices ?? []);
      } catch {
        // Offline or the server is restarting: keep what is shown, try again on the next tick.
      }
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const total = notices.reduce((sum, notice) => sum + notice.count, 0);
  const label = total > 0 ? `Уведомления: ${total}` : "Уведомления";

  return (
    <div className="notify-root" ref={rootRef}>
      <button
        type="button"
        className="icon-btn"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
          <path
            d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {total > 0 ? (
          <span className="notify-count" aria-hidden>
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div id={panelId} className="notify-panel" role="dialog" aria-label="Уведомления">
          <div className="notify-panel-head">Требует внимания</div>
          <div className="notify-panel-body">
            {notices.length === 0 ? (
              <p className="muted notify-empty">Ничего не ждёт вашего решения</p>
            ) : (
              notices.map((notice) => (
                <Link key={notice.key} href={notice.href} className="notify-item" onClick={() => setOpen(false)}>
                  <span className="registry-status" data-status={notice.tone}>
                    {notice.count}
                  </span>
                  <span>{notice.text}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
