"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoscowShort } from "@/lib/moscow";
import { CopyButton } from "./copy-button";
import { EmptyState } from "./ui";

type WebhookRequest = {
  id: string;
  requesterDiscordId: string;
  guildDiscordId: string;
  channelDiscordId: string;
  description: string;
  webhookUrl?: string | null;
  status: string;
  createdAt: string | Date;
};

/** A webhook address holds a secret token: show where it leads, not the token. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const id = parsed.pathname.split("/").filter(Boolean)[2] ?? "";
    return `${parsed.host}/…/${id.slice(0, 6)}…`;
  } catch {
    return "адрес вебхука";
  }
}

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  FORM_BUILT: "Форма собрана",
  REJECTED: "Отклонён",
  CLOSED: "Закрыт",
};

export function WebhooksQueue({ initial }: { initial: WebhookRequest[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function setStatus(id: string, status: "FORM_BUILT" | "REJECTED" | "CLOSED") {
    setMessage(null);
    const response = await fetch("/api/settings/stage4", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "webhook-status", id, status }),
    });
    if (!response.ok) {
      setMessage(((await response.json()) as { error?: string }).error ?? "Ошибка статуса");
      return;
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    setMessage(
      status === "FORM_BUILT"
        ? "Запрос отмечен: форма собрана. Заявителю отправлено уведомление в ЛС."
        : status === "REJECTED"
          ? "Запрос отклонён. Заявителю отправлено уведомление в ЛС."
          : "Запрос закрыт.",
    );
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="panel-title">Очередь запросов webhook</h2>
        <p className="muted u-mt0">
          Запросы из <code>/создать-вебхук</code>. URL создаёт бот — подставьте его при сборке
          Discord-формы, опубликуйте кнопку формы (чтобы в ЛС была ссылка), затем отметьте «Форма
          собрана» — заявитель получит уведомление в личные сообщения.
        </p>
        <div className="row u-wrap u-gap2">
          <Link href="/settings/forms" className="btn btn-secondary">
            Открыть Discord-формы
          </Link>
          <Link href="/settings/modules?tab=webhooks" className="btn btn-secondary">
            Канал уведомлений
          </Link>
        </div>
      </section>

      {items.length === 0 ? (
        <section className="panel">
          <EmptyState icon="inbox" title="Запросов пока нет" />
        </section>
      ) : (
        items.map((req) => (
          <section key={req.id} className="panel stack">
            <div className="row u-between u-wrap u-gap2">
              <div>
                <strong>Запрос формы</strong>
                <span className="muted"> · {formatMoscowShort(new Date(req.createdAt))}</span>
              </div>
              <span className="registry-status" data-status={req.status === "PENDING" ? "warn" : req.status === "APPROVED" ? "ok" : "muted"}>
                {STATUS_RU[req.status] ?? req.status}
              </span>
            </div>
            <p className="u-m0">{req.description}</p>
            {req.webhookUrl ? (
              <div className="row u-gap2 u-wrap">
                <code className="url-short">{shortUrl(req.webhookUrl)}</code>
                <CopyButton value={req.webhookUrl} />
              </div>
            ) : (
              <span className="muted">Адрес вебхука ещё не сохранён</span>
            )}
            <div className="row u-wrap u-gap2">
              {req.webhookUrl ? (
                <Link
                  href={`/settings/forms/new?request=${encodeURIComponent(req.id)}`}
                  className="btn btn-secondary"
                >
                  Собрать форму с этим URL
                </Link>
              ) : null}
              {req.status === "PENDING" ? (
                <>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void setStatus(req.id, "FORM_BUILT").catch((e) => setMessage(e.message))}
                  >
                    Форма собрана
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => void setStatus(req.id, "REJECTED").catch((e) => setMessage(e.message))}
                  >
                    Отклонить
                  </button>
                </>
              ) : null}
              {req.status === "FORM_BUILT" ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void setStatus(req.id, "CLOSED").catch((e) => setMessage(e.message))}
                >
                  Закрыть
                </button>
              ) : null}
              <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>
                Обновить
              </button>
            </div>
          </section>
        ))
      )}
      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
