"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LEVELS = [
  { key: "SUPER_ADMIN", label: "Главный администратор" },
  { key: "SENIOR_ADMIN", label: "Старший администратор" },
  { key: "ADMIN", label: "Администратор" },
  { key: "HELPER", label: "Хелпер" },
] as const;
type LevelKey = (typeof LEVELS)[number]["key"];
type LevelSets = Record<LevelKey, string[]>;

export type AdminRolesGuild = {
  discordId: string;
  name: string;
  roles: { discordId: string; name: string }[];
};

export type AdminRoleReportRow = {
  guildDiscordId: string;
  guildName: string;
  outcome: string;
  added: string[];
  removed: string[];
  detail: string | null;
};

export type AdminRoleOperationRow = {
  id: string;
  target: string;
  level: string | null;
  status: string;
  requestedBy: string;
  createdAt: string;
  report: AdminRoleReportRow[];
};

const OUTCOME_RU: Record<string, { text: string; tone: string }> = {
  changed: { text: "Роли изменены", tone: "ok" },
  unchanged: { text: "Уже в порядке", tone: "ok" },
  not_member: { text: "Не состоит на сервере", tone: "muted" },
  unavailable: { text: "Сервер недоступен боту", tone: "warn" },
  failed: { text: "Ошибка", tone: "bad" },
};

const STATUS_RU: Record<string, { text: string; tone: string }> = {
  PENDING: { text: "Выполняется", tone: "warn" },
  DONE: { text: "Готово", tone: "ok" },
  FAILED: { text: "Не удалось", tone: "bad" },
};

const emptySets = (): LevelSets => ({ SUPER_ADMIN: [], SENIOR_ADMIN: [], ADMIN: [], HELPER: [] });

function levelLabel(level: string | null): string {
  return level ? (LEVELS.find((entry) => entry.key === level)?.label ?? level) : "Снять все admin-роли";
}

