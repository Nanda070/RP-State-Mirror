"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AttachmentList, AttachmentPicker, type TicketAttachment, uploadTicketFiles } from "./feedback-attachments";
import { EmptyState } from "./ui";

export type OwnTicket = {
  id: string;
  category: string;
  status: string;
  /** Moscow time, formatted on the server. */
  createdAt: string;
  messages: Array<{ mine: boolean; content: string; at: string; files: TicketAttachment[] }>;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "Ждёт ответа", tone: "warn" },
  IN_PROGRESS: { label: "В работе", tone: "info" },
  RESOLVED: { label: "Решено", tone: "ok" },
  CLOSED: { label: "Закрыто", tone: "muted" },
};

async function call(method: "POST" | "PATCH", body: unknown) {
  const res = await fetch("/api/feedback", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Не удалось отправить. Попробуйте позже.");
}

/** A player's own tickets: write a new one, read the answers, answer back. */
export function SupportDesk({ tickets, categories }: { tickets: OwnTicket[]; categories: string[] }) {
  const router = useRouter();
  const [writing, setWriting] = useState(tickets.length === 0);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [replyFiles, setReplyFiles] = useState<Record<string, File[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, done: () => void) {
    setPending(true);
    setError(null);
    try {
      await action();
      done();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {writing ? (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              async () => {
                const uploaded = await uploadTicketFiles(files);
                await call("POST", { category, content, attachmentFileIds: uploaded.map((file) => file.id) });
              },
              () => {
                setContent("");
                setFiles([]);
                setWriting(false);
              },
            );
          }}
        >
          <h2 className="panel-title">Новое обращение</h2>
          <div className="field">
            <label htmlFor="ticketCategory">Категория</label>
            <select id="ticketCategory" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ticketText">Текст</label>
            <textarea
              id="ticketText"
              rows={5}
              maxLength={4000}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={pending} />
          <div className="row u-gap2">
            <button type="submit" className="btn btn-primary" disabled={pending || (!content.trim() && files.length === 0)}>
              {pending ? "Отправка…" : "Отправить"}
            </button>
            {tickets.length > 0 ? (
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setWriting(false)}>
                Отмена
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setWriting(true)}>
            Новое обращение
          </button>
        </div>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {tickets.length === 0 && !writing ? (
        <div className="panel">
          <EmptyState icon="inbox" title="Обращений пока нет" />
        </div>
      ) : null}

      {tickets.map((ticket) => {
        const status = STATUS[ticket.status] ?? { label: ticket.status, tone: "muted" };
        const text = reply[ticket.id] ?? "";
        const chosen = replyFiles[ticket.id] ?? [];
        return (
          <section key={ticket.id} className="panel ticket">
            <header className="ticket-head">
              <div className="ticket-who">
                <strong>{ticket.category}</strong>
                <span className="muted">{ticket.createdAt}</span>
              </div>
              <span className="registry-status" data-status={status.tone}>
                {status.label}
              </span>
            </header>
            <div className="ticket-thread">
              {ticket.messages.map((item, index) => (
                <div key={index} className="bubble" data-staff={item.mine ? "" : undefined}>
                  <span className="bubble-author">
                    {item.mine ? "Вы" : "Администрация"} · {item.at}
                  </span>
                  {item.content ? <p>{item.content}</p> : null}
                  <AttachmentList files={item.files} />
                </div>
              ))}
            </div>
            {ticket.status !== "CLOSED" ? (
              <div className="ticket-reply">
                <textarea
                  aria-label="Дописать в обращение"
                  placeholder="Дописать в обращение"
                  rows={2}
                  maxLength={4000}
                  value={text}
                  onChange={(event) => setReply((prev) => ({ ...prev, [ticket.id]: event.target.value }))}
                />
                <AttachmentPicker
                  files={chosen}
                  onChange={(next) => setReplyFiles((prev) => ({ ...prev, [ticket.id]: next }))}
                  disabled={pending}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending || (!text.trim() && chosen.length === 0)}
                    onClick={() =>
                      void run(
                        async () => {
                          const uploaded = await uploadTicketFiles(chosen);
                          await call("PATCH", {
                            action: "reply-own",
                            id: ticket.id,
                            content: text,
                            attachmentFileIds: uploaded.map((file) => file.id),
                          });
                        },
                        () => {
                          setReply((prev) => ({ ...prev, [ticket.id]: "" }));
                          setReplyFiles((prev) => ({ ...prev, [ticket.id]: [] }));
                        },
                      )
                    }
                  >
                    Отправить
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
