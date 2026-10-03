"use client";

import { useMemo, useState } from "react";
import type { EmbedSpec } from "@mirror/core/embeds";
import { isButtonPanelSpec, stripButtonComponents } from "@mirror/core/embeds";
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

const EMPTY_V1: EmbedSpec = {
  version: 1,
  embeds: [{ type: "embed", title: "", description: "", color: 0xff6a1a }],
};

const EMPTY_V2: EmbedSpec = {
  version: 2,
  components: [
    {
      type: "container",
      accentColor: 0xff6a1a,
      components: [{ type: "text_display", content: "Текст контейнера" }],
    },
  ],
};

function asSpec(raw: unknown): EmbedSpec {
  if (!raw || typeof raw !== "object" || !("version" in raw)) {
    return structuredClone(EMPTY_V1);
  }
  const version = (raw as { version?: unknown }).version;
  if (version === 1 || version === 2) {
    try {
      return stripButtonComponents(raw as EmbedSpec);
    } catch {
      return version === 2 ? structuredClone(EMPTY_V2) : structuredClone(EMPTY_V1);
    }
  }
  return structuredClone(EMPTY_V1);
}

function asDesign(raw: unknown): Design | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as {
    id?: string;
    name?: string;
    description?: string | null;
    spec?: unknown;
    updatedAt?: unknown;
  };
  if (!value.id || !value.name || value.spec === undefined) return null;
  let updatedAt = new Date().toISOString();
  if (typeof value.updatedAt === "string") updatedAt = value.updatedAt;
  else if (
    value.updatedAt &&
    typeof value.updatedAt === "object" &&
    "toISOString" in value.updatedAt &&
    typeof (value.updatedAt as { toISOString: unknown }).toISOString === "function"
  ) {
    updatedAt = (value.updatedAt as Date).toISOString();
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description ?? null,
    spec: asSpec(value.spec),
    updatedAt,
  };
}

