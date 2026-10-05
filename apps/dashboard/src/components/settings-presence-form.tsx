"use client";

import { useState } from "react";
import { ToggleRow } from "./toggle-row";

/** «В сети» in profiles: the bot reconnects with the presence intent when this is on. */
export function SettingsPresenceForm({
  initialEnabled,
  botState,
}: {
  initialEnabled: boolean;
  /** What the running bot does now: connected with the intent, without it, or not heard from. */
  botState: "on" | "off" | "unknown";
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: boolean) {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "presence.enabled": next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setEnabled(next);
      setMessage({
        ok: true,
        text: next
          ? "Включено. Бот переподключится в течение минуты."
          : "Выключено. Бот переподключится в течение минуты.",
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title u-mt0">Статус «в сети»</h2>
      <ToggleRow
        id="presenceEnabled"
        checked={enabled}
        disabled={pending}
        onChange={(next) => void save(next)}
        label="Показывать в профиле, в сети ли человек в Discord"
      />
      <p className="field-hint">
        Сначала включите <strong>Presence Intent</strong> у бота в Discord Developer Portal (Bot → Privileged Gateway
        Intents), затем этот переключатель. Если Discord откажет в доступе, бот сам выключит функцию и запустится без
        неё — запись об этом появится в журнале аудита.
      </p>
      <p className="muted">
        Сейчас бот:{" "}
        {botState === "on"
          ? "получает статусы участников"
          : botState === "off"
            ? "работает без статусов"
            : "не отвечает — состояние неизвестно"}
        .
      </p>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
