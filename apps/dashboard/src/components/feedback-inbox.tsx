"use client";

import { useState } from "react";

type FeedbackTicket = {
  id: string;
  category: string;
  status: string;
  authorDiscordId: string;
  messages: Array<{ authorDiscordId: string; content: string }>;
};

const STATUS_RU: Record<string, string> = {
  OPEN: "Открыт",
  IN_PROGRESS: "В работе",
  RESOLVED: "Решён",
  CLOSED: "Закрыт",
};

export function FeedbackInbox({
  initial,
  canReply,
}: {
  initial: FeedbackTicket[];
  canReply: boolean;
}) {
  const [tickets, setTickets] = useState(initial);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: "close-feedback" | "reply-feedback", id: string) {
    setMessage(null);
    const response = await fetch("/api/settings/stage4", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "reply-feedback"
          ? { action, id, content: reply[id] ?? "" }
          : { action, id },
      ),
    });
    if (!response.ok) {
      setMessage(((await response.json()) as { error?: string }).error ?? "Ошибка обработки");
      return;
    }
    if (action === "close-feedback") {
      setTickets((prev) =>
        prev.map((ticket) => (ticket.id === id ? { ...ticket, status: "CLOSED" } : ticket)),
      );
      setMessage("Тикет закрыт.");
    } else {
      const content = reply[id] ?? "";
      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === id
            ? {
                ...ticket,
                messages: [...ticket.messages, { authorDiscordId: "админ", content }],
              }
            : ticket,
        ),
      );
      setReply((prev) => ({ ...prev, [id]: "" }));
      setMessage("Ответ отправлен в ЛС игроку.");
    }
  }

  if (tickets.length === 0) {
    return (
      <div className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Тикетов обратной связи пока нет.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      {tickets.map((ticket) => (
        <section key={ticket.id} className="panel stack">
          <div>
            <strong>{ticket.category}</strong>
            <span className="muted">
              {" "}
              · {STATUS_RU[ticket.status] ?? ticket.status} · автор{" "}
              <code>{ticket.authorDiscordId}</code>
            </span>
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {ticket.messages.map((item, idx) => (
              <li key={idx}>
                <strong>{item.authorDiscordId}:</strong> {item.content}
              </li>
            ))}
          </ul>
          {canReply && ticket.status !== "CLOSED" ? (
            <div className="stack" style={{ gap: "0.5rem" }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Ответ администратора</span>
                <textarea
                  value={reply[ticket.id] ?? ""}
                  onChange={(e) => setReply((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                  placeholder="Будет отправлен игроку в ЛС Discord…"
                  rows={3}
                />
              </label>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!(reply[ticket.id] ?? "").trim()}
                  onClick={() => void act("reply-feedback", ticket.id).catch((e) => setMessage(e.message))}
                >
                  Ответить в ЛС
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void act("close-feedback", ticket.id).catch((e) => setMessage(e.message))}
                >
                  Закрыть тикет
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ))}
      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
