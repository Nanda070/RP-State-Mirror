import Link from "next/link";
import { NoticePage } from "@/components/notice-page";

export const metadata = { title: "Страница не найдена · Mirror" };

export default function NotFound() {
  return (
    <NoticePage
      code="404"
      title="Страница не найдена"
      actions={
        <>
          <Link href="/overview" className="btn btn-primary">
            В дашборд
          </Link>
          <Link href="/" className="btn btn-secondary">
            На страницу входа
          </Link>
        </>
      }
    >
      <p>Такой страницы нет: ссылка устарела, была отозвана или в адресе опечатка.</p>
      <p>Публичные ссылки на записи и формы перестают работать, когда администратор их закрывает.</p>
    </NoticePage>
  );
}
