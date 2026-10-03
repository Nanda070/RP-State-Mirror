"use client";

import { Fragment, useState } from "react";
import { LinkActions } from "./copy-button";
import { EmptyState } from "./ui";

type StaffOption = { discordId: string; label: string };

type FeedbackTicket = {
  id: string;
  category: string;
  status: string;
  /** «Ник (Discord ID)», resolved on the server. */
  authorLabel: string;
  /** Moscow time, formatted on the server. */
  createdAt: string;
  assignedToDiscordId: string | null;
  assignedLabel: string | null;
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

async function patchFeedback(body: unknown): Promise<{ status?: string }> {
  const response = await fetch("/api/feedback", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
  if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить действие. Обновите страницу.");
  return data;
}

export function FeedbackInbox({
  initial,
  canReply,
  canAssign,
  staffOptions,
  replyAuthorLabel,
}: {
  initial: FeedbackTicket[];
  canReply: boolean;
  canAssign: boolean;
  staffOptions: StaffOption[];
  /** Label of the signed-in admin, shown on a reply before the page reloads. */
  replyAuthorLabel: string;
}) {
  const [tickets, setTickets] = useState(initial);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>) {
    setPending(id);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие. Обновите страницу.");
    } finally {
      setPending(null);
    }
  }

  async function replyTicket(id: string) {
    await run(id, async () => {
      const content = reply[id] ?? "";
      await patchFeedback({ action: "reply", id, content });
      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === id
            ? { ...ticket, messages: [...ticket.messages, { authorLabel: replyAuthorLabel, content }] }
            : ticket,
        ),
      );
      setReply((prev) => ({ ...prev, [id]: "" }));
      setMessage("Ответ отправлен в ЛС игроку.");
    });
  }

  async function closeTicket(id: string) {
    await run(id, async () => {
      await patchFeedback({ action: "close", id });
      setTickets((prev) => prev.map((ticket) => (ticket.id === id ? { ...ticket, status: "CLOSED" } : ticket)));
      setMessage("Тикет закрыт.");
    });
  }

  async function assignTicket(id: string, assigneeDiscordId: string | null) {
    await run(id, async () => {
      const data = await patchFeedback({ action: "assign", id, assigneeDiscordId });
      const assigned = staffOptions.find((option) => option.discordId === assigneeDiscordId) ?? null;
      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === id
            ? {
                ...ticket,
                assignedToDiscordId: assigneeDiscordId,
                assignedLabel: assigned?.label ?? null,
                status: data.status ?? ticket.status,
              }
            : ticket,
        ),
      );
      setMessage(assigneeDiscordId ? "Ответственный назначен." : "Ответственный снят.");
    });
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
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {tickets.map((ticket) => {
        const status = STATUS[ticket.status] ?? { label: ticket.status, tone: "muted" };
        const busy = pending === ticket.id;
        const assigneeValue = ticket.assignedToDiscordId ?? "";
        const assigneeMissing =
          ticket.assignedToDiscordId &&
          !staffOptions.some((option) => option.discordId === ticket.assignedToDiscordId);
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
                  {ticket.assignedLabel ? ` · ${ticket.assignedLabel}` : ""}
                </span>
              </div>
              <span className="registry-status" data-status={status.tone}>
                {status.label}
              </span>
            </header>
            {canAssign && ticket.status !== "CLOSED" ? (
              <div className="ticket-assign field">
                <label htmlFor={`assignee-${ticket.id}`}>Ответственный</label>
                <select
                  id={`assignee-${ticket.id}`}
                  value={assigneeValue}
                  disabled={busy || staffOptions.length === 0}
                  onChange={(event) => {
                    const next = event.target.value;
                    void assignTicket(ticket.id, next ? next : null);
                  }}
                >
                  <option value="">Не назначен</option>
                  {assigneeMissing && ticket.assignedToDiscordId ? (
                    <option value={ticket.assignedToDiscordId}>
                      {ticket.assignedLabel ?? ticket.assignedToDiscordId} (не в списке)
                    </option>
                  ) : null}
                  {staffOptions.map((option) => (
                    <option key={option.discordId} value={option.discordId}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {staffOptions.length === 0 ? (
                  <p className="muted">Нет администраторов с ролью на основном сервере.</p>
                ) : null}
              </div>
            ) : ticket.assignedLabel ? (
              <p className="muted ticket-assign-readonly">Ответственный: {ticket.assignedLabel}</p>
            ) : null}
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
                  disabled={busy}
                />
                <div className="row u-wrap u-gap2">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busy || !(reply[ticket.id] ?? "").trim()}
                    onClick={() => void replyTicket(ticket.id)}
                  >
                    Ответить
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void closeTicket(ticket.id)}
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
