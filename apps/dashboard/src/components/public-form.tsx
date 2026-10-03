"use client";

import { useState } from "react";

export type PublicFormField = {
  key: string;
  label: string;
  type: "short" | "paragraph" | "number" | "select" | "multiselect" | "checkbox" | "date";
  required: boolean;
  helpText: string | null;
  options: string[];
  minLength: number | null;
  maxLength: number | null;
  min: number | null;
  max: number | null;
};

type Value = string | boolean | string[];

function initialValue(field: PublicFormField): Value {
  if (field.type === "checkbox") return false;
  if (field.type === "multiselect") return [];
  return "";
}

/** The server names the field in its message: «Подпись»: что не так. */
function splitFieldError(message: string, fields: PublicFormField[]): { key: string; text: string } | null {
  const match = /^«(.+?)»:\s*(.+)$/s.exec(message);
  if (!match) return null;
  const field = fields.find((entry) => entry.label === match[1]);
  return field && match[2] ? { key: field.key, text: match[2] } : null;
}

function isEmpty(field: PublicFormField, value: Value | undefined): boolean {
  if (field.type === "checkbox") return value !== true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== "string" || value.trim() === "";
}

export function PublicForm({
  slug,
  fields,
  successMessage,
}: {
  slug: string;
  fields: PublicFormField[];
  successMessage: string | null;
}) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, initialValue(field)])),
  );
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const set = (key: string, value: Value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const missing: Record<string, string> = {};
    for (const field of fields) {
      if (field.required && isEmpty(field, values[field.key])) {
        missing[field.key] = field.type === "checkbox" ? "Нужно отметить" : "Заполните поле";
      }
    }
    setFieldErrors(missing);
    const firstMissing = fields.find((field) => field.key in missing);
    if (firstMissing) {
      document.getElementById(`f-${firstMissing.key}`)?.focus();
      return;
    }

    setPending(true);
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, website }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string | null };
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить ответ. Попробуйте позже.");
      setDone(data.message?.trim() || successMessage?.trim() || "Спасибо! Ваш ответ принят.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось отправить ответ. Попробуйте позже.";
      const named = splitFieldError(message, fields);
      if (named) {
        setFieldErrors({ [named.key]: named.text });
        document.getElementById(`f-${named.key}`)?.focus();
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="form-state" role="status">
        <span className="form-state-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
            <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Ответ отправлен</h2>
        <p>{done}</p>
      </div>
    );
  }

  return (
    <form className="public-form" onSubmit={(event) => void submit(event)} noValidate>
      {fields.map((field) => {
        const id = `f-${field.key}`;
        const hintId = field.helpText ? `${id}-hint` : undefined;
        const problem = fieldErrors[field.key];
        const errorId = problem ? `${id}-error` : undefined;
        const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
        const value = values[field.key];
        const label = (
          <>
            {field.label}
            {field.required ? (
              <span className="public-form-required" aria-hidden>
                {" "}
                *
              </span>
            ) : null}
          </>
        );
        const notes = (
          <>
            {field.helpText ? (
              <span className="field-hint" id={hintId}>
                {field.helpText}
              </span>
            ) : null}
            {problem ? (
              <span className="field-error" id={errorId} role="alert">
                {problem}
              </span>
            ) : null}
          </>
        );

        if (field.type === "checkbox") {
          return (
            <div className="field" key={field.key} data-invalid={problem ? "" : undefined}>
              <label className="toggle-row" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  aria-describedby={describedBy}
                  aria-invalid={problem ? true : undefined}
                  checked={value === true}
                  onChange={(event) => set(field.key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
              {notes}
            </div>
          );
        }

        if (field.type === "multiselect") {
          const picked = Array.isArray(value) ? value : [];
          return (
            <fieldset className="field public-form-group" key={field.key} aria-describedby={describedBy} data-invalid={problem ? "" : undefined}>
              <legend>{label}</legend>
              <div className="chip-row">
                {field.options.map((option, index) => (
                  <label key={option} className="chip-toggle">
                    <input
                      id={index === 0 ? id : undefined}
                      type="checkbox"
                      checked={picked.includes(option)}
                      onChange={(event) =>
                        set(
                          field.key,
                          event.target.checked ? [...picked, option] : picked.filter((item) => item !== option),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
              {notes}
            </fieldset>
          );
        }

        const text = typeof value === "string" ? value : "";
        return (
          <div className="field" key={field.key} data-invalid={problem ? "" : undefined}>
            <label htmlFor={id}>{label}</label>
            {field.type === "paragraph" ? (
              <textarea
                id={id}
                rows={5}
                aria-describedby={describedBy}
                aria-invalid={problem ? true : undefined}
                minLength={field.minLength ?? undefined}
                maxLength={field.maxLength ?? 4000}
                value={text}
                onChange={(event) => set(field.key, event.target.value)}
              />
            ) : field.type === "select" ? (
              <select
                id={id}
                aria-describedby={describedBy}
                aria-invalid={problem ? true : undefined}
                value={text}
                onChange={(event) => set(field.key, event.target.value)}
              >
                <option value="">Выберите…</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                step={field.type === "number" ? "any" : undefined}
                aria-describedby={describedBy}
                aria-invalid={problem ? true : undefined}
                min={field.type === "number" ? (field.min ?? undefined) : undefined}
                max={field.type === "number" ? (field.max ?? undefined) : undefined}
                minLength={field.type === "short" ? (field.minLength ?? undefined) : undefined}
                maxLength={field.type === "short" ? (field.maxLength ?? 300) : undefined}
                value={text}
                onChange={(event) => set(field.key, event.target.value)}
              />
            )}
            {notes}
          </div>
        );
      })}

      {/* Honeypot: invisible to people and skipped by keyboard; bots that fill every input reveal themselves. */}
      <div className="public-form-trap" aria-hidden>
        <label htmlFor="f-website">Сайт</label>
        <input
          id="f-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Отправка…" : "Отправить"}
      </button>
    </form>
  );
}
