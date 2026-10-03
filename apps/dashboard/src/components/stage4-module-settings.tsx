"use client";

import { useState } from "react";

export function Stage4ModuleSettings({
  initial,
  fields,
}: {
  initial: Record<string, string>;
  fields: Array<{ key: string; label: string; type?: "number" | "text" }>;
}) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const settings: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.key] ?? "";
      if (field.key.endsWith("RoleIds")) {
        settings[field.key] = JSON.parse(value || "[]");
      } else {
        settings[field.key] = field.type === "number" ? Number(value) : value || null;
      }
    }
    const response = await fetch("/api/settings/stage4", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    const body = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Сохранено и записано в аудит." : body.error ?? "Ошибка сохранения");
  }

  return (
    <form className="panel stack" onSubmit={(event) => void save(event)}>
      {fields.map((field) => (
        <label className="field" key={field.key}>
          <span>{field.label}</span>
          <input
            type={field.type ?? "text"}
            value={values[field.key] ?? ""}
            onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
          />
        </label>
      ))}
      <button className="btn btn-primary" type="submit">Сохранить</button>
      {message ? <p className="muted" role="status">{message}</p> : null}
    </form>
  );
}
