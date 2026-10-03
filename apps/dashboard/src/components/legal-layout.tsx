import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { SiteFooter } from "./site-footer";
import { LEGAL_VERSION_RU } from "@/lib/legal";

const PAGES = [
  { href: "/terms", label: "Условия использования" },
  { href: "/privacy", label: "Конфиденциальность" },
  { href: "/cookies", label: "Cookie" },
];

/** Shared frame of the legal pages: brand, links between the three documents, version date. */
export function LegalLayout({
  current,
  title,
  version,
  children,
}: {
  current: string;
  title: string;
  /** Edition published in the dashboard; omitted — the built-in text and its date. */
  version?: string;
  children: ReactNode;
}) {
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
        <nav className="settings-tabs" aria-label="Юридические документы">
          {PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="settings-tab"
              data-active={page.href === current ? "" : undefined}
              aria-current={page.href === current ? "page" : undefined}
            >
              {page.label}
            </Link>
          ))}
        </nav>
        <h1>{title}</h1>
        <p className="muted">Редакция от {version ?? LEGAL_VERSION_RU}</p>
        <article className="panel legal-text">{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}

/** How to reach the operator, phrased once for all three documents. */
export function LegalContact() {
  return <>через раздел «Обратная связь» в Discord (кнопка обращения на сервере проекта)</>;
}
