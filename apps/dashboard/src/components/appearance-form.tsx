"use client";

import { useState } from "react";
import { THEMES, accentContrast, applyAppearance, type AppearanceValue, type ThemeKey } from "@/lib/appearance";

/** Profile → «Оформление»: a preset and an own accent colour, applied at once and saved for every device. */
export function AppearanceForm({ initial }: { initial: AppearanceValue }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const presetAccent = THEMES.find((theme) => theme.key === value.theme)?.swatch[2] ?? "#ff6a1a";

  function preview(next: AppearanceValue) {
    setValue(next);
    setMessage(null);
    applyAppearance(next);
  }

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setSaved(value);
      setMessage({ ok: true, text: "Сохранено. Оформление будет таким же на других устройствах." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Не удалось сохранить" });
    } finally {
      setPending(false);
    }
  }

  const changed = value.theme !== saved.theme || value.accentColor !== saved.accentColor;

  return (
    <div className="stack">
      <div className="theme-grid" role="radiogroup" aria-label="Тема">
        {THEMES.map((theme) => (
          <button
            key={theme.key}
            type="button"
            role="radio"
            aria-checked={value.theme === theme.key}
            className="theme-card"
            data-active={value.theme === theme.key ? "" : undefined}
            onClick={() => preview({ ...value, theme: theme.key as ThemeKey })}
          >
            <span className="theme-swatch" aria-hidden>
              {theme.swatch.map((color) => (
                <span key={color} style={{ background: color }} />
              ))}
            </span>
            <strong>{theme.label}</strong>
            <span className="muted">{theme.hint}</span>
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="accentColor">Свой цвет акцента</label>
        <div className="row u-gap2 u-wrap">
          <input
            id="accentColor"
            type="color"
            className="accent-input"
            value={value.accentColor ?? presetAccent}
            onChange={(event) => preview({ ...value, accentColor: event.target.value.toLowerCase() })}
          />
          <span
            className="accent-sample"
            style={{
              background: value.accentColor ?? presetAccent,
              color: accentContrast(value.accentColor ?? presetAccent),
            }}
          >
            Кнопка
          </span>
          {value.accentColor ? (
            <button type="button" className="btn btn-ghost" onClick={() => preview({ ...value, accentColor: null })}>
              Цвет темы
            </button>
          ) : null}
        </div>
        <span className="field-hint">Кнопки, ссылки, отметки и подсветка меню. Цвет текста на кнопках подбирается сам.</span>
      </div>

      <div className="row u-gap2">
        <button type="button" className="btn btn-primary" disabled={pending || !changed} onClick={() => void save()}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
        {changed ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => preview(saved)}>
            Отменить
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