function Report({ rows, roleNames }: { rows: AdminRoleReportRow[]; roleNames: Map<string, string> }) {
  if (rows.length === 0) return <p className="muted">Отчёта ещё нет.</p>;
  const names = (ids: string[]) => ids.map((id) => roleNames.get(id) ?? id).join(", ");
  return (
    <div className="registry-table-wrap">
      <table className="registry-table">
        <thead>
          <tr>
            <th>Сервер</th>
            <th>Результат</th>
            <th>Выдано</th>
            <th>Снято</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const outcome = OUTCOME_RU[row.outcome] ?? { text: row.outcome, tone: "muted" };
            return (
              <tr key={row.guildDiscordId}>
                <td>{row.guildName}</td>
                <td>
                  <span className="registry-status" data-status={outcome.tone}>
                    {outcome.text}
                  </span>
                  {row.detail ? <span className="muted"> · {row.detail}</span> : null}
                </td>
                <td>{row.added.length ? names(row.added) : "—"}</td>
                <td>{row.removed.length ? names(row.removed) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AdminRolesManager({
  guilds,
  initialSets,
  operations,
}: {
  guilds: AdminRolesGuild[];
  initialSets: Record<string, Partial<LevelSets>>;
  operations: AdminRoleOperationRow[];
}) {
  const router = useRouter();
  const [sets, setSets] = useState<Record<string, LevelSets>>(() =>
    Object.fromEntries(guilds.map((guild) => [guild.discordId, { ...emptySets(), ...initialSets[guild.discordId] }])),
  );
  const [savePending, setSavePending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [target, setTarget] = useState("");
  const [level, setLevel] = useState<LevelKey | "">("HELPER");
  const [applyPending, setApplyPending] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [live, setLive] = useState<{ id: string; status: string; report: AdminRoleReportRow[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const roleNames = new Map(guilds.flatMap((guild) => guild.roles.map((role) => [role.discordId, role.name] as const)));

  function toggle(guildId: string, levelKey: LevelKey, roleId: string) {
    setSets((prev) => {
      const current = prev[guildId] ?? emptySets();
      const list = current[levelKey];
      const next = list.includes(roleId) ? list.filter((id) => id !== roleId) : [...list, roleId];
      return { ...prev, [guildId]: { ...current, [levelKey]: next } };
    });
  }

  async function save() {
    setSavePending(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/settings/admin-roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sets }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setSaveMessage({ ok: true, text: "Сохранено" });
    } catch (e) {
      setSaveMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setSavePending(false);
    }
  }

  function poll(id: string, attempt: number) {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/settings/admin-roles?operation=${encodeURIComponent(id)}`);
        const data = (await res.json()) as {
          operation?: { id: string; status: string; report: AdminRoleReportRow[] | null };
        };
        if (res.ok && data.operation) {
          setLive({ id, status: data.operation.status, report: data.operation.report ?? [] });
          if (data.operation.status !== "PENDING") {
            setApplyPending(false);
            router.refresh();
            return;
          }
        }
      } catch {
        // A failed poll is retried below.
      }
      if (attempt >= 45) {
        setApplyPending(false);
        setApplyError("Бот не ответил за полторы минуты. Операция выполнится, когда бот вернётся.");
        return;
      }
      poll(id, attempt + 1);
    }, 2000);
  }

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    setApplyPending(true);
    setApplyError(null);
    setLive(null);
    try {
      const res = await fetch("/api/settings/admin-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDiscordId: target.trim(), level: level || null }),
      });
      const data = (await res.json()) as { error?: string; operation?: { id: string } };
      if (!res.ok || !data.operation) throw new Error(data.error ?? "Ошибка");
      setLive({ id: data.operation.id, status: "PENDING", report: [] });
      poll(data.operation.id, 0);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Ошибка");
      setApplyPending(false);
    }
  }

  return (
    <div className="stack">
      <div className="panel">
        <h2 className="panel-title u-mt0">
          Роли по уровням
        </h2>
        <p className="muted u-mt0">
          Для каждого сервера отметьте роли, которые должен носить администратор каждого уровня. При выдаче
          уровня бот выдаст эти роли и снимет роли остальных уровней.
        </p>
        {guilds.length === 0 ? <p className="muted">Подключённых серверов нет.</p> : null}
        {guilds.map((guild) => (
          <details key={guild.discordId} className="admin-roles-guild">
            <summary>
              <strong>{guild.name}</strong>
              <span className="muted">
                {" "}
                · выбрано ролей:{" "}
                {LEVELS.reduce((sum, entry) => sum + (sets[guild.discordId]?.[entry.key].length ?? 0), 0)}
              </span>
            </summary>
            {guild.roles.length === 0 ? (
              <p className="muted">Роли сервера ещё не синхронизированы.</p>
            ) : (
              <div className="admin-roles-levels">
                {LEVELS.map((entry) => (
                  <fieldset key={entry.key} className="admin-roles-level">
                    <legend>{entry.label}</legend>
                    <div className="admin-roles-options">
                      {guild.roles.map((role) => {
                        const checked = sets[guild.discordId]?.[entry.key].includes(role.discordId) ?? false;
                        const full = !checked && (sets[guild.discordId]?.[entry.key].length ?? 0) >= 10;
                        return (
                          <label key={role.discordId} className="admin-roles-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={full}
                              onChange={() => toggle(guild.discordId, entry.key, role.discordId)}
                            />
                            <span>{role.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          </details>
        ))}
        <button type="button" className="btn btn-primary" disabled={savePending} onClick={() => void save()}>
          {savePending ? "Сохранение…" : "Сохранить наборы ролей"}
        </button>
        {saveMessage ? (
          <p className={saveMessage.ok ? "form-ok" : "form-error"} role="status">
            {saveMessage.text}
          </p>
        ) : null}
      </div>

      <form className="panel" onSubmit={(event) => void apply(event)}>
        <h2 className="panel-title u-mt0">
          Выдать или снять уровень
        </h2>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="adminRoleTarget">Discord ID</label>
            <input
              id="adminRoleTarget"
              required
              inputMode="numeric"
              pattern="\d{17,20}"
              placeholder="17–20 цифр"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adminRoleLevel">Уровень</label>
            <select id="adminRoleLevel" value={level} onChange={(event) => setLevel(event.target.value as LevelKey | "")}>
              {LEVELS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
              <option value="">Снять все admin-роли</option>
            </select>
          </div>
        </div>
        <p className="field-hint">Сначала сохраните наборы ролей: бот применяет сохранённые.</p>
        <button type="submit" className="btn btn-primary" disabled={applyPending}>
          {applyPending ? "Бот применяет…" : "Применить на всех серверах"}
        </button>
        {applyError ? (
          <p className="form-error" role="alert">
            {applyError}
          </p>
        ) : null}
        {live ? (
          <div className="stack u-mt4">
            <p>
              <span className="registry-status" data-status={(STATUS_RU[live.status] ?? STATUS_RU.PENDING)!.tone}>
                {(STATUS_RU[live.status] ?? STATUS_RU.PENDING)!.text}
              </span>
            </p>
            {live.status !== "PENDING" ? <Report rows={live.report} roleNames={roleNames} /> : null}
          </div>
        ) : null}
      </form>

      <div className="panel">
        <h2 className="panel-title u-mt0">
          Последние операции
        </h2>
        {operations.length === 0 ? (
          <p className="muted">Операций ещё не было.</p>
        ) : (
          operations.map((operation) => {
            const status = STATUS_RU[operation.status] ?? { text: operation.status, tone: "muted" };
            return (
              <details key={operation.id} className="admin-roles-guild">
                <summary>
                  <strong>{operation.target}</strong> → {levelLabel(operation.level)}{" "}
                  <span className="registry-status" data-status={status.tone}>
                    {status.text}
                  </span>
                  <span className="muted">
                    {" "}
                    · {operation.requestedBy}, {operation.createdAt} МСК
                  </span>
                </summary>
                <Report rows={operation.report} roleNames={roleNames} />
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
