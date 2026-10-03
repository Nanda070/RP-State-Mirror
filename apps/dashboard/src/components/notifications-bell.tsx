"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type Notice = { key: string; text: string; href: string; count: number; tone: "warn" | "bad" };
/** What the viewer has waved away: notice key → the count it had at that moment. */
type Dismissed = Record<string, number>;

const STORE_KEY = "mirror.notices.dismissed";

function readDismissed(): Dismissed {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Dismissed) : {};
  } catch {
    return {};
  }
}

/**
 * Things that wait for the viewer: applications to decide, open tickets, failed jobs, unpaid fines.
 * Counted on the server from the registries. A notice can be hidden; it comes back only when its
 * count grows — that is, when something new has happened.
 */
export function NotificationsBell({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Dismissed>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setDismissed(readDismissed());
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

  function hide(target: Notice[]) {
    const next = { ...dismissed };
    for (const notice of target) next[notice.key] = notice.count;
    setDismissed(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Storage is blocked: hidden for this page view only.
    }
  }

  const visible = notices.filter((notice) => notice.count > (dismissed[notice.key] ?? 0));
  const total = visible.reduce((sum, notice) => sum + notice.count, 0);
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
            {visible.length === 0 ? (
              <p className="muted notify-empty">Новых уведомлений нет</p>
            ) : (
              <>
                {visible.map((notice) => (
                  <div key={notice.key} className="notify-item">
                    <Link href={notice.href} onClick={() => setOpen(false)}>
                      <span className="registry-status" data-status={notice.tone}>
                        {notice.count}
                      </span>
                      <span>{notice.text}</span>
                    </Link>
                    <button
                      type="button"
                      className="notify-dismiss"
                      title="Скрыть"
                      aria-label={`Скрыть: ${notice.text}`}
                      onClick={() => hide([notice])}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="notify-foot">
                  <button type="button" className="btn btn-ghost" onClick={() => hide(visible)}>
                    Скрыть все
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
