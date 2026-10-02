"use client";

import { motion } from "framer-motion";
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
    <motion.div
      className="cookie-banner"
      role="dialog"
      aria-label="Согласие на cookie"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.2 }}
    >
      <div className="cookie-banner-head">
        <div className="cookie-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="8" />
            <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
            <circle cx="11" cy="14" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div>
          <h2>Мы используем cookie-файлы</h2>
          <p>
            Обязательные cookie нужны для входа и безопасности. Дополнительные — только после
            согласия.{" "}
            <Link href="/cookies">Подробнее</Link>
          </p>
        </div>
      </div>
      <div className="cookie-actions">
        <button type="button" className="btn btn-primary" onClick={() => save("all")}>
          Принять все
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => save("necessary")}>
          Отклонить
        </button>
      </div>
    </motion.div>
  );
}
