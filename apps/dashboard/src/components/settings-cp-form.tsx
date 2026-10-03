"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { ToggleRow } from "./toggle-row";

type RoleOption = { discordId: string; name: string };

export function SettingsCpForm({
  initialEnabled,
  initialExcludedRoleIds,
  initialLogChannelId,
  initialMaxKickPercent,
  initialDryRun,
  incidentGuildId,
  channels,
  roles,
}: {
  initialEnabled: boolean;
  initialExcludedRoleIds: string[];
  initialLogChannelId: string | null;
  initialMaxKickPercent: number;
  initialDryRun: boolean;
  incidentGuildId: string | null;
  channels: ChannelOption[];
  roles: RoleOption[];
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [excluded, setExcluded] = useState<string[]>(initialExcludedRoleIds);
  const [logChannelId, setLogChannelId] = useState(initialLogChannelId ?? "");
  const [maxKickPercent, setMaxKickPercent] = useState(String(initialMaxKickPercent));
  const [dryRun, setDryRun] = useState(initialDryRun);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [run, setRun] = useState<{ state: "running" | "done" | "failed"; text: string } | null>(null);

  /** Starts a full reconcile now and shows what the bot did. */
  async function runNow() {
    setRun({ state: "running", text: "Бот сверяет участников сервера ЧП…" });
    try {
      const started = await fetch("/api/settings/cp-sync", { method: "POST" });
      const startedData = (await started.json()) as { error?: string; job?: { id: string } };
      if (!started.ok || !startedData.job) throw new Error(startedData.error ?? "Не удалось запустить");
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const res = await fetch(`/api/settings/cp-sync?job=${encodeURIComponent(startedData.job.id)}`);
        const data = (await res.json()) as {
          job?: { status: string; lastError: string | null; result: Record<string, unknown> | null };
        };
        const job = data.job;
        if (!job || job.status === "PENDING" || job.status === "RUNNING") continue;
        if (job.status !== "SUCCEEDED") throw new Error(job.lastError ?? "Сверка завершилась с ошибкой");
        const result = job.result ?? {};
        if (result.status === "skipped") {
          setRun({ state: "failed", text: String(result.reason ?? "Сверка не выполнена.") });
          return;
        }
        const held = Number(result.kicksHeld ?? 0);
        setRun({
          state: held > 0 ? "failed" : "done",
          text: [
            `Проверено участников: ${Number(result.processed ?? 0)}`,
            `обновлено ролей: ${Number(result.updates ?? 0)}`,
            held > 0
              ? `исключения остановлены пределом: ${held} (никто не исключён)`
              : `исключено: ${Number(result.kicks ?? 0)}`,
            Number(result.unknown ?? 0) > 0 ? `пропущено из-за недоступного сервера: ${Number(result.unknown)}` : null,
            result.dryRun ? "сухой прогон — изменения не применялись" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        return;
      }
      throw new Error("Бот не ответил за две минуты. Сверка выполнится, когда бот вернётся.");
    } catch (e) {
      setRun({ state: "failed", text: e instanceof Error ? e.message : "Ошибка" });
    }
  }

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
          "cp.maxKickPercent": Math.min(100, Math.max(0, Number(maxKickPercent) || 0)),
          "cp.dryRun": dryRun,
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
      <ToggleRow
        id="cpEnabled"
        checked={enabled}
        onChange={setEnabled}
        label="Синхронизация включена"
      />
      <ToggleRow
        id="cpDryRun"
        checked={dryRun}
        onChange={setDryRun}
        label="Сухой прогон: только писать в лог-канал, что было бы сделано"
      />
      <div className="field">
        <label htmlFor="cpMaxKick">Предел исключений за одну сверку, % участников</label>
        <input
          id="cpMaxKick"
          type="number"
          min={0}
          max={100}
          step={1}
          value={maxKickPercent}
          onChange={(e) => setMaxKickPercent(e.target.value)}
        />
        <span className="field-hint">
          Если полная сверка хочет исключить больше этой доли (но не меньше трёх человек), бот никого не
          исключает и пишет предупреждение в лог-канал. Это защита от ошибки в привязках ролей и от сбоя
          Discord.
        </span>
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
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Сохранить синхронизацию
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={run?.state === "running" || !incidentGuildId}
          onClick={() => void runNow()}
        >
          {run?.state === "running" ? "Сверка идёт…" : "Запустить сверку сейчас"}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {run ? (
        <p className={run.state === "failed" ? "form-error" : run.state === "done" ? "form-ok" : "muted"} role="status">
          {run.text}
        </p>
      ) : null}
    </form>
  );
}
