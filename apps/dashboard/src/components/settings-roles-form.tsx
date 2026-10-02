"use client";

import { useMemo, useState } from "react";
import { RoleMultiSelect, type RoleOption, type SelectedRole } from "./role-multi-select";

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

const ADMIN_VALUES = [
  { value: "SUPER_ADMIN", label: "Главный администратор" },
  { value: "SENIOR_ADMIN", label: "Старший администратор" },
  { value: "ADMIN", label: "Администратор" },
  { value: "HELPER", label: "Хелпер" },
] as const;

const FACTION_KINDS = [
  { kind: "FACTION_MEMBER", label: "Участники" },
  { kind: "FACTION_LEADER", label: "Лидеры" },
  { kind: "FACTION_DEPUTY", label: "Заместители" },
] as const;

function mappingKey(kind: string, value: string, factionCode: string | null | undefined): string {
  return `${kind}|${value}|${factionCode ?? ""}`;
}

export function SettingsRolesForm({
  initialMappings,
  guilds,
  factions,
  roles,
}: {
  initialMappings: Mapping[];
  guilds: Guild[];
  factions: Faction[];
  roles: Role[];
  kinds?: string[];
}) {
  const [mappings, setMappings] = useState(initialMappings);
  const [emptyTargets, setEmptyTargets] = useState<
    { kind: string; value: string; factionCode: string | null }[]
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [extraKind, setExtraKind] = useState("DEPARTMENT");
  const [extraValue, setExtraValue] = useState("");
  const [extraFaction, setExtraFaction] = useState(factions[0]?.code ?? "");

  const roleById = useMemo(() => new Map(roles.map((role) => [role.discordId, role])), [roles]);

  const roleOptions: RoleOption[] = useMemo(
    () =>
      roles.map((role) => ({
        discordId: role.discordId,
        name: role.name,
        color: role.color,
        category: role.guild.name || role.guild.discordId,
      })),
    [roles],
  );

  const selectedFor = useMemo(() => {
    const map = new Map<string, SelectedRole[]>();
    for (const mapping of mappings) {
      const role = roleById.get(mapping.roleDiscordId);
      const key = mappingKey(mapping.kind, mapping.value, mapping.faction?.code);
      const list = map.get(key) ?? [];
      list.push({
        mappingId: mapping.id,
        discordId: mapping.roleDiscordId,
        name: role?.name ?? mapping.roleDiscordId,
        color: role?.color ?? 0,
      });
      map.set(key, list);
    }
    return map;
  }, [mappings, roleById]);

  const extraTargets = useMemo(() => {
    const keys = new Set<string>();
    const items: { kind: string; value: string; factionCode: string | null }[] = [];
    for (const mapping of mappings) {
      if (!["DEPARTMENT", "RANK", "PERMISSION"].includes(mapping.kind)) continue;
      const key = mappingKey(mapping.kind, mapping.value, mapping.faction?.code);
      if (keys.has(key)) continue;
      keys.add(key);
      items.push({
        kind: mapping.kind,
        value: mapping.value,
        factionCode: mapping.faction?.code ?? null,
      });
    }
    for (const target of emptyTargets) {
      const key = mappingKey(target.kind, target.value, target.factionCode);
      if (keys.has(key)) continue;
      keys.add(key);
      items.push(target);
    }
    return items;
  }, [mappings, emptyTargets]);

  async function refreshMappings() {
    const refresh = await fetch("/api/settings/role-mappings");
    const refreshed = (await refresh.json()) as { mappings: Mapping[]; error?: string };
    if (!refresh.ok) throw new Error(refreshed.error ?? "Не удалось обновить список");
    setMappings(refreshed.mappings);
  }

  async function addRole(
    roleDiscordId: string,
    kind: string,
    value: string,
    factionCode: string | null,
  ) {
    const role = roleById.get(roleDiscordId);
    if (!role) {
      setMessage("Роль не найдена");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/role-mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guildDiscordId: role.guild.discordId,
          roleDiscordId,
          kind,
          value,
          factionCode,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить");
      await refreshMappings();
      setMessage("Привязка сохранена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function removeRole(mappingId: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/role-mappings", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mappingId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось архивировать");
      setMappings((items) => items.filter((item) => item.id !== mappingId));
      setMessage("Привязка архивирована.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  function registerExtraTarget(event: React.FormEvent) {
    event.preventDefault();
    const value = extraValue.trim();
    if (!value) {
      setMessage("Укажите значение");
      return;
    }
    const needsFaction = extraKind === "DEPARTMENT" || extraKind === "RANK";
    const factionCode = needsFaction ? extraFaction || null : null;
    if (needsFaction && !factionCode) {
      setMessage("Выберите фракцию");
      return;
    }
    const key = mappingKey(extraKind, value, factionCode);
    setEmptyTargets((prev) => {
      if (prev.some((t) => mappingKey(t.kind, t.value, t.factionCode) === key)) return prev;
      if (
        mappings.some((m) => mappingKey(m.kind, m.value, m.faction?.code) === key)
      ) {
        return prev;
      }
      return [...prev, { kind: extraKind, value, factionCode }];
    });
    setExtraValue("");
    setMessage(`Цель «${KIND_LABELS[extraKind] ?? extraKind}: ${value}» готова — добавьте роли.`);
  }

  return (
    <div className="stack">
      {message ? <p className="muted">{message}</p> : null}

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Уровни доступа
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Несколько Discord-ролей могут соответствовать одному уровню.
        </p>
        <div className="stack" style={{ gap: "1rem" }}>
          {ADMIN_VALUES.map((level) => {
            const key = mappingKey("ADMIN_LEVEL", level.value, null);
            return (
              <RoleMultiSelect
                key={level.value}
                label={level.label}
                hint={`ADMIN_LEVEL · ${level.value}`}
                selected={selectedFor.get(key) ?? []}
                options={roleOptions}
                disabled={pending}
                onAdd={(roleDiscordId) => addRole(roleDiscordId, "ADMIN_LEVEL", level.value, null)}
                onRemove={removeRole}
              />
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Фракции
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Роли участников, лидеров и заместителей по каждой фракции.
        </p>
        {factions.length === 0 ? (
          <p className="muted">Нет активных фракций.</p>
        ) : (
          <div className="stack" style={{ gap: "1.25rem" }}>
            {factions.map((faction) => (
              <div key={faction.code} className="role-faction-block">
                <h3 className="role-faction-title">
                  {faction.code}
                  <span className="muted"> — {faction.name}</span>
                </h3>
                <div className="stack" style={{ gap: "0.85rem" }}>
                  {FACTION_KINDS.map((item) => {
                    const key = mappingKey(item.kind, "true", faction.code);
                    return (
                      <RoleMultiSelect
                        key={`${faction.code}-${item.kind}`}
                        label={item.label}
                        selected={selectedFor.get(key) ?? []}
                        options={roleOptions}
                        disabled={pending}
                        onAdd={(roleDiscordId) =>
                          addRole(roleDiscordId, item.kind, "true", faction.code)
                        }
                        onRemove={removeRole}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Отделы, ранги и права
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Создайте цель привязки, затем добавьте одну или несколько ролей.
        </p>

        <form className="role-extra-form" onSubmit={registerExtraTarget}>
          <div className="field">
            <label htmlFor="extraKind">Тип</label>
            <select
              id="extraKind"
              value={extraKind}
              onChange={(event) => setExtraKind(event.target.value)}
            >
              <option value="DEPARTMENT">Отдел</option>
              <option value="RANK">Ранг</option>
              <option value="PERMISSION">Право</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="extraValue">Значение</label>
            <input
              id="extraValue"
              value={extraValue}
              onChange={(event) => setExtraValue(event.target.value)}
              placeholder={extraKind === "RANK" ? "1–20" : "код или название"}
              required
            />
          </div>
          {extraKind === "DEPARTMENT" || extraKind === "RANK" ? (
            <div className="field">
              <label htmlFor="extraFaction">Фракция</label>
              <select
                id="extraFaction"
                value={extraFaction}
                onChange={(event) => setExtraFaction(event.target.value)}
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
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            Добавить цель
          </button>
        </form>

        {extraTargets.length === 0 ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            Пока нет целей отдела / ранга / права.
          </p>
        ) : (
          <div className="stack" style={{ gap: "1rem", marginTop: "1rem" }}>
            {extraTargets.map((target) => {
              const key = mappingKey(target.kind, target.value, target.factionCode);
              const title = `${KIND_LABELS[target.kind] ?? target.kind}: ${target.value}${
                target.factionCode ? ` · ${target.factionCode}` : ""
              }`;
              return (
                <RoleMultiSelect
                  key={key}
                  label={title}
                  selected={selectedFor.get(key) ?? []}
                  options={roleOptions}
                  disabled={pending}
                  onAdd={(roleDiscordId) =>
                    addRole(roleDiscordId, target.kind, target.value, target.factionCode)
                  }
                  onRemove={removeRole}
                />
              );
            })}
          </div>
        )}
      </div>

      {guilds.length === 0 ? (
        <p className="muted">Нет синхронизированных серверов — роли появятся после синка бота.</p>
      ) : null}
    </div>
  );
}
