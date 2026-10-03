import { getLockdown } from "@mirror/core";
import Link from "next/link";
import { NoticePage } from "@/components/notice-page";

export const metadata = { title: "Технические работы" };
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const lockdown = await getLockdown();

  return (
    <NoticePage
      code="Техработы"
      title={lockdown.enabled ? "Сервис временно закрыт" : "Работы завершены"}
      actions={
        <Link href={lockdown.enabled ? "/maintenance" : "/overview"} className="btn btn-primary">
          {lockdown.enabled ? "Проверить ещё раз" : "Вернуться в дашборд"}
        </Link>
      }
    >
      {lockdown.enabled ? (
        <>
          <p>Дашборд и команды бота недоступны: администрация проводит технические работы.</p>
          {lockdown.reason ? <p>Причина: {lockdown.reason}</p> : null}
          <p>Ваши данные и заявки сохранены. Зайдите немного позже.</p>
        </>
      ) : (
        <p>Сервис снова работает в обычном режиме.</p>
      )}
    </NoticePage>
  );
}
