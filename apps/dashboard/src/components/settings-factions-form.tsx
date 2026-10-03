"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { RoleSelect, type RoleSelectOption } from "./role-select";

type FactionRow = {
  code: string;
  name: string;
  color: string | null;
  guildDiscordId: string | null;
  guildName: string | null;
  settings: {
    documentsChannelId?: string;
    personnelChannelId?: string;
    documentsWebhookUrl?: string;
    personnelWebhookUrl?: string;
    seniorRoleId?: string;
  };
};

type Guild = { discordId: string; name: string };

function parseSettings(raw: unknown): FactionRow["settings"] {
  if (!raw || typeof raw !== "object") return {};
  return raw as FactionRow["settings"];
}

export function SettingsFactionsForm({
  initialFactions,
  guilds,
  channels,
  roles,
}: {
  initialFactions: Array<Omit<FactionRow, "settings"> & { settings: unknown }>;
  guilds: Guild[];
  channels: ChannelOption[];
  roles: RoleSelectOption[];
}) {
  const [rows, setRows] = useState<FactionRow[]>(
    initialFactions.map((f) => ({
      ...f,
      settings: parseSettings(f.settings),
    })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(code: string) {
    const row = rows.find((r) => r.code === code);
    if (!row) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/factions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factionCode: row.code,
          guildDiscordId: row.guildDiscordId,
          documentsChannelId: row.settings.documentsChannelId ?? null,
          personnelChannelId: row.settings.personnelChannelId ?? null,
          documentsWebhookUrl: row.settings.documentsWebhookUrl ?? null,
          personnelWebhookUrl: row.settings.personnelWebhookUrl ?? null,
          seniorRoleId: row.settings.seniorRoleId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setRows((prev) =>
        prev.map((r) =>
          r.code === code
            ? {
                ...r,
                settings: parseSettings(data.settings),
                guildDiscordId: data.guildDiscordId,
              }
            : r,
        ),
      );
      setMessage(`${code}: сохранено`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  function patchRow(
    code: string,
    next: {
      guildDiscordId?: string | null;
      clearChannels?: boolean;
      documentsChannelId?: string | null;
      personnelChannelId?: string | null;
      documentsWebhookUrl?: string | null;
      personnelWebhookUrl?: string | null;
      seniorRoleId?: string | null;
    },
  ) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.code !== code) return r;
        const settings = { ...r.settings };
        if (next.clearChannels) {
          delete settings.documentsChannelId;
          delete settings.personnelChannelId;
          delete settings.seniorRoleId;
        }
        if (next.documentsChannelId !== undefined) {
          if (next.documentsChannelId) settings.documentsChannelId = next.documentsChannelId;
          else delete settings.documentsChannelId;
        }
        if (next.personnelChannelId !== undefined) {
          if (next.personnelChannelId) settings.personnelChannelId = next.personnelChannelId;
          else delete settings.personnelChannelId;
        }
        if (next.documentsWebhookUrl !== undefined) {
          if (next.documentsWebhookUrl) settings.documentsWebhookUrl = next.documentsWebhookUrl;
          else delete settings.documentsWebhookUrl;
        }
        if (next.personnelWebhookUrl !== undefined) {
          if (next.personnelWebhookUrl) settings.personnelWebhookUrl = next.personnelWebhookUrl;
          else delete settings.personnelWebhookUrl;
        }
        if (next.seniorRoleId !== undefined) {
          if (next.seniorRoleId) settings.seniorRoleId = next.seniorRoleId;
          else delete settings.seniorRoleId;
        }
        return {
          ...r,
          ...(next.guildDiscordId !== undefined ? { guildDiscordId: next.guildDiscordId } : {}),
          settings,
        };
      }),
    );
  }

  return (
    <div className="stack">
      {rows.map((row) => (
        <div key={row.code} className="panel">
          <h2 className="panel-title" style={{ marginTop: 0 }}>
            <span
              className="faction-swatch"
              style={{ background: row.color ?? "var(--ink-soft)" }}
              aria-hidden
            />
            {row.code} — {row.name}
          </h2>
          <div className="field">
            <label htmlFor={`guild-${row.code}`}>Сервер фракции</label>
            <select
              id={`guild-${row.code}`}
              value={row.guildDiscordId ?? ""}
              onChange={(e) =>
                patchRow(row.code, {
                  guildDiscordId: e.target.value || null,
                  clearChannels: true,
                })
              }
            >
              <option value="">Не привязан</option>
              {guilds.map((g) => (
                <option key={g.discordId} value={g.discordId}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`senior-${row.code}`}>Старший состав (пинг)</label>
            <RoleSelect
              id={`senior-${row.code}`}
              value={row.settings.seniorRoleId ?? ""}
              onChange={(v) => patchRow(row.code, { seniorRoleId: v || null })}
              roles={roles}
              guildDiscordId={row.guildDiscordId}
              emptyLabel={
                row.guildDiscordId ? "Не выбрана" : "Сначала привяжите сервер фракции"
              }
            />
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              Роль из снимка Discord на сервере фракции. Упоминается при отправке документов
              (<code>/пост</code>) и при уведомлении фракции о штрафе.
            </p>
          </div>
          <div className="field">
            <label htmlFor={`doc-ch-${row.code}`}>Канал документов</label>
            <ChannelSelect
              id={`doc-ch-${row.code}`}
              value={row.settings.documentsChannelId ?? ""}
              onChange={(v) => patchRow(row.code, { documentsChannelId: v || null })}
              channels={channels}
              guildDiscordId={row.guildDiscordId}
            />
          </div>
          <div className="field">
            <label htmlFor={`doc-wh-${row.code}`}>Вебхук документов (опционально)</label>
            <input
              id={`doc-wh-${row.code}`}
              value={row.settings.documentsWebhookUrl ?? ""}
              onChange={(e) =>
                patchRow(row.code, { documentsWebhookUrl: e.target.value || null })
              }
              placeholder="https://discord.com/api/webhooks/…"
            />
          </div>
          <div className="field">
            <label htmlFor={`per-ch-${row.code}`}>Канал кадрового аудита</label>
            <ChannelSelect
              id={`per-ch-${row.code}`}
              value={row.settings.personnelChannelId ?? ""}
              onChange={(v) => patchRow(row.code, { personnelChannelId: v || null })}
              channels={channels}
              guildDiscordId={row.guildDiscordId}
            />
          </div>
          <div className="field">
            <label htmlFor={`per-wh-${row.code}`}>Вебхук кадров (опционально)</label>
            <input
              id={`per-wh-${row.code}`}
              value={row.settings.personnelWebhookUrl ?? ""}
              onChange={(e) =>
                patchRow(row.code, { personnelWebhookUrl: e.target.value || null })
              }
              placeholder="https://discord.com/api/webhooks/…"
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => void save(row.code)}
          >
            Сохранить {row.code}
          </button>
        </div>
      ))}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
