"use client";

import Link from "next/link";
import { NoticePage } from "@/components/notice-page";

/** Error boundary for the whole site. Client component by Next.js contract; the root layout stays. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <NoticePage
      code="Ошибка"
      title="Что-то пошло не так"
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Повторить
          </button>
          <Link href="/overview" className="btn btn-secondary">
            В дашборд
          </Link>
        </>
      }
    >
      <p>Страницу не удалось показать. Это ошибка на нашей стороне, ваши данные не затронуты.</p>
      {error.digest ? (
        <p className="muted">
          Код для администратора: <code>{error.digest}</code>
        </p>
      ) : null}
    </NoticePage>
  );
}
