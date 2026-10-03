"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export type RegistryActionButton = {
  action: string;
  label: string;
  /** `danger` — destructive, shown red. */
  tone?: "default" | "danger";
  /** What the dialog asks. Without `input` it is a plain confirmation. */
  confirm: string;
  /** Text field in the dialog: a reason, an evidence link, a new static. */
  input?: { label: string; placeholder?: string; multiline?: boolean };
};

/**
 * Buttons that act on one registry record. Every action is confirmed in the site's own dialog
 * (no browser `confirm`), the result is shown in place and the table refreshes.
 */
export function RegistryActions({
  entity,
  id,
  actions,
}: {
  entity: string;
  id: string;
  actions: RegistryActionButton[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<RegistryActionButton | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function open(action: RegistryActionButton) {
    setCurrent(action);
    setText("");
    setError(null);
    dialog.current?.showModal();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id, action: current.action, ...(text.trim() ? { text: text.trim() } : {}) }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setDone(data.message ?? "Готово.");
      dialog.current?.close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  if (actions.length === 0) return done ? <span className="registry-done">{done}</span> : null;

  return (
    <div className="registry-actions">
      {actions.map((action) => (
        <button
          key={action.action}
          type="button"
          className={action.tone === "danger" ? "btn btn-ghost registry-action-danger" : "btn btn-ghost"}
          onClick={() => open(action)}
        >
          {action.label}
        </button>
      ))}
      {done ? <span className="registry-done">{done}</span> : null}
      <dialog ref={dialog} className="confirm-dialog" onClose={() => setCurrent(null)}>
        {current ? (
          <form onSubmit={(event) => void submit(event)}>
            <h2>{current.label}</h2>
            <p>{current.confirm}</p>
            {current.input ? (
              <div className="field">
                <label htmlFor={`registry-${id}-text`}>{current.input.label}</label>
                {current.input.multiline ? (
                  <textarea
                    id={`registry-${id}-text`}
                    required
                    rows={3}
                    maxLength={2000}
                    placeholder={current.input.placeholder}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                ) : (
                  <input
                    id={`registry-${id}-text`}
                    required
                    maxLength={2000}
                    placeholder={current.input.placeholder}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                )}
              </div>
            ) : null}
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="confirm-dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>
                Отмена
              </button>
              <button
                type="submit"
                className={current.tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
                disabled={pending}
              >
                {pending ? "Выполняется…" : current.label}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
