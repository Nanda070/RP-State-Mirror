"use client";

import Link from "next/link";
import { useState } from "react";

/** Shown inside the dashboard to a user who has not accepted the edition of the terms now in force. */
export function LegalUpdateBar() {
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  if (hidden) return null;

  async function accept() {
    setPending(true);
    try {
      const res = await fetch("/api/legal/consent", { method: "POST" });
      if (res.ok) setHidden(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="legal-update-bar" role="status">
      <span>
        Условия использования и политика конфиденциальности обновлены. Продолжая пользоваться сервисом, вы принимаете новую
        редакцию: <Link href="/terms">условия</Link>, <Link href="/privacy">конфиденциальность</Link>.
      </span>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void accept()}>
        Принимаю
      </button>
    </div>
  );
}
