"use client";

import { useEffect, useId, useRef, useState } from "react";

export function NotificationsBell({ variant = "icon" }: { variant?: "icon" | "button" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  return (
    <div className="notify-root" ref={rootRef}>
      {variant === "button" ? (
        <button
          type="button"
          className="btn btn-secondary"
          title="Уведомления"
          aria-label="Уведомления"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          Уведомления
          <span className="badge" style={{ marginLeft: "0.35rem" }}>
            0
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="icon-btn"
          title="Уведомления"
          aria-label="Уведомления"
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
            <path
              d="M10 18a2 2 0 0 0 4 0"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {open ? (
        <div
          id={panelId}
          className="notify-panel"
          role="dialog"
          aria-label="Уведомления"
        >
          <div className="notify-panel-head">Уведомления</div>
          <div className="notify-panel-body">
            <p className="muted notify-empty">Нет уведомлений</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
