"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { tablesApi } from "./shared";

export type AllowedUser = { id: string; label: string };

const LEVELS = [
  { value: "PUBLIC", title: "Открытая таблица", text: "Видят все, в том числе без входа." },
  { value: "USERS", title: "Доступ по списку", text: "Видят только вошедшие через Discord, чей ID есть в списке." },
  { value: "ADMINS", title: "Закрытая таблица", text: "Видят только администраторы." },
] as const;

const DISCORD_ID = /^\d{17,20}$/;

/** Who may open the table: everyone, people listed by Discord ID, or admins only. */
export function AccessDialog({
  documentId,
  initialAccess,
  initialAllowed,
  onSaved,
  onClose,
}: {
  documentId: string;
  initialAccess: string;
  initialAllowed: AllowedUser[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [access, setAccess] = useState(initialAccess);
  const [allowed, setAllowed] = useState(initialAllowed);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /** Several ids at once are fine: separated by spaces, commas or new lines. */
  function addDraft() {
    const ids = draft.split(/[\s,;]+/).filter(Boolean);
    if (ids.length === 0) return;
    const wrong = ids.find((id) => !DISCORD_ID.test(id));
    if (wrong) {
      setError(`«${wrong}» — не Discord ID. ID состоит из 17–20 цифр.`);
      return;
    }
    setError(null);
    setAllowed((current) => [...current, ...ids.filter((id) => !current.some((user) => user.id === id)).map((id) => ({ id, label: id }))]);
    setDraft("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await tablesApi(`/api/tables/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "access", access, allowedDiscordIds: allowed.map((user) => user.id) }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить.");
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog ref={ref} className="confirm-dialog tables-dialog" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <h2>Доступ к таблице</h2>
        <div className="access-levels" role="radiogroup" aria-label="Кто видит таблицу">
          {LEVELS.map((level) => (
            <label key={level.value} className="access-level" data-checked={access === level.value ? "" : undefined}>
              <input type="radio" name="access" value={level.value} checked={access === level.value} onChange={() => setAccess(level.value)} />
              <span>
                <strong>{level.title}</strong>
                <span className="muted">{level.text}</span>
              </span>
            </label>
          ))}
        </div>

        {access === "USERS" ? (
          <div className="access-users">
            <div className="field">
              <label htmlFor="accessId">Discord ID</label>
              <div className="row u-gap2">
                <input
                  id="accessId"
                  inputMode="numeric"
                  placeholder="Например, 1219803151180370021"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addDraft();
                  }}
                />
                <button type="button" className="btn btn-secondary" disabled={!draft.trim()} onClick={addDraft}>
                  Добавить
                </button>
              </div>
            </div>
            {allowed.length === 0 ? (
              <p className="muted u-m0">Список пуст: таблицу видят только администраторы.</p>
            ) : (
              <ul className="access-list">
                {allowed.map((user) => (
                  <li key={user.id}>
                    <span>{user.label}</span>
                    <button
                      type="button"
                      className="icon-action"
                      title="Убрать из списка"
                      aria-label={`Убрать из списка: ${user.label}`}
                      onClick={() => setAllowed((current) => current.filter((entry) => entry.id !== user.id))}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
