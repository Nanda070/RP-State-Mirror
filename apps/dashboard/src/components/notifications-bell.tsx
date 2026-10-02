"use client";

export function NotificationsBell({ variant = "icon" }: { variant?: "icon" | "button" }) {
  if (variant === "button") {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        title="Уведомления появятся в следующих этапах"
      >
        Уведомления
        <span className="badge" style={{ marginLeft: "0.35rem" }}>
          0
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="icon-btn"
      title="Уведомления (скоро)"
      aria-label="Уведомления"
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
  );
}
