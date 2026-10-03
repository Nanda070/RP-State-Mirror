"use client";

import { useState, type ReactNode } from "react";

type ModuleKey = "documents" | "wanted" | "fines";

export function SettingsDocumentsForm({
  initialTtlHours,
}: {
  initialTtlHours: number;
}) {
  const [ttlHours, setTtlHours] = useState(String(initialTtlHours));
  return (
    <ModuleSettingsForm
      module="documents"
      fields={[{ key: "documents.ttlHours", value: Number(ttlHours) }]}
      onBeforeSubmit={() => {
        const n = Number(ttlHours);
        if (!Number.isFinite(n) || n < 1) throw new Error("TTL должен быть целым числом ≥ 1");
      }}
    >
      <div className="field">
        <label htmlFor="ttlHours">Срок актуальности документа, часы</label>
        <input
          id="ttlHours"
          type="number"
          min={1}
          step={1}
          value={ttlHours}
          onChange={(e) => setTtlHours(e.target.value)}
        />
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
          После истечения запись переводится в статус EXPIRED (по умолчанию 72 ч, как в старом боте).
        </p>
      </div>
    </ModuleSettingsForm>
  );
}

export function SettingsWantedForm({
  initialEnabled,
  initialChannelId,
}: {
  initialEnabled: boolean;
  initialChannelId: string | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [channelId, setChannelId] = useState(initialChannelId ?? "");
  return (
    <ModuleSettingsForm
      module="wanted"
      fields={[
        { key: "wanted.enabled", value: enabled },
        { key: "wanted.channelId", value: channelId.trim() || null },
      ]}
    >
      <div className="field">
        <label htmlFor="wantedEnabled">
          <input
            id="wantedEnabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ marginRight: "0.5rem" }}
          />
          Модуль розыска включён
        </label>
      </div>
      <div className="field">
        <label htmlFor="wantedChannel">Канал на сервере ЧП (Discord ID)</label>
        <input
          id="wantedChannel"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder="например 123456789012345678"
          inputMode="numeric"
        />
      </div>
    </ModuleSettingsForm>
  );
}

export function SettingsFinesForm({
  initialDueDays,
  initialChannelId,
}: {
  initialDueDays: number;
  initialChannelId: string | null;
}) {
  const [dueDays, setDueDays] = useState(String(initialDueDays));
  const [channelId, setChannelId] = useState(initialChannelId ?? "");
  return (
    <ModuleSettingsForm
      module="fines"
      fields={[
        { key: "fines.dueDays", value: Number(dueDays) },
        { key: "fines.channelId", value: channelId.trim() || null },
      ]}
      onBeforeSubmit={() => {
        const n = Number(dueDays);
        if (!Number.isFinite(n) || n < 1) throw new Error("Срок должен быть целым числом ≥ 1");
      }}
    >
      <div className="field">
        <label htmlFor="dueDays">Срок оплаты по умолчанию, дни</label>
        <input
          id="dueDays"
          type="number"
          min={1}
          step={1}
          value={dueDays}
          onChange={(e) => setDueDays(e.target.value)}
        />
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
          Slash-команда <code>/штраф</code> задаёт срок через параметр «срок_оплаты» (1m / 24h / 14d);
          это значение — запасной ориентир для дашборда.
        </p>
      </div>
      <div className="field">
        <label htmlFor="finesChannel">Канал на сервере ЧП (Discord ID)</label>
        <input
          id="finesChannel"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder="например 123456789012345678"
          inputMode="numeric"
        />
      </div>
    </ModuleSettingsForm>
  );
}

function ModuleSettingsForm({
  module: _module,
  fields,
  onBeforeSubmit,
  children,
}: {
  module: ModuleKey;
  fields: Array<{ key: string; value: unknown }>;
  onBeforeSubmit?: () => void;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      onBeforeSubmit?.();
      const body = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      const response = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setMessage("Сохранено. Изменение записано в журнал аудита.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2 className="panel-title" style={{ marginTop: 0 }}>
        Параметры
      </h2>
      {children}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Сохранение…" : "Сохранить"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
