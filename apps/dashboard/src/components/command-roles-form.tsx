"use client";

import { useState } from "react";

export type GuildRoles = {
  discordId: string;
  name: string;
  roles: { discordId: string; name: string }[];
};

type RuleKey =
  | "documents.posterRoleIds"
  | "documents.responderRoleIds"
  | "fines.managerRoleIds"
  | "personnel.managerRoleIds";

const RULES: { key: RuleKey; title: string; commands: string; whenEmpty: string }[] = [
  {
    key: "documents.posterRoleIds",
    title: "Отправка документов",
    commands: "/пост",
    whenEmpty: "Пока роли не выбраны — любой сотрудник любой фракции.",
  },
  {
    key: "documents.responderRoleIds",
    title: "Ответ на документ",
    commands: "/ответ",
    whenEmpty: "Пока роли не выбраны — сотрудники фракции документа и GOV.",
  },
  {
    key: "fines.managerRoleIds",
    title: "Штрафы",
    commands: "/штраф, /штраф-оплачено",
    whenEmpty: "Пока роли не выбраны — только администраторы.",
  },
  {
    key: "personnel.managerRoleIds",
    title: "Кадровый аудит",
    commands: "/кадровый-аудит",
    whenEmpty:
      "Лидер и заместитель фракции могут всегда. Выбранные роли получают то же право внутри своей фракции.",
  },
];

/** Roles of every guild, grouped; a group opens when it has a chosen role. */
function GuildRolePicker({
  guilds,
  selected,
  onToggle,
}: {
  guilds: GuildRoles[];
  selected: string[];
  onToggle: (roleId: string) => void;
}) {
  if (guilds.length === 0) {
    return <p className="muted">Нет серверов в снимке. Дождитесь синхронизации бота.</p>;
  }
  return (
    <div className="command-roles-guilds">
      {guilds.map((guild) => {
        const chosen = guild.roles.filter((role) => selected.includes(role.discordId)).length;
        return (
          <details key={guild.discordId} className="admin-roles-guild" open={chosen > 0}>
            <summary>
              {guild.name}
              {chosen > 0 ? <span className="mini-tag">выбрано: {chosen}</span> : null}
            </summary>
            <div className="chip-row">
              {guild.roles.map((role) => (
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
          </details>
        );
      })}
    </div>
  );
}

export function CommandRolesForm({
  guilds,
  initial,
}: {
  guilds: GuildRoles[];
  initial: Record<RuleKey, string[]>;
}) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(key: RuleKey, roleId: string) {
    setValues((prev) => ({
      ...prev,
      [key]: prev[key].includes(roleId) ? prev[key].filter((id) => id !== roleId) : [...prev[key], roleId],
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setMessage({ ok: true, text: "Сохранено. Новые права действуют сразу." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <h2 className="panel-title u-mt0">
        Права команд
      </h2>
      <p className="muted u-mt0">
        Какие роли могут выполнять команды бота. Администраторы («Админ» и выше) могут всегда. Роль считается
        на том сервере, где набрана команда.
      </p>
      {RULES.map((rule) => (
        <div key={rule.key} className="field command-roles-rule">
          <span className="field-label">
            {rule.title} <code>{rule.commands}</code>
          </span>
          <span className="field-hint">{rule.whenEmpty}</span>
          <GuildRolePicker guilds={guilds} selected={values[rule.key]} onToggle={(roleId) => toggle(rule.key, roleId)} />
        </div>
      ))}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Сохранение…" : "Сохранить права команд"}
      </button>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
