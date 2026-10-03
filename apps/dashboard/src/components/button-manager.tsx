"use client";

import { useMemo, useState } from "react";
import type { EmbedSpec, EmbedSpecV1, V2Button } from "@mirror/core/embeds";
import { isButtonPanelSpec } from "@mirror/core/embeds";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { EmbedPreview } from "./embed-preview";

type Design = {
  id: string;
  name: string;
  description: string | null;
  spec: EmbedSpec;
  updatedAt: string;
};

type Sent = {
  id: string;
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
  design: { id: string; name: string } | null;
  createdAt: string;
};

type Guild = { discordId: string; name: string };
type Role = { discordId: string; name: string; guildDiscordId: string };

type ButtonStyle = NonNullable<V2Button["style"]>;

const EMPTY_PANEL: EmbedSpecV1 = {
  version: 1,
  embeds: [
    {
      type: "embed",
      title: "Панель ролей",
      description: "Нажмите кнопку, чтобы получить или снять роль.",
      color: 0xff6a1a,
    },
  ],
  components: [],
};

function asPanelSpec(raw: unknown): EmbedSpecV1 {
  if (raw && typeof raw === "object" && "version" in raw) {
    const spec = raw as EmbedSpec;
    if (spec.version === 1) {
      return {
        version: 1,
        embeds: spec.embeds.length
          ? spec.embeds
          : structuredClone(EMPTY_PANEL.embeds),
        components: spec.components ?? [],
      };
    }
  }
  return structuredClone(EMPTY_PANEL);
}

function flatButtons(spec: EmbedSpecV1): V2Button[] {
  return (spec.components ?? []).flatMap((row) => row.components);
}

