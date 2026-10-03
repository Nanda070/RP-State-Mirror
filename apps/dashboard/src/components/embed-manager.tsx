"use client";

import { useMemo, useState } from "react";
import type { EmbedSpec } from "@mirror/core/embeds";
import { BUILT_IN_VARIABLES, extractVariables } from "@mirror/core/embeds";
import { MessageSpecEditor, type EditorForm, type EditorRole } from "./message-spec-editor";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { LinkActions } from "./copy-button";
import { EmbedPreview } from "./embed-preview";
import { EmptyState } from "./ui";

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
    return raw as EmbedSpec;
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
  roles,
  forms,
}: {
  initialDesigns: Design[];
  initialSent: Sent[];
  guilds: Guild[];
  channels: ChannelOption[];
  roles: EditorRole[];
  forms: EditorForm[];
}) {
  const [variables, setVariables] = useState<Record<string, string>>({});
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
    const cleanSpec = spec;
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
          variables: Object.fromEntries(customVariables.map((name) => [name, variables[name] ?? ""])),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка отправки");
      setMessage("Отправка поставлена в очередь");
      const refresh = await fetch("/api/settings/embeds");
      if (refresh.ok) {
        const body = await refresh.json();
        const designIds = new Set((body.designs as Design[]).map((d) => d.id));
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
      setMessage("Переотправка поставлена в очередь");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  function setVersion(version: 1 | 2) {
    setSpec(version === 1 ? structuredClone(EMPTY_V1) : structuredClone(EMPTY_V2));
  }

  // Placeholders the admin fills in before sending; the built-in ones the bot fills itself.
  const customVariables = extractVariables(spec).filter((name) => !(BUILT_IN_VARIABLES as readonly string[]).includes(name));

  return (
    <div className="embed-manager">
      <div className="embed-manager-sidebar panel">
        <div className="row u-between u-mb3">
          <h2 className="panel-title u-m0">
            Шаблоны
          </h2>
          <div className="row u-gap1 u-wrap">
            <button type="button" className="btn btn-secondary" onClick={() => newDesign(1)}>
              + Classic
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => newDesign(2)}>
              + V2
            </button>
          </div>
        </div>
        {designs.length === 0 ? (
          <p className="muted u-m0">
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

      <div className="embed-main">
        <div className="panel">
          <h2 className="panel-title">
            Редактор {selected ? `«${selected.name}»` : "(новый)"}
          </h2>
          <div className="field">
            <label htmlFor="designName">Название</label>
            <input id="designName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="designDesc">Заметка для себя</label>
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
              <option value={1}>Классические эмбеды</option>
              <option value={2}>Components V2</option>
            </select>
          </div>

          <MessageSpecEditor spec={spec} onChange={setSpec} roles={roles} forms={forms} />

          <div className="row u-mt4 u-wrap u-gap2">
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
          <h2 className="panel-title u-mt0">
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
          {customVariables.map((name) => (
            <div key={name} className="field">
              <label htmlFor={`var-${name}`}>
                Переменная <code>{`{${name}}`}</code>
              </label>
              <input
                id={`var-${name}`}
                maxLength={1000}
                value={variables[name] ?? ""}
                onChange={(e) => setVariables((prev) => ({ ...prev, [name]: e.target.value }))}
              />
            </div>
          ))}
          <p className="field-hint">
            В тексте можно писать <code>{"{server}"}</code>, <code>{"{channel}"}</code>, <code>{"{date}"}</code>,{" "}
            <code>{"{time}"}</code> — бот подставит их сам. Любое другое имя в фигурных скобках станет полем выше.
          </p>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void send()}>
            Отправить ботом
          </button>
        </div>

        <div className="panel embed-preview-col">
          <EmbedPreview spec={spec} />
        </div>

        {message ? (
          <p className="form-ok" role="status">
            {message}
          </p>
        ) : null}

        <div className="panel">
          <h2 className="panel-title u-mt0">
            Отправленные
          </h2>
          {sent.length === 0 ? (
            <EmptyState icon="inbox" title="Отправок пока нет" />
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
                      <td>#{channels.find((channel) => channel.discordId === s.channelDiscordId)?.name ?? "канал удалён"}</td>
                      <td>
                        <LinkActions href={`https://discord.com/channels/${s.guildDiscordId}/${s.channelDiscordId}/${s.messageDiscordId}`} />
                      </td>
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