export function EmbedManager({
  initialDesigns,
  initialSent,
  guilds,
  channels,
}: {
  initialDesigns: Design[];
  initialSent: Sent[];
  guilds: Guild[];
  channels: ChannelOption[];
}) {
  const [designs, setDesigns] = useState(initialDesigns);
  const [sent, setSent] = useState(initialSent);
  const [selectedId, setSelectedId] = useState<string | null>(initialDesigns[0]?.id ?? null);
  const [name, setName] = useState(initialDesigns[0]?.name ?? "Новый шаблон");
  const [description, setDescription] = useState(initialDesigns[0]?.description ?? "");
  const [spec, setSpec] = useState<EmbedSpec>(
    initialDesigns[0] ? asSpec(initialDesigns[0].spec) : EMPTY_V1,
  );
  const [guildId, setGuildId] = useState(guilds[0]?.discordId ?? "");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = useMemo(
    () => designs.find((d) => d.id === selectedId) ?? null,
    [designs, selectedId],
  );

  function loadDesign(d: Design) {
    setSelectedId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSpec(asSpec(d.spec));
    setMessage(null);
  }

  function newDesign(version: 1 | 2) {
    setSelectedId(null);
    setName("Новый шаблон");
    setDescription("");
    setSpec(version === 1 ? structuredClone(EMPTY_V1) : structuredClone(EMPTY_V2));
    setMessage(null);
  }

  async function save() {
    setPending(true);
    setMessage(null);
    const cleanSpec = stripButtonComponents(spec);
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
            spec: cleanSpec,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
        const design = asDesign(data.design);
        if (!design) throw new Error("Сервер вернул некорректный шаблон");
        setDesigns((prev) => prev.map((d) => (d.id === selectedId ? design : d)));
        setSpec(design.spec);
        setMessage("Сохранено");
      } else {
        const res = await fetch("/api/settings/embeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description || undefined, spec: cleanSpec }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка создания");
        const design = asDesign(data.design);
        if (!design) throw new Error("Сервер вернул некорректный шаблон");
        setDesigns((prev) => [design, ...prev]);
        setSelectedId(design.id);
        setSpec(design.spec);
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
      newDesign(1);
      setMessage("В архиве");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (!selectedId) {
      setMessage("Сначала сохраните шаблон");
      return;
    }
    if (!guildId || !channelId) {
      setMessage("Выберите сервер и канал");
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
            .filter((d) => !isButtonPanelSpec(d.spec))
            .map((d) => d.id),
        );
        setSent(
          (body.sent as (Sent & { designId?: string | null })[]).filter((s) =>
            Boolean(s.designId && designIds.has(s.designId)),
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

  function updateClassic(patch: {
    title?: string;
    description?: string;
    color?: number;
    footerText?: string | null;
  }) {
    if (spec.version !== 1) return;
    const current = spec.embeds[0]!;
    const { footer: _prevFooter, ...rest } = current;
    const embed: (typeof spec.embeds)[number] = {
      ...rest,
      type: "embed",
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    if (patch.footerText !== undefined) {
      if (patch.footerText) embed.footer = { text: patch.footerText };
    } else if (_prevFooter) {
      embed.footer = _prevFooter;
    }
    setSpec({ version: 1, embeds: [embed, ...spec.embeds.slice(1)] });
  }

  function setVersion(version: 1 | 2) {
    setSpec(version === 1 ? structuredClone(EMPTY_V1) : structuredClone(EMPTY_V2));
  }

  const classic = spec.version === 1 ? (spec.embeds[0] ?? null) : null;
  const colorHex = `#${(classic?.color ?? 0xff6a1a).toString(16).padStart(6, "0")}`;

  return (
    <div className="embed-manager">
      <div className="embed-manager-sidebar panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 className="panel-title" style={{ margin: 0 }}>
            Шаблоны
          </h2>
          <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={() => newDesign(1)}>
              + Classic
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => newDesign(2)}>
              + V2
            </button>
          </div>
        </div>
        {designs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет шаблонов.
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
                    {asSpec(d.spec).version === 2 ? "V2" : "Classic"}
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
            Редактор {selected ? `«${selected.name}»` : "(новый)"}
          </h2>
          <div className="field">
            <label htmlFor="designName">Название</label>
            <input id="designName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="designDesc">Описание</label>
            <input
              id="designDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="designVer">Формат</label>
            <select
              id="designVer"
              value={spec.version}
              onChange={(e) => setVersion(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>Classic embeds</option>
              <option value={2}>Components V2</option>
            </select>
          </div>

          {classic ? (
            <>
              <div className="field">
                <label htmlFor="embTitle">Заголовок</label>
                <input
                  id="embTitle"
                  value={classic.title ?? ""}
                  onChange={(e) => updateClassic({ title: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="embDesc">Описание</label>
                <textarea
                  id="embDesc"
                  rows={5}
                  value={classic.description ?? ""}
                  onChange={(e) => updateClassic({ description: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="embColor">Цвет</label>
                <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                  <input
                    id="embColorPicker"
                    type="color"
                    value={colorHex}
                    onChange={(e) => {
                      const hex = e.target.value.replace("#", "");
                      updateClassic({ color: Number.parseInt(hex, 16) });
                    }}
                    style={{ width: "3rem", padding: "0.2rem", cursor: "pointer" }}
                  />
                  <input
                    id="embColor"
                    value={colorHex}
                    onChange={(e) => {
                      const hex = e.target.value.replace("#", "");
                      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                        updateClassic({ color: Number.parseInt(hex, 16) });
                      }
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="embFooter">Подвал</label>
                <input
                  id="embFooter"
                  value={classic.footer?.text ?? ""}
                  onChange={(e) => updateClassic({ footerText: e.target.value || null })}
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="v2text">Текст контейнера</label>
              <textarea
                id="v2text"
                rows={6}
                value={
                  spec.version === 2 && spec.components[0]?.components[0]?.type === "text_display"
                    ? spec.components[0].components[0].content
                    : ""
                }
                onChange={(e) => {
                  if (spec.version !== 2) return;
                  const container = {
                    ...spec.components[0]!,
                    components: [{ type: "text_display" as const, content: e.target.value }],
                  };
                  setSpec({ version: 2, components: [container] });
                }}
              />
            </div>
          )}

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
            <label htmlFor="sendGuild">Сервер</label>
            <select
              id="sendGuild"
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
            <label htmlFor="sendChannel">Канал</label>
            <ChannelSelect
              id="sendChannel"
              value={channelId}
              onChange={setChannelId}
              channels={channels}
              guildDiscordId={guildId}
              emptyLabel="Выберите канал"
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void send()}>
            Отправить ботом
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
                    <th>Шаблон</th>
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
