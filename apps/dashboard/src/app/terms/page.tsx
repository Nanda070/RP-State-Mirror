import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SiteFooter } from "@/components/site-footer";

export default function TermsPage() {
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
        <h1>Условия использования</h1>
        <p className="muted">Версия от 3 октября 2026 · Mirror · GTA5RP</p>
        <div className="panel stack">
          <p>
            Сервис Mirror предназначен для администрации и игроков государственных фракций проекта
            GTA5RP Mirror. Используя дашборд и связанного Discord-бота, вы соглашаетесь с этими
            условиями.
          </p>
          <p>
            Вход выполняется через Discord OAuth. Доступ к разделам определяется ролями на главном
            сервере и настройками в дашборде. Запрещено обходить проверки прав, пытаться получить
            доступ к чужим данным и использовать сервис для действий вне правил сервера.
          </p>
          <p>
            Администрация Mirror может ограничить доступ (технический бан) при злоупотреблениях.
            Тексты условий могут обновляться; актуальная версия всегда доступна на этой странице.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
