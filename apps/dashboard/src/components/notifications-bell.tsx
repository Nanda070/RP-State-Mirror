"use client";

export function NotificationsBell() {
  return (
    <button type="button" className="btn btn-secondary" title="Уведомления появятся в следующих этапах">
      Уведомления
      <span className="badge" style={{ marginLeft: "0.35rem" }}>
        0
      </span>
    </button>
  );
}
