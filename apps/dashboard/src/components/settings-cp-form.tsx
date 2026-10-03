"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";

type RoleOption = { discordId: string; name: string };

export function SettingsCpForm({
  initialEnabled,
  initialExcludedRoleIds,
  initialLogChannelId,
  incidentGuildId,
  channels,
  roles,
}: {
  initialEnabled: boolean;
  initialExcludedRoleIds: string[];
  initialLogChannelId: string | null;
  incidentGuildId: string | null;
  channels: ChannelOption[];
  roles: RoleOption[];
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [excluded, setExcluded] = useState<string[]>(initialExcludedRoleIds);
  const [logChannelId, setLogChannelId] = useState(initialLogChannelId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggleRole(roleId: string) {
    setExcluded((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "cp.syncEnabled": enabled,
          "cp.excludedRoleIds": excluded,
          "cp.logChannelId": logChannelId.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setMessage("Сохранено");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void onSubmit(e)}>
      <h2 className="panel-title" style={{ marginTop: 0 }}>
        Синхронизация ЧП
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Роли на сервере ЧП выдаются по фракционным ролям (маппинги FACTION_*). Без фракции —
        автокик. Привязки ролей ЧП: на сервере ЧП создайте FACTION_MEMBER для каждой фракции.
      </p>
      {!incidentGuildId ? (
        <p className="muted">Сначала укажите сервер ЧП в блоке выше.</p>
      ) : null}
      <div className="field">
        <label htmlFor="cpEnabled">
          <input
            id="cpEnabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ marginRight: "0.5rem" }}
          />
          Синхронизация включена (cp.syncEnabled)
        </label>
      </div>
      <div className="field">
        <label htmlFor="cpLog">Канал логов</label>
        <ChannelSelect
          id="cpLog"
          value={logChannelId}
          onChange={setLogChannelId}
          channels={channels}
          guildDiscordId={incidentGuildId}
        />
      </div>
      <div className="field">
        <span className="field-label">Исключённые роли (не кикать / не трогать)</span>
        <div className="chip-row">
          {roles.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Нет ролей сервера ЧП в снимке. Дождитесь синхронизации бота.
            </p>
          ) : (
            roles.map((role) => (
              <label key={role.discordId} className="chip-check">
                <input
                  type="checkbox"
                  checked={excluded.includes(role.discordId)}
                  onChange={() => toggleRole(role.discordId)}
                />
                {role.name}
              </label>
            ))
          )}
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        Сохранить синхронизацию
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
