import Link from "next/link";

const YEAR = new Date().getFullYear();

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.27 5.33A16.3 16.3 0 0 0 15.43 4a.1.1 0 0 0-.1.05c-.17.3-.36.7-.5 1.01a15.1 15.1 0 0 0-4.66 0c-.14-.32-.34-.7-.51-1.01A.1.1 0 0 0 9.56 4a16.26 16.26 0 0 0-3.84 1.33.09.09 0 0 0-.04.03C2.43 9.14 1.6 12.85 2 16.51c0 .02.01.04.03.05a16.5 16.5 0 0 0 4.97 2.52.1.1 0 0 0 .11-.04c.38-.52.72-1.07 1.01-1.65a.1.1 0 0 0-.05-.14 10.9 10.9 0 0 1-1.56-.75.1.1 0 0 1-.01-.17c.1-.08.21-.16.31-.24a.1.1 0 0 1 .1-.01c3.28 1.5 6.83 1.5 10.07 0a.1.1 0 0 1 .1.01c.1.08.21.16.32.24a.1.1 0 0 1-.01.17c-.5.29-1.02.54-1.56.75a.1.1 0 0 0-.05.14c.3.58.64 1.13 1.01 1.65a.1.1 0 0 0 .11.04 16.45 16.45 0 0 0 4.98-2.52.1.1 0 0 0 .03-.05c.48-4.24-.8-7.91-3.38-11.15a.07.07 0 0 0-.04-.03ZM9.7 14.33c-.99 0-1.8-.9-1.8-2.02s.8-2.02 1.8-2.02 1.81.91 1.8 2.02-.8 2.02-1.8 2.02Zm4.61 0c-.99 0-1.8-.9-1.8-2.02s.8-2.02 1.8-2.02 1.81.91 1.8 2.02-.81 2.02-1.8 2.02Z" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-grid">
          <div>
            <p className="site-footer-brand">Mirror · GTA5RP</p>
            <p className="site-footer-desc">
              Единый дашборд государственных фракций — вход через Discord, права по ролям на главном
              сервере.
            </p>
            <div className="social-row">
              <a
                className="social-btn"
                href="#"
                aria-label="Discord"
                title="Discord (ссылка будет настроена позже)"
              >
                <DiscordIcon />
              </a>
            </div>
          </div>

          <div className="footer-col">
            <h3>Сервисы</h3>
            <ul>
              <li>
                <Link href="/">Вход</Link>
              </li>
              <li>
                <Link href="/overview">Обзор</Link>
              </li>
              <li>
                <Link href="/profile">Профиль</Link>
              </li>
              <li>
                <Link href="/settings">Настройки</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h3>Документы</h3>
            <ul>
              <li>
                <Link href="/terms">Условия</Link>
              </li>
              <li>
                <Link href="/privacy">Приватность</Link>
              </li>
              <li>
                <Link href="/cookies">Cookies</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h3>Сообщество</h3>
            <ul>
              <li>
                <a href="#" title="Будет настроено позже">
                  Discord
                </a>
              </li>
              <li>
                <Link href="/">Дашборд</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="site-footer-bottom">
          <p className="disclaimer">
            Disclaimer: Mirror · GTA5RP — независимый инструмент проекта и не связан с Discord Inc.
            Discord — товарный знак Discord Inc.
          </p>
          <p>© {YEAR} Mirror · GTA5RP. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
