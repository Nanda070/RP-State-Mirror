"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SiteFooter } from "@/components/site-footer";

const KEY = "mirror.cookieConsent";

export default function CookiesPage() {
  const save = (value: "all" | "necessary") => {
    window.localStorage.setItem(KEY, value);
  };

  return (
    <div className="legal-page">
      <header className="public-nav">
        <Link href="/" className="public-nav-brand">
          <BrandMark />
          <div>
            <div className="brand">Mirror · GTA5RP</div>
            <span className="sub">Dashboard</span>
          </div>
        </Link>
        <Link href="/" className="btn btn-ghost">
          На главную
        </Link>
      </header>
      <main className="legal">
        <p className="muted">
          <Link href="/">← На главную</Link>
        </p>
        <h1>Cookie</h1>
        <p className="muted">Версия от 3 октября 2026 · Mirror · GTA5RP</p>
        <div className="panel stack">
          <p>Какие cookie и локальные данные используются:</p>
          <ul>
            <li>
              <strong>Сессия Auth.js</strong> — обязательная, вход и защита сессии;
            </li>
            <li>
              <strong>Согласие cookie</strong> — ваш выбор на баннере (localStorage).
            </li>
          </ul>
          <p>Обязательные cookie нужны для входа. Остальные — только после согласия.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => save("all")}>
              Принять все
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => save("necessary")}>
              Только обязательные
            </button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
