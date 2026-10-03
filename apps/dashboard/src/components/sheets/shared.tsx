"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

/** JSON request to the tables API; the server's message for the person becomes the error. */
export async function tablesApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init?.body ? { ...init, headers: { "Content-Type": "application/json" } } : init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Не удалось выполнить действие. Попробуйте позже.");
  return data;
}

/** A native dialog opened as a modal: focus trap, Escape and backdrop come with it. */
export function Modal({ heading, onClose, children }: { heading: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="confirm-dialog tables-dialog" onClose={onClose}>
      <h2>{heading}</h2>
      {children}
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
          Закрыть
        </button>
      </div>
    </dialog>
  );
}

/** Name of a table and — when renaming — its address. */
export function NameDialog({
  heading,
  initialTitle,
  initialSlug,
  submitLabel,
  onSubmit,
  onClose,
}: {
  heading: string;
  initialTitle: string;
  /** null — the address is made from the title (a new table). */
  initialSlug: string | null;
  submitLabel: string;
  onSubmit: (title: string, slug: string | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(title, initialSlug === null ? undefined : slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить.");
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog ref={ref} className="confirm-dialog tables-dialog" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <h2>{heading}</h2>
        <div className="field">
          <label htmlFor="tableTitle">Название</label>
          <input id="tableTitle" autoFocus required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        {initialSlug !== null ? (
          <div className="field">
            <label htmlFor="tableSlug">Адрес страницы</label>
            <input
              id="tableSlug"
              required
              maxLength={48}
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
          </div>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => ref.current?.close()}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending || !title.trim()}>
            {pending ? "Сохранение…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
