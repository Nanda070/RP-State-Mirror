import Link from "next/link";
import { NoticePage } from "@/components/notice-page";

export const metadata = { title: "Нет доступа" };

const REASONS: Record<string, { title: string; text: string[] }> = {
  bootstrap: {
    title: "Дашборд ещё не настроен",
    text: [
      "Главный сервер пока не выбран, поэтому войти может только главный администратор — он выполняет первичную настройку.",
      "Если вы игрок или сотрудник фракции, попробуйте позже: доступ откроется после настройки.",
    ],
  },
  banned: {
    title: "Доступ закрыт",
    text: [
      "Для вашего аккаунта действует технический бан: пользоваться ботом и сайтом нельзя.",
      "Чтобы обжаловать бан, обратитесь к администрации сервера в Discord.",
    ],
  },
};

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const params = await searchParams;
  const reason = REASONS[params.reason ?? ""] ?? {
    title: "Нет доступа",
    text: [
      "Вход не выполнен или у вашего аккаунта нет прав на этот раздел.",
      "Доступ к разделам администрации дают роли на главном сервере Discord. Если роль выдали недавно — войдите заново.",
    ],
  };

  return (
    <NoticePage
      code="403"
      title={reason.title}
      actions={
        <>
          <Link href="/" className="btn btn-primary">
            На страницу входа
          </Link>
          <Link href="/faq" className="btn btn-secondary">
            FAQ
          </Link>
        </>
      }
    >
      {reason.text.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </NoticePage>
  );
}
