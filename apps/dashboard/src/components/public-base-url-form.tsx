"use client";

import { useState } from "react";

export function PublicBaseUrlForm({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "app.publicBaseUrl": value.trim().replace(/\/+$/, "") || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setValue((current) => current.trim().replace(/\/+$/, ""));
      setMessage({ ok: true, text: "Сохранено." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <h2 className="panel-title">Публичный адрес сайта</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        По этому адресу бот строит ссылки на веб-формы (когда форму нельзя открыть окном в Discord). Только
        адрес без пути.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 18rem", marginBottom: 0 }}>
          <label htmlFor="publicBaseUrl">Адрес</label>
          <input
            id="publicBaseUrl"
            type="url"
            placeholder="https://mirror.example"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} style={{ marginTop: "0.75rem" }}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
