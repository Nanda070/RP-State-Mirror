"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "mirror.cookieConsent";

type Consent = "all" | "necessary" | null;

export function CookieBanner() {
  const [consent, setConsent] = useState<Consent>("necessary");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY) as Consent | null;
    setConsent(saved);
    setReady(true);
  }, []);

  if (!ready || consent) return null;

  const save = (value: Exclude<Consent, null>) => {
    window.localStorage.setItem(KEY, value);
    setConsent(value);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-label="Согласие на cookie">
      <p style={{ margin: "0 0 0.85rem" }}>
        Мы используем обязательные cookie для входа и безопасности. Дополнительные — только после
        согласия. Подробнее в{" "}
        <Link href="/cookies" style={{ textDecoration: "underline" }}>
          политике cookie
        </Link>
        .
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => save("all")}>
          Принять все
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => save("necessary")}>
          Только обязательные
        </button>
        <Link href="/cookies" className="btn btn-secondary">
          Настроить
        </Link>
      </div>
    </div>
  );
}
