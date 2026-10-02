import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SiteFooter } from "@/components/site-footer";

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const bootstrap = params.reason === "bootstrap";

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
        <h1>Доступ ограничен</h1>
        <div className="panel stack">
          {bootstrap ? (
            <p>
              Главный сервер ещё не настроен. Пока первичную настройку может выполнить только
              пользователь из списка главных админов (`SUPER_ADMIN_USER_IDS`).
            </p>
          ) : (
            <p>Недостаточно прав для этого раздела или вход был отклонён.</p>
          )}
          <div>
            <Link href="/" className="btn btn-primary">
              На страницу входа
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