export function ButtonManager({
  initialDesigns,
  initialSent,
  guilds,
  channels,
  roles,
}: {
  initialDesigns: Design[];
  initialSent: Sent[];
  guilds: Guild[];
  channels: ChannelOption[];
  roles: Role[];
}) {
  const [designs, setDesigns] = useState(initialDesigns);
  const [sent, setSent] = useState(initialSent);
  const [selectedId, setSelectedId] = useState<string | null>(initialDesigns[0]?.id ?? null);
  const [name, setName] = useState(initialDesigns[0]?.name ?? "Новая панель");
  const [description, setDescription] = useState(initialDesigns[0]?.description ?? "");
  const [spec, setSpec] = useState<EmbedSpecV1>(
    initialDesigns[0] ? asPanelSpec(initialDesigns[0].spec) : structuredClone(EMPTY_PANEL),
  );
  const [guildId, setGuildId] = useState(guilds[0]?.discordId ?? "");
  const [channelId, setChannelId] = useState("");
  const [buttonStyle, setButtonStyle] = useState<ButtonStyle>("primary");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = useMemo(
    () => designs.find((d) => d.id === selectedId) ?? null,
    [designs, selectedId],
  );

  const guildRoles = roles.filter((r) => r.guildDiscordId === guildId);
  const buttons = flatButtons(spec);
  const classic = spec.embeds[0]!;

  function loadDesign(d: Design) {
    setSelectedId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSpec(asPanelSpec(d.spec));
    setMessage(null);
  }

  function newPanel() {
    setSelectedId(null);
    setName("Новая панель");
    setDescription("");
    setSpec(structuredClone(EMPTY_PANEL));
    setMessage(null);
  }

  function updateClassic(patch: { title?: string; description?: string; color?: number }) {
    const embed = {
      ...classic,
      type: "embed" as const,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    setSpec({ ...spec, embeds: [embed, ...spec.embeds.slice(1)] });
  }

  function setRowsFromButtons(list: V2Button[]) {
    const rows: EmbedSpecV1["components"] = [];
    for (const btn of list) {
      let last = rows[rows.length - 1];
      if (!last || last.components.length >= 5) {
        last = { type: "action_row", components: [] };
        rows.push(last);
      }
      last.components.push(btn);
    }
    setSpec({ ...spec, components: rows });
  }

  function addRoleButton(roleDiscordId: string) {
    const role = guildRoles.find((r) => r.discordId === roleDiscordId);
    if (!role) return;
    const list = flatButtons(spec);
    if (list.length >= 25) {
      setMessage("Максимум 25 кнопок");
      return;
    }
    if (list.some((b) => b.params?.roleDiscordId === role.discordId)) {
      setMessage("Эта роль уже добавлена");
      return;
    }
    list.push({
      type: "button",
      label: role.name.slice(0, 80),
      style: buttonStyle === "link" ? "primary" : buttonStyle,
      action: "role.toggle",
      params: { roleDiscordId: role.discordId },
    });
    setRowsFromButtons(list);
    setMessage(null);
  }

  function removeButton(index: number) {
    const list = flatButtons(spec).filter((_, i) => i !== index);
    setRowsFromButtons(list);
  }

  function clearButtons() {
    setSpec({ ...spec, components: [] });
  }

  async function save() {
    setPending(true);
    setMessage(null);
    const panelSpec: EmbedSpecV1 = {
      version: 1,
      embeds: spec.embeds,
      components: spec.components ?? [],
    };
    try {
      if (selectedId) {
        const res = await fetch("/api/settings/embeds", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "update",
            id: selectedId,
            name,
            description: description || null,
            spec: panelSpec,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
        setDesigns((prev) => prev.map((d) => (d.id === selectedId ? data.design : d)));
        setSpec(asPanelSpec(data.design.spec));
        setMessage("Сохранено");
      } else {
        const res = await fetch("/api/settings/embeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description || undefined, spec: panelSpec }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка создания");
        setDesigns((prev) => [data.design, ...prev]);
        setSelectedId(data.design.id);
        setSpec(asPanelSpec(data.design.spec));
        setMessage("Создано");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!selectedId) return;
    setPending(true);
    try {
      const res = await fetch("/api/settings/embeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "archive", id: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setDesigns((prev) => prev.filter((d) => d.id !== selectedId));
      newPanel();
      setMessage("В архиве");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (!selectedId) {
      setMessage("Сначала сохраните панель");
      return;
    }
    if (!guildId || !channelId) {
      setMessage("Выберите сервер и канал");
      return;
    }
    if (flatButtons(spec).length === 0) {
      setMessage("Добавьте хотя бы одну кнопку");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/embeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "send",
          designId: selectedId,
          guildDiscordId: guildId,
          channelDiscordId: channelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка отправки");
      setMessage(`Отправка поставлена в очередь (job ${data.jobId.slice(0, 8)}…)`);
      const refresh = await fetch("/api/settings/embeds");
      if (refresh.ok) {
        const body = await refresh.json();
        const designIds = new Set(
          (body.designs as Design[])
            .filter((d) => isButtonPanelSpec(d.spec))
            .map((d) => d.id),
        );
        setSent(
          (body.sent as (Sent & { designId?: string | null; spec: EmbedSpec })[]).filter(
            (s) =>
              (s.designId && designIds.has(s.designId)) ||
              isButtonPanelSpec(s.spec),
          ),
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function resend(id: string) {
    setPending(true);
    try {
      const res = await fetch("/api/settings/embeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "resend", sentMessageId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage(`Переотправка в очереди (${data.jobId.slice(0, 8)}…)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="embed-manager">
      <div className="embed-manager-sidebar panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 className="panel-title" style={{ margin: 0 }}>
            Панели
          </h2>
          <button type="button" className="btn btn-secondary" onClick={newPanel}>
            + Панель
          </button>
        </div>
        {designs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет панелей кнопок.
          </p>
        ) : (
          <ul className="embed-design-list">
            {designs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="embed-design-item"
                  data-active={d.id === selectedId}
                  onClick={() => loadDesign(d)}
                >
                  <strong>{d.name}</strong>
                  <span className="muted">
                    {flatButtons(asPanelSpec(d.spec)).length} кн.
                    {d.description ? ` · ${d.description}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="stack" style={{ gap: "1rem" }}>
        <div className="panel">
          <h2 className="panel-title" style={{ marginTop: 0 }}>
            Редактор {selected ? `«${selected.name}»` : "(новая)"}
          </h2>
          <div className="field">
            <label htmlFor="panelName">Название</label>
            <input id="panelName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="panelDesc">Описание шаблона</label>
            <input
              id="panelDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="panelTitle">Заголовок сообщения</label>
            <input
              id="panelTitle"
              value={classic.title ?? ""}
              onChange={(e) => updateClassic({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="panelText">Текст сообщения</label>
            <textarea
              id="panelText"
              rows={3}
              value={classic.description ?? ""}
              onChange={(e) => updateClassic({ description: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="panelColor">Цвет (hex)</label>
            <input
              id="panelColor"
              value={`#${(classic.color ?? 0xff6a1a).toString(16).padStart(6, "0")}`}
              onChange={(e) => {
                const hex = e.target.value.replace("#", "");
                if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                  updateClassic({ color: Number.parseInt(hex, 16) });
                }
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="btnStyle">Стиль новых кнопок</label>
            <select
              id="btnStyle"
              value={buttonStyle}
              onChange={(e) => setButtonStyle(e.target.value as ButtonStyle)}
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
              <option value="success">success</option>
              <option value="danger">danger</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="roleBtn">Кнопка role.toggle</label>
            <div className="row" style={{ gap: "0.5rem" }}>
              <select
                id="roleBtn"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addRoleButton(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="">Добавить роль…</option>
                {guildRoles.map((r) => (
                  <option key={r.discordId} value={r.discordId}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary" onClick={clearButtons}>
                Очистить
              </button>
            </div>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              Роли с выбранного сервера отправки. При отправке пишутся в button_actions
              (custom_id: mirror:role.toggle:&lt;id&gt;).
            </p>
          </div>

          {buttons.length > 0 ? (
            <ul className="embed-design-list" style={{ marginTop: "0.75rem" }}>
              {buttons.map((btn, index) => (
                <li key={`${btn.label}-${index}`}>
                  <div className="embed-design-item" style={{ cursor: "default" }}>
                    <strong>{btn.label}</strong>
                    <span className="muted">
                      {btn.style ?? "primary"}
                      {typeof btn.params?.roleDiscordId === "string"
                        ? ` · ${btn.params.roleDiscordId}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: "0.35rem" }}
                      onClick={() => removeButton(index)}
                    >
                      Убрать
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="row" style={{ marginTop: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
              Сохранить
            </button>
            {selectedId ? (
              <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => void archive()}>
                В архив
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title" style={{ marginTop: 0 }}>
            Отправка
          </h2>
          <div className="field">
            <label htmlFor="btnSendGuild">Сервер</label>
            <select
              id="btnSendGuild"
              value={guildId}
              onChange={(e) => {
                setGuildId(e.target.value);
                setChannelId("");
              }}
            >
              {guilds.map((g) => (
                <option key={g.discordId} value={g.discordId}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="btnSendChannel">Канал</label>
            <ChannelSelect
              id="btnSendChannel"
              value={channelId}
              onChange={setChannelId}
              channels={channels}
              guildDiscordId={guildId}
              emptyLabel="Выберите канал"
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void send()}>
            Отправить панель
          </button>
        </div>

        <div className="panel">
          <EmbedPreview spec={spec} />
        </div>

        {message ? <p className="muted">{message}</p> : null}

        <div className="panel">
          <h2 className="panel-title" style={{ marginTop: 0 }}>
            Отправленные
          </h2>
          {sent.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Пока нет отправок.
            </p>
          ) : (
            <div className="registry-table-wrap">
              <table className="registry-table">
                <thead>
                  <tr>
                    <th>Панель</th>
                    <th>Канал</th>
                    <th>Сообщение</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sent.map((s) => (
                    <tr key={s.id}>
                      <td>{s.design?.name ?? "—"}</td>
                      <td className="registry-mono">{s.channelDiscordId}</td>
                      <td className="registry-mono">{s.messageDiscordId}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={pending}
                          onClick={() => void resend(s.id)}
                        >
                          Переотправить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
