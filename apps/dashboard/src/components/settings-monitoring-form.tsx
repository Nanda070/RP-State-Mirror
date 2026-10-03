"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";

export function SettingsMonitoringForm({
  initialErrorChannelId,
  initialAlertWebhookUrl,
  initialArchiveAfterDays,
  channels,
}: {
  initialErrorChannelId: string | null;
  initialAlertWebhookUrl: string | null;
  initialArchiveAfterDays: number;
  channels: ChannelOption[];
}) {
  const [errorChannelId, setErrorChannelId] = useState(initialErrorChannelId ?? "");
  const [alertWebhookUrl, setAlertWebhookUrl] = useState(initialAlertWebhookUrl ?? "");
  const [archiveAfterDays, setArchiveAfterDays] = useState(String(initialArchiveAfterDays));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "monitoring.errorChannelId": errorChannelId.trim() || null,
          "monitoring.alertWebhookUrl": alertWebhookUrl.trim() || null,
          "audit.archiveAfterDays": Math.max(30, Math.round(Number(archiveAfterDays) || 365)),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setMessage({ ok: true, text: "Сохранено" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void onSubmit(event)}>
      <h2 className="panel-title u-mt0">
        Мониторинг и журнал
      </h2>
      <div className="field">
        <label htmlFor="monErrorChannel">Канал ошибок бота</label>
        <ChannelSelect id="monErrorChannel" value={errorChannelId} onChange={setErrorChannelId} channels={channels} />
        <span className="field-hint">
          Сюда бот пишет свои сбои: необработанные ошибки и задачи, которые не удалось выполнить после всех
          попыток.
        </span>
      </div>
      <div className="field">
        <label htmlFor="monWebhook">Вебхук оповещения «бот не отвечает»</label>
        <input
          id="monWebhook"
          type="url"
          autoComplete="off"
          placeholder="https://discord.com/api/webhooks/…"
          value={alertWebhookUrl}
          onChange={(event) => setAlertWebhookUrl(event.target.value)}
        />
        <span className="field-hint">
          Оповещение отправляет сайт, а не бот: если бот молчит дольше полутора минут, сюда придёт одно
          сообщение на каждое отключение.
        </span>
      </div>
      <div className="field">
        <label htmlFor="auditArchive">Переносить журнал аудита в архив через, дней</label>
        <input
          id="auditArchive"
          type="number"
          min={30}
          step={1}
          value={archiveAfterDays}
          onChange={(event) => setArchiveAfterDays(event.target.value)}
        />
        <span className="field-hint">Записи не удаляются: старые переезжают в архивную таблицу.</span>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Сохранение…" : "Сохранить"}
      </button>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
