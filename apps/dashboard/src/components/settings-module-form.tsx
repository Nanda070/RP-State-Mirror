"use client";

import { useState, type ReactNode } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { ToggleRow } from "./toggle-row";

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

type RoleOption = { discordId: string; name: string };

function RolePingPicker({
  roles,
  selected,
  onToggle,
  emptyHint,
}: {
  roles: RoleOption[];
  selected: string[];
  onToggle: (roleId: string) => void;
  emptyHint: string;
}) {
  if (roles.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyHint}
      </p>
    );
  }
  return (
    <div className="chip-row">
      {roles.map((role) => (
        <label key={role.discordId} className="chip-check">
          <input
            type="checkbox"
            checked={selected.includes(role.discordId)}
            onChange={() => onToggle(role.discordId)}
          />
          {role.name}
        </label>
      ))}
    </div>
  );
}

export function SettingsWantedForm({
  initialEnabled,
  initialChannelId,
  initialPingRoleIds,
  initialCoordinatorRoleIds,
  channels,
  incidentGuildId,
  roles,
}: {
  initialEnabled: boolean;
  initialChannelId: string | null;
  initialPingRoleIds: string[];
  initialCoordinatorRoleIds: string[];
  channels: ChannelOption[];
  incidentGuildId: string | null;
  roles: RoleOption[];
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [channelId, setChannelId] = useState(initialChannelId ?? "");
  const [coordinatorRoleIds, setCoordinatorRoleIds] = useState<string[]>(initialCoordinatorRoleIds);
  return (
    <ModuleSettingsForm
      module="wanted"
      fields={[
        { key: "wanted.enabled", value: enabled },
        { key: "wanted.channelId", value: channelId.trim() || null },
        { key: "wanted.coordinatorRoleIds", value: coordinatorRoleIds },
      ]}
    >
      <ToggleRow
        id="wantedEnabled"
        checked={enabled}
        onChange={setEnabled}
        label="Модуль розыска включён"
      />
      <div className="field">
        <label htmlFor="wantedChannel">Канал на сервере ЧП</label>
        <ChannelSelect
          id="wantedChannel"
          value={channelId}
          onChange={setChannelId}
          channels={channels}
          guildDiscordId={incidentGuildId}
          emptyLabel={incidentGuildId ? "Выберите канал" : "Сначала задайте сервер ЧП"}
        />
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
          Slash-команды розыска принимаются только в этом канале (или в канале с именем
          «федеральный розыск»).
        </p>
      </div>
      <div className="field">
        <span className="field-label">Роли координаторов</span>
        <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.85rem" }}>
          Только выбранные роли могут выполнять <code>/объявить-розыск</code> и{" "}
          <code>/розыск-исполнено</code>.
        </p>
        <RolePingPicker
          roles={roles}
          selected={coordinatorRoleIds}
          onToggle={(roleId) =>
            setCoordinatorRoleIds((prev) =>
              prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
            )
          }
          emptyHint={
            incidentGuildId
              ? "Нет ролей сервера ЧП в снимке. Дождитесь синхронизации бота."
              : "Сначала задайте сервер ЧП"
          }
        />
      </div>
      <div className="field">
        <span className="field-label">Пинг при объявлении розыска</span>
        <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.85rem" }}>
          Автоматически тегаются все фракционные роли на сервере ЧП{" "}
          <strong>кроме WN</strong>. Общей роли «Фракция» нет — пинг строится из
          привязок FACTION_MEMBER (или роли с именем кода фракции).
        </p>
        {initialPingRoleIds.length > 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            Снимок provision/настроек (информативно): {initialPingRoleIds.length}{" "}
            ролей. Бот пересчитывает список при каждой публикации.
          </p>
        ) : null}
      </div>
    </ModuleSettingsForm>
  );
}

export function SettingsFinesForm({
  initialDueDays,
  initialChannelId,
  initialPingRoleIds,
  channels,
  incidentGuildId,
  roles,
}: {
  initialDueDays: number;
  initialChannelId: string | null;
  initialPingRoleIds: string[];
  channels: ChannelOption[];
  incidentGuildId: string | null;
  roles: RoleOption[];
}) {
  const [dueDays, setDueDays] = useState(String(initialDueDays));
  const [channelId, setChannelId] = useState(initialChannelId ?? "");
  const [pingRoleIds, setPingRoleIds] = useState<string[]>(initialPingRoleIds);
  return (
    <ModuleSettingsForm
      module="fines"
      fields={[
        { key: "fines.dueDays", value: Number(dueDays) },
        { key: "fines.channelId", value: channelId.trim() || null },
        { key: "fines.pingRoleIds", value: pingRoleIds },
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
        <label htmlFor="finesChannel">Канал на сервере ЧП</label>
        <ChannelSelect
          id="finesChannel"
          value={channelId}
          onChange={setChannelId}
          channels={channels}
          guildDiscordId={incidentGuildId}
          emptyLabel={incidentGuildId ? "Выберите канал" : "Сначала задайте сервер ЧП"}
        />
      </div>
      <div className="field">
        <span className="field-label">Роли для пинга на сервере ЧП</span>
        <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.85rem" }}>
          Отдельно от «старшего состава» фракции: основной реестр штрафов публикуется на ЧП.
          Если у фракции настроены канал документов и роль старшего состава — туда уходит
          дополнительное уведомление с пингом.
        </p>
        <RolePingPicker
          roles={roles}
          selected={pingRoleIds}
          onToggle={(roleId) =>
            setPingRoleIds((prev) =>
              prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
            )
          }
          emptyHint={
            incidentGuildId
              ? "Нет ролей сервера ЧП в снимке. Дождитесь синхронизации бота."
              : "Сначала задайте сервер ЧП"
          }
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
