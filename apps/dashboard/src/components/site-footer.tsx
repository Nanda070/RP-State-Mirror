import Link from "next/link";

const YEAR = new Date().getFullYear();

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="site-footer site-footer-compact">
        <div className="site-footer-inner site-footer-compact-inner">
          <span className="site-footer-brand">Mirror · GTA5RP</span>
          <nav className="footer-inline-nav" aria-label="Документы">
            <Link href="/terms">Условия</Link>
            <Link href="/privacy">Приватность</Link>
            <Link href="/cookies">Cookies</Link>
          </nav>
          <span className="footer-copy">© {YEAR}</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-bar">
          <span className="site-footer-brand">Mirror · GTA5RP</span>
          <nav className="footer-inline-nav" aria-label="Навигация футера">
            <Link href="/">Вход</Link>
            <Link href="/overview">Обзор</Link>
            <Link href="/terms">Условия</Link>
            <Link href="/privacy">Приватность</Link>
            <Link href="/cookies">Cookies</Link>
          </nav>
          <span className="footer-copy">© {YEAR} Mirror · GTA5RP</span>
        </div>
        <p className="site-footer-disclaimer">
          Mirror · GTA5RP — независимый инструмент и не связан с Discord Inc.
        </p>
      </div>
    </footer>
  );
}
