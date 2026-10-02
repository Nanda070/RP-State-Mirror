import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const bootstrap = params.reason === "bootstrap";

  return (
    <main className="legal">
      <h1>Доступ ограничен</h1>
      <div className="panel">
        {bootstrap ? (
          <p>
            Главный сервер ещё не настроен. Пока первичную настройку может выполнить только
            пользователь из списка главных админов (`SUPER_ADMIN_USER_IDS`).
          </p>
        ) : (
          <p>Недостаточно прав для этого раздела или вход был отклонён.</p>
        )}
        <Link href="/" className="btn btn-primary">
          На страницу входа
        </Link>
      </div>
      <SiteFooter />
    </main>
  );
}
