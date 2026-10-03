"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { ToggleRow } from "./toggle-row";

export type RolePanelSummary = {
  id: string;
  title: string;
  mode: "buttons" | "select";
  labels: string[];
  guildName: string;
  channelName: string;
  messageUrl: string | null;
  updatedAt: string;
};

type Guild = { discordId: string; name: string };
type Role = { discordId: string; name: string; guildDiscordId: string };
type Style = "primary" | "secondary" | "success" | "danger";
type Item = { rowId: number; label: string; roleDiscordId: string; style: Style; description: string };

const STYLES: { value: Style; label: string }[] = [
  { value: "secondary", label: "Серая" },
  { value: "primary", label: "Синяя" },
  { value: "success", label: "Зелёная" },
  { value: "danger", label: "Красная" },
];
const MAX_ITEMS = 25;
let nextRowId = 1;

function newItem(): Item {
  return { rowId: nextRowId++, label: "", roleDiscordId: "", style: "secondary", description: "" };
}

export function RolePanelsManager({
  guilds,
  channels,
  roles,
  panels,
}: {
  guilds: Guild[];
  channels: ChannelOption[];
  roles: Role[];
  panels: RolePanelSummary[];
}) {
  const router = useRouter();
  const [guildId, setGuildId] = useState(guilds[0]?.discordId ?? "");
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#ff6a1a");
  const [mode, setMode] = useState<"buttons" | "select">("buttons");
  const [exclusive, setExclusive] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [items, setItems] = useState<Item[]>(() => [newItem()]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const guildRoles = useMemo(() => roles.filter((role) => role.guildDiscordId === guildId), [roles, guildId]);
  const usedRoles = new Set(items.map((item) => item.roleDiscordId).filter(Boolean));

  const setItem = (rowId: number, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.rowId === rowId ? { ...item, ...patch } : item)));

  function changeGuild(next: string) {
    setGuildId(next);
    setChannelId("");
    setAllowed([]);
    // Roles belong to a guild: picks from the previous one are no longer valid.
    setItems((current) => current.map((item) => ({ ...item, roleDiscordId: "" })));
  }

  const problems: string[] = [];
  if (!guildId) problems.push("Выберите сервер.");
  if (!channelId) problems.push("Выберите канал.");
  if (!title.trim()) problems.push("Укажите заголовок сообщения.");
  if (items.some((item) => !item.roleDiscordId)) problems.push("Выберите роль в каждой строке.");
  if (items.some((item) => !item.label.trim())) problems.push("Укажите подпись в каждой строке.");

  async function create() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/role-panels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildDiscordId: guildId,
          channelDiscordId: channelId,
          title,
          description: description || null,
          color: Number.parseInt(color.slice(1), 16),
          mode,
          exclusive,
          placeholder: mode === "select" ? placeholder || null : null,
          allowedRoleIds: allowed,
          items: items.map((item) => ({
            label: item.label,
            roleDiscordId: item.roleDiscordId,
            style: item.style,
            description: mode === "select" ? item.description || null : null,
          })),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка создания панели");
      setTitle("");
      setDescription("");
      setItems([newItem()]);
      setAllowed([]);
      setMessage({ ok: true, text: "Панель создана. Бот опубликует сообщение в течение нескольких секунд." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка создания панели" });
    } finally {
      setPending(false);
    }
  }

  async function act(id: string, action: "archive" | "republish") {
    if (
      action === "archive" &&
      !window.confirm("Убрать панель в архив? Кнопки и список исчезнут из сообщения, выданные роли останутся.")
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/role-panels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({
        ok: true,
        text: action === "archive" ? "Панель убрана в архив." : "Сообщение будет обновлено через несколько секунд.",
      });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel-title">Новая панель</h2>
        {guilds.length === 0 ? (
          <p className="muted">Нет подключённых серверов. Добавьте бота на сервер и дождитесь синхронизации.</p>
        ) : (
          <>
            <div className="form-grid-3">
              <div className="field">
                <label htmlFor="panelGuild">Сервер</label>
                <select id="panelGuild" value={guildId} onChange={(event) => changeGuild(event.target.value)}>
                  {guilds.map((guild) => (
                    <option key={guild.discordId} value={guild.discordId}>
                      {guild.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="panelChannel">Канал</label>
                <ChannelSelect
                  id="panelChannel"
                  value={channelId}
                  onChange={setChannelId}
                  channels={channels}
                  guildDiscordId={guildId}
                  emptyLabel="Выберите канал"
                />
              </div>
              <div className="field">
                <label htmlFor="panelMode">Вид</label>
                <select
                  id="panelMode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "buttons" | "select")}
                >
                  <option value="buttons">Кнопки (одна кнопка — одна роль)</option>
                  <option value="select">Выпадающий список</option>
                </select>
              </div>
            </div>

            <div className="form-grid-3">
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="panelTitle">Заголовок сообщения</label>
                <input
                  id="panelTitle"
                  maxLength={256}
                  placeholder="Например: Выберите отдел"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="panelColor">Цвет полосы</label>
                <input id="panelColor" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="panelDescription">Текст сообщения</label>
              <textarea
                id="panelDescription"
                rows={3}
                maxLength={4000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {mode === "select" ? (
              <div className="field">
                <label htmlFor="panelPlaceholder">Надпись в списке</label>
                <input
                  id="panelPlaceholder"
                  maxLength={150}
                  placeholder={exclusive ? "Выберите роль" : "Выберите роли"}
                  value={placeholder}
                  onChange={(event) => setPlaceholder(event.target.value)}
                />
                <span className="field-hint">
                  Список работает как «набор»: отмеченные роли выдаются, остальные из списка снимаются.
                </span>
              </div>
            ) : null}

            <div className="row builder-head">
              <h3 className="panel-title">
                Роли ({items.length} из {MAX_ITEMS})
              </h3>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={items.length >= MAX_ITEMS}
                onClick={() => setItems((current) => [...current, newItem()])}
              >
                Добавить роль
              </button>
            </div>
            {guildRoles.length === 0 ? (
              <p className="muted">
                У сервера нет ролей в снимке, которые бот может выдавать. Дождитесь синхронизации бота.
              </p>
            ) : null}
            <div className="builder-fields">
              {items.map((item) => (
                <div key={item.rowId} className="builder-field">
                  <div className="form-grid-3">
                    <div className="field">
                      <label htmlFor={`role-${item.rowId}`}>Роль</label>
                      <select
                        id={`role-${item.rowId}`}
                        value={item.roleDiscordId}
                        onChange={(event) => {
                          const role = guildRoles.find((entry) => entry.discordId === event.target.value);
                          setItem(item.rowId, {
                            roleDiscordId: event.target.value,
                            // A fresh row takes the role name as its caption.
                            ...(role && !item.label.trim() ? { label: role.name.slice(0, 80) } : {}),
                          });
                        }}
                      >
                        <option value="">Выберите роль</option>
                        {guildRoles.map((role) => (
                          <option
                            key={role.discordId}
                            value={role.discordId}
                            disabled={usedRoles.has(role.discordId) && role.discordId !== item.roleDiscordId}
                          >
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`label-${item.rowId}`}>Подпись</label>
                      <input
                        id={`label-${item.rowId}`}
                        maxLength={80}
                        value={item.label}
                        onChange={(event) => setItem(item.rowId, { label: event.target.value })}
                      />
                    </div>
                    {mode === "buttons" ? (
                      <div className="field">
                        <label htmlFor={`style-${item.rowId}`}>Цвет кнопки</label>
                        <select
                          id={`style-${item.rowId}`}
                          value={item.style}
                          onChange={(event) => setItem(item.rowId, { style: event.target.value as Style })}
                        >
                          {STYLES.map((style) => (
                            <option key={style.value} value={style.value}>
                              {style.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="field">
                        <label htmlFor={`desc-${item.rowId}`}>Пояснение</label>
                        <input
                          id={`desc-${item.rowId}`}
                          maxLength={100}
                          value={item.description}
                          onChange={(event) => setItem(item.rowId, { description: event.target.value })}
                        />
                      </div>
                    )}
                  </div>
                  {items.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setItems((current) => current.filter((entry) => entry.rowId !== item.rowId))}
                    >
                      Убрать
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="panel-option">
              <ToggleRow
                id="panelExclusive"
                checked={exclusive}
                onChange={setExclusive}
                label="Только одна роль из панели одновременно"
              />
            </div>

            <div className="field">
              <span className="field-label">Кто может пользоваться панелью (пусто — все участники)</span>
              <div className="chip-row">
                {guildRoles.map((role) => (
                  <label key={role.discordId} className="chip-check">
                    <input
                      type="checkbox"
                      checked={allowed.includes(role.discordId)}
                      onChange={(event) =>
                        setAllowed((current) =>
                          event.target.checked
                            ? [...current, role.discordId].slice(0, 25)
                            : current.filter((id) => id !== role.discordId),
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>

            {problems.length > 0 ? (
              <ul className="builder-problems muted">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: "0.75rem" }}
              disabled={pending || problems.length > 0}
              onClick={() => void create()}
            >
              {pending ? "Создание…" : "Создать и опубликовать"}
            </button>
          </>
        )}
        {message ? (
          <p className={message.ok ? "form-ok" : "form-error"} role="status" style={{ marginTop: "0.75rem" }}>
            {message.text}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="row builder-head">
          <h2 className="panel-title">Опубликованные панели</h2>
          <button type="button" className="btn btn-ghost" onClick={() => router.refresh()}>
            Обновить
          </button>
        </div>
        {panels.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Панелей пока нет.
          </p>
        ) : (
          <div className="builder-fields">
            {panels.map((panel) => (
              <div key={panel.id} className="builder-field">
                <div className="row builder-field-head">
                  <div>
                    <strong>{panel.title}</strong>
                    <span className="muted">
                      {" "}
                      · {panel.mode === "select" ? "список" : "кнопки"} · {panel.guildName} · #{panel.channelName}
                    </span>
                  </div>
                  <div className="row faq-controls">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => void act(panel.id, "republish")}
                    >
                      Обновить сообщение
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={pending}
                      onClick={() => void act(panel.id, "archive")}
                    >
                      В архив
                    </button>
                  </div>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                  {panel.labels.join(", ") || "без ролей"} · изменена {panel.updatedAt}
                </p>
                {panel.messageUrl ? (
                  <a href={panel.messageUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.9rem" }}>
                    Открыть сообщение в Discord
                  </a>
                ) : (
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    Сообщение ещё не опубликовано. Если оно не появляется, проверьте, что бот запущен и видит
                    канал.
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
