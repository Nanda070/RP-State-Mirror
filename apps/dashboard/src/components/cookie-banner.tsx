"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LEGAL_VERSION } from "@/lib/legal";

const KEY = "mirror.cookieConsent";

/**
 * Cookie notice. The site sets only the cookies sign-in needs, so there is nothing to opt into:
 * the notice says so and is dismissed once. It comes back when the legal texts change.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(KEY) !== LEGAL_VERSION);
    } catch {
      // Storage is blocked (private mode): show the notice, it simply will not be remembered.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, LEGAL_VERSION);
    } catch {
      // Nothing to do: the notice closes for this page view.
    }
    setVisible(false);
  };

  return (
    <motion.div
      className="cookie-banner"
      role="region"
      aria-label="Уведомление о cookie"
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
          <h2>Только необходимые cookie</h2>
          <p>
            Сайт использует cookie лишь для входа и защиты сессии. Рекламы и аналитики нет.{" "}
            <Link href="/cookies">Что именно сохраняется</Link>
          </p>
        </div>
      </div>
      <div className="cookie-actions">
        <button type="button" className="btn btn-primary" onClick={dismiss}>
          Понятно
        </button>
        <Link href="/privacy" className="btn btn-secondary">
          Конфиденциальность
        </Link>
      </div>
    </motion.div>
  );
}
