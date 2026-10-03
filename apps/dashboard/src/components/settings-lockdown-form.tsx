"use client";

import { confirmDialog } from "@/lib/confirm";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SettingsLockdownForm({
  initialEnabled,
  initialReason,
  changedBy,
  changedAt,
}: {
  initialEnabled: boolean;
  initialReason: string;
  /** Who flipped the switch last, already formatted; null when it was never used. */
  changedBy: string | null;
  changedAt: string | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [reason, setReason] = useState(initialReason);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply(next: boolean) {
    if (
      next &&
      !(await confirmDialog("Закрыть бота и сайт для всех, кроме главных администраторов?", { confirmLabel: "Включить блокировку" }))
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/lockdown", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, reason: next ? reason.trim() : null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setEnabled(next);
      setMessage({ ok: true, text: next ? "Блокировка включена." : "Блокировка снята." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel lockdown-panel" data-active={enabled ? "" : undefined}>
      <h2 className="panel-title" style={{ marginTop: 0 }}>
        Аварийная блокировка
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Закрывает команды и кнопки бота, дашборд и публичные формы для всех, кроме главных администраторов.
        Фоновая работа (синхронизация ЧП, очередь задач, истечение сроков) продолжается. Переключатель
        срабатывает в течение нескольких секунд.
      </p>
      <p className="lockdown-state">
        <span className="registry-status" data-status={enabled ? "bad" : "ok"}>
          {enabled ? "Блокировка включена" : "Сервис работает в обычном режиме"}
        </span>
        {changedBy && changedAt ? (
          <span className="muted">
            {" "}
            · изменено: {changedBy}, {changedAt} МСК
          </span>
        ) : null}
      </p>
      {!enabled ? (
        <div className="field">
          <label htmlFor="lockdownReason">Причина (её увидят пользователи)</label>
          <input
            id="lockdownReason"
            maxLength={300}
            placeholder="Например: обновление базы, вернёмся через час"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : initialReason ? (
        <p>Причина: {initialReason}</p>
      ) : null}
      <button
        type="button"
        className={enabled ? "btn btn-primary" : "btn btn-danger"}
        disabled={pending}
        onClick={() => void apply(!enabled)}
      >
        {pending ? "Отправка…" : enabled ? "Снять блокировку" : "Включить блокировку"}
      </button>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
