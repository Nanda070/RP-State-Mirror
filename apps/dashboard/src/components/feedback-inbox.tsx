"use client";

import { Fragment, useState } from "react";
import { LinkActions } from "./copy-button";
import { EmptyState } from "./ui";

type FeedbackTicket = {
  id: string;
  category: string;
  status: string;
  /** «Ник (Discord ID)», resolved on the server. */
  authorLabel: string;
  /** Moscow time, formatted on the server. */
  createdAt: string;
  messages: Array<{ authorLabel: string; content: string; at?: string }>;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "Открыт", tone: "warn" },
  IN_PROGRESS: { label: "В работе", tone: "info" },
  RESOLVED: { label: "Решён", tone: "ok" },
  CLOSED: { label: "Закрыт", tone: "muted" },
};

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

/** Text of a message; a long address inside it becomes «Открыть» / «Копировать». */
function MessageText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <p>
      {parts.map((part, index) =>
        index % 2 === 1 ? <LinkActions key={index} href={part} /> : <Fragment key={index}>{part}</Fragment>,
      )}
    </p>
  );
}

function initialOf(label: string): string {
  return (label.trim().charAt(0) || "?").toUpperCase();
}

export function FeedbackInbox({
  initial,
  canReply,
  replyAuthorLabel,
}: {
  initial: FeedbackTicket[];
  canReply: boolean;
  /** Label of the signed-in admin, shown on a reply before the page reloads. */
  replyAuthorLabel: string;
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
                messages: [...ticket.messages, { authorLabel: replyAuthorLabel, content }],
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
        <EmptyState icon="inbox" title="Обращений пока нет" />
      </div>
    );
  }

  return (
    <div className="stack">
      {message ? (
        <p className="form-ok" role="status">
          {message}
        </p>
      ) : null}
      {tickets.map((ticket) => {
        const status = STATUS[ticket.status] ?? { label: ticket.status, tone: "muted" };
        return (
          <section key={ticket.id} className="panel ticket">
            <header className="ticket-head">
              <span className="ticket-avatar" aria-hidden>
                {initialOf(ticket.authorLabel)}
              </span>
              <div className="ticket-who">
                <strong>{ticket.authorLabel}</strong>
                <span className="muted">
                  {ticket.category} · {ticket.createdAt}
                </span>
              </div>
              <span className="registry-status" data-status={status.tone}>
                {status.label}
              </span>
            </header>
            <div className="ticket-thread">
              {ticket.messages.map((item, idx) => (
                <div key={idx} className="bubble" data-staff={item.authorLabel !== ticket.authorLabel ? "" : undefined}>
                  <span className="bubble-author">
                    {item.authorLabel}
                    {item.at ? ` · ${item.at}` : ""}
                  </span>
                  <MessageText text={item.content} />
                </div>
              ))}
            </div>
            {canReply && ticket.status !== "CLOSED" ? (
              <div className="ticket-reply">
                <textarea
                  aria-label="Ответ администратора"
                  value={reply[ticket.id] ?? ""}
                  onChange={(e) => setReply((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                  placeholder="Ответ уйдёт игроку в ЛС Discord"
                  rows={2}
                />
                <div className="row u-wrap u-gap2">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!(reply[ticket.id] ?? "").trim()}
                    onClick={() => void act("reply-feedback", ticket.id).catch((e) => setMessage(e.message))}
                  >
                    Ответить
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void act("close-feedback", ticket.id).catch((e) => setMessage(e.message))}
                  >
                    Закрыть тикет
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
