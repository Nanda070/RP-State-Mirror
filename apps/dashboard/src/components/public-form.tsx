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
  const [done, setDone] = useState<string | null>(null);
  const set = (key: string, value: Value) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Не удалось отправить ответ. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="panel empty-state" role="status">
        <h2 className="panel-title">Ответ отправлен</h2>
        <p className="muted">{done}</p>
      </div>
    );
  }

  return (
    <form className="panel public-form" onSubmit={(event) => void submit(event)} noValidate={false}>
      {fields.map((field) => {
        const id = `f-${field.key}`;
        const hintId = field.helpText ? `${id}-hint` : undefined;
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

        if (field.type === "checkbox") {
          return (
            <div className="field" key={field.key}>
              <label className="toggle-row" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  required={field.required}
                  aria-describedby={hintId}
                  checked={value === true}
                  onChange={(event) => set(field.key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
              {field.helpText ? (
                <span className="field-hint" id={hintId}>
                  {field.helpText}
                </span>
              ) : null}
            </div>
          );
        }

        if (field.type === "multiselect") {
          const picked = Array.isArray(value) ? value : [];
          return (
            <fieldset className="field public-form-group" key={field.key} aria-describedby={hintId}>
              <legend>{label}</legend>
              <div className="chip-row">
                {field.options.map((option) => (
                  <label key={option} className="chip-check">
                    <input
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
              {field.helpText ? (
                <span className="field-hint" id={hintId}>
                  {field.helpText}
                </span>
              ) : null}
            </fieldset>
          );
        }

        const text = typeof value === "string" ? value : "";
        return (
          <div className="field" key={field.key}>
            <label htmlFor={id}>{label}</label>
            {field.type === "paragraph" ? (
              <textarea
                id={id}
                rows={5}
                required={field.required}
                aria-describedby={hintId}
                minLength={field.minLength ?? undefined}
                maxLength={field.maxLength ?? 4000}
                value={text}
                onChange={(event) => set(field.key, event.target.value)}
              />
            ) : field.type === "select" ? (
              <select
                id={id}
                required={field.required}
                aria-describedby={hintId}
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
                required={field.required}
                aria-describedby={hintId}
                min={field.type === "number" ? (field.min ?? undefined) : undefined}
                max={field.type === "number" ? (field.max ?? undefined) : undefined}
                minLength={field.type === "short" ? (field.minLength ?? undefined) : undefined}
                maxLength={field.type === "short" ? (field.maxLength ?? 300) : undefined}
                value={text}
                onChange={(event) => set(field.key, event.target.value)}
              />
            )}
            {field.helpText ? (
              <span className="field-hint" id={hintId}>
                {field.helpText}
              </span>
            ) : null}
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
      <p className="muted public-form-note">
        Поля со звёздочкой обязательны.
      </p>
    </form>
  );
}
