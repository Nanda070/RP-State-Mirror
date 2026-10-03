"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoscow } from "@/lib/moscow";

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
        ? "Запрос отмечен: форма собрана."
        : status === "REJECTED"
          ? "Запрос отклонён."
          : "Запрос закрыт.",
    );
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="panel-title">Очередь запросов webhook</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Запросы из <code>/создать-webhook</code>. URL создаёт бот — подставьте его при сборке
          Discord-формы и отметьте статус.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <Link href="/settings/forms" className="btn btn-secondary">
            Открыть Discord-формы
          </Link>
          <Link href="/settings/stage4" className="btn btn-secondary">
            Канал уведомлений
          </Link>
        </div>
      </section>

      {items.length === 0 ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Запросов пока нет.
          </p>
        </section>
      ) : (
        items.map((req) => (
          <section key={req.id} className="panel stack">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <strong>{STATUS_RU[req.status] ?? req.status}</strong>
                <span className="muted"> · {formatMoscow(new Date(req.createdAt))}</span>
              </div>
              <code style={{ fontSize: "0.8rem" }}>{req.id}</code>
            </div>
            <p style={{ margin: 0 }}>{req.description}</p>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Сервер / канал из запроса Discord · заявитель Discord
            </p>
            {req.webhookUrl ? (
              <code style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{req.webhookUrl}</code>
            ) : (
              <span className="muted">URL ещё не сохранён</span>
            )}
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              {req.webhookUrl ? (
                <Link
                  href={`/settings/forms?webhookUrl=${encodeURIComponent(req.webhookUrl)}`}
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
