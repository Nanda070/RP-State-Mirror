"use client";

import { useMemo, useState } from "react";

interface Guild {
  discordId: string;
  name: string;
}

interface Faction {
  code: string;
  name: string;
  color: string | null;
}

interface Role {
  discordId: string;
  name: string;
  color: number;
  guild: Guild;
}

interface Mapping {
  id: string;
  roleDiscordId: string;
  kind: string;
  value: string;
  guild: Guild;
  faction: { code: string; name: string } | null;
}

const KIND_LABELS: Record<string, string> = {
  ADMIN_LEVEL: "Уровень админа",
  FACTION_MEMBER: "Участник фракции",
  FACTION_LEADER: "Лидер фракции",
  FACTION_DEPUTY: "Заместитель",
  DEPARTMENT: "Отдел",
  RANK: "Ранг",
  PERMISSION: "Право",
};

const ADMIN_VALUES = ["SUPER_ADMIN", "SENIOR_ADMIN", "ADMIN", "HELPER"];

export function SettingsRolesForm({
  initialMappings,
  guilds,
  factions,
  roles,
  kinds,
}: {
  initialMappings: Mapping[];
  guilds: Guild[];
  factions: Faction[];
  roles: Role[];
  kinds: string[];
}) {
  const [mappings, setMappings] = useState(initialMappings);
  const [guildDiscordId, setGuild] = useState(guilds[0]?.discordId ?? "");
  const [roleDiscordId, setRole] = useState("");
  const [kind, setKind] = useState("ADMIN_LEVEL");
  const [value, setValue] = useState("ADMIN");
  const [factionCode, setFaction] = useState(factions[0]?.code ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const guildRoles = useMemo(
    () => roles.filter((role) => role.guild.discordId === guildDiscordId),
    [roles, guildDiscordId],
  );

  const needsFaction = [
    "FACTION_MEMBER",
    "FACTION_LEADER",
    "FACTION_DEPUTY",
    "DEPARTMENT",
    "RANK",
  ].includes(kind);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/role-mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guildDiscordId,
          roleDiscordId,
          kind,
          value,
          factionCode: needsFaction ? factionCode : null,
        }),
      });
      const data = (await response.json()) as { error?: string; mapping?: Mapping };
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить");
      const refresh = await fetch(
        `/api/settings/role-mappings?guildDiscordId=${encodeURIComponent(guildDiscordId)}`,
      );
      const refreshed = (await refresh.json()) as { mappings: Mapping[] };
      setMappings(refreshed.mappings);
      setMessage("Привязка сохранена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function onArchive(id: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/role-mappings", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось архивировать");
      setMappings((items) => items.filter((item) => item.id !== id));
      setMessage("Привязка архивирована (без физического удаления).");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel" onSubmit={onCreate}>
        <h2 style={{ marginTop: 0 }}>Новая привязка роли</h2>
        <div className="field">
          <label htmlFor="guild">Сервер</label>
          <select
            id="guild"
            value={guildDiscordId}
            onChange={(event) => {
              setGuild(event.target.value);
              setRole("");
            }}
          >
            {guilds.map((guild) => (
              <option key={guild.discordId} value={guild.discordId}>
                {guild.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="role">Роль Discord</label>
          <select
            id="role"
            value={roleDiscordId}
            onChange={(event) => setRole(event.target.value)}
            required
          >
            <option value="">Выберите роль</option>
            {guildRoles.map((role) => (
              <option key={role.discordId} value={role.discordId}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kind">Тип</label>
          <select
            id="kind"
            value={kind}
            onChange={(event) => {
              const next = event.target.value;
              setKind(next);
              if (next === "ADMIN_LEVEL") setValue("ADMIN");
              if (next === "RANK") setValue("1");
              if (next === "DEPARTMENT") setValue("");
              if (next === "PERMISSION") setValue("");
              if (next.startsWith("FACTION_")) setValue("true");
            }}
          >
            {kinds.map((item) => (
              <option key={item} value={item}>
                {KIND_LABELS[item] ?? item}
              </option>
            ))}
          </select>
        </div>
        {kind === "ADMIN_LEVEL" ? (
          <div className="field">
            <label htmlFor="adminValue">Уровень</label>
            <select id="adminValue" value={value} onChange={(event) => setValue(event.target.value)}>
              {ADMIN_VALUES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        ) : kind === "RANK" || kind === "DEPARTMENT" || kind === "PERMISSION" ? (
          <div className="field">
            <label htmlFor="value">Значение</label>
            <input
              id="value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
              placeholder={kind === "RANK" ? "1–20" : "код или название"}
            />
          </div>
        ) : (
          <input type="hidden" value={value || "true"} readOnly />
        )}
        {needsFaction ? (
          <div className="field">
            <label htmlFor="faction">Фракция</label>
            <select
              id="faction"
              value={factionCode}
              onChange={(event) => setFaction(event.target.value)}
              required
            >
              {factions.map((faction) => (
                <option key={faction.code} value={faction.code}>
                  {faction.code} — {faction.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending || !roleDiscordId}>
          {pending ? "Сохранение…" : "Добавить привязку"}
        </button>
        {message ? <p className="muted">{message}</p> : null}
      </form>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Активные привязки</h2>
        {mappings.length === 0 ? (
          <p className="muted">Пока нет привязок.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Сервер</th>
                <th>Роль</th>
                <th>Тип</th>
                <th>Значение</th>
                <th>Фракция</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>{mapping.guild.name}</td>
                  <td>
                    <code>{mapping.roleDiscordId}</code>
                  </td>
                  <td>{KIND_LABELS[mapping.kind] ?? mapping.kind}</td>
                  <td>{mapping.value}</td>
                  <td>{mapping.faction?.code ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={pending}
                      onClick={() => onArchive(mapping.id)}
                    >
                      Архив
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
