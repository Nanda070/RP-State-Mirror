"use client";

import { useState } from "react";

export interface GuildOption {
  discordId: string;
  name: string;
  iconUrl: string | null;
  lastSyncedAt: string | null;
}

export function SettingsGuildForm({
  guilds,
  initialMain,
  initialIncident,
}: {
  guilds: GuildOption[];
  initialMain: string | null;
  initialIncident: string | null;
}) {
  const [mainGuildId, setMain] = useState(initialMain ?? "");
  const [incidentGuildId, setIncident] = useState(initialIncident ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/guilds", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainGuildId: mainGuildId || null,
          incidentGuildId: incidentGuildId || null,
        }),
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
      <h2 style={{ marginTop: 0 }}>Главный сервер и сервер ЧП</h2>
      <p className="muted">
        Главный сервер — источник уровней доступа. Сервер ЧП — синхронизация ролей, розыск и
        регистрации. Они должны быть разными.
      </p>
      {guilds.length === 0 ? (
        <p className="muted">Пока нет синхронизированных серверов. Запустите бота, чтобы снять снимок.</p>
      ) : null}
      <div className="field">
        <label htmlFor="mainGuild">Главный сервер</label>
        <select
          id="mainGuild"
          value={mainGuildId}
          onChange={(event) => setMain(event.target.value)}
        >
          <option value="">Не выбран</option>
          {guilds.map((guild) => (
            <option key={guild.discordId} value={guild.discordId}>
              {guild.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="incidentGuild">Сервер ЧП</label>
        <select
          id="incidentGuild"
          value={incidentGuildId}
          onChange={(event) => setIncident(event.target.value)}
        >
          <option value="">Не выбран</option>
          {guilds.map((guild) => (
            <option key={guild.discordId} value={guild.discordId}>
              {guild.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Сохранение…" : "Сохранить"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
