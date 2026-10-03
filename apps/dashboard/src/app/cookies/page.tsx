import Link from "next/link";
import { LegalLayout } from "@/components/legal-layout";

export const metadata = { title: "Cookie · Mirror" };

const COOKIES: { name: string; kind: string; purpose: string; kept: string }[] = [
  {
    name: "authjs.session-token (на HTTPS — __Secure-authjs.session-token)",
    kind: "Cookie, обязательная",
    purpose: "Ваша сессия после входа через Discord. Без неё сайт не узнаёт вас",
    kept: "14 дней или до выхода",
  },
  {
    name: "authjs.csrf-token (на HTTPS — __Host-authjs.csrf-token)",
    kind: "Cookie, обязательная",
    purpose: "Защита форм входа и выхода от подделки запроса",
    kept: "До закрытия браузера",
  },
  {
    name: "authjs.callback-url",
    kind: "Cookie, обязательная",
    purpose: "Запоминает страницу, на которую вернуть вас после входа",
    kept: "До закрытия браузера",
  },
  {
    name: "authjs.state, authjs.pkce.code_verifier",
    kind: "Cookie, обязательные",
    purpose: "Проверка, что ответ от Discord пришёл на ваш запрос входа",
    kept: "15 минут, только во время входа",
  },
  {
    name: "mirror.cookieConsent",
    kind: "Локальное хранилище браузера",
    purpose: "Помнит, что вы прочитали это уведомление, чтобы не показывать его снова",
    kept: "Пока вы не очистите данные сайта",
  },
];

export default function CookiesPage() {
  return (
    <LegalLayout current="/cookies" title="Cookie">
      <h2>Коротко</h2>
      <p>
        Сайт использует только то, без чего не работает вход. Рекламных и аналитических cookie, сторонних
        счётчиков и пикселей на сайте нет, поэтому и выбирать категории не требуется: отключить можно только
        обязательные cookie, а без них войти не получится.
      </p>

      <h2>Что именно сохраняется в вашем браузере</h2>
      <div className="registry-table-wrap">
        <table className="registry-table legal-table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Назначение</th>
              <th>Срок</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((row) => (
              <tr key={row.name}>
                <td className="registry-mono">{row.name}</td>
                <td>{row.kind}</td>
                <td>{row.purpose}</td>
                <td>{row.kept}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Cookie Discord</h2>
      <p>
        Вход выполняется на сайте Discord: на время входа вы переходите на discord.com, где действуют cookie и
        политика Discord. Аватары и баннеры загружаются с серверов Discord (cdn.discordapp.com) — при этом Discord
        получает ваш IP-адрес, как при открытии любой картинки.
      </p>

      <h2>Как отказаться</h2>
      <ul>
        <li>Выйдите из аккаунта — сессионная cookie будет удалена, а сессия завершена на сервере.</li>
        <li>Очистите данные сайта в настройках браузера — удалятся все cookie и локальные записи.</li>
        <li>Запретите cookie для этого сайта в браузере — тогда вход работать не будет, публичные страницы останутся доступны.</li>
      </ul>

      <h2>Если что-то изменится</h2>
      <p>
        Если на сайте появятся необязательные cookie (например, аналитика), они будут включаться только после
        вашего согласия, а эта страница и уведомление — обновлены заранее. Как обрабатываются остальные данные,
        описано в <Link href="/privacy">политике конфиденциальности</Link>.
      </p>
    </LegalLayout>
  );
}
