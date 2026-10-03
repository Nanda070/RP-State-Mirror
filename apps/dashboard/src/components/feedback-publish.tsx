"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";

type GuildOption = { discordId: string; name: string };

type OpenMessage = {
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
} | null;

function messageUrl(open: OpenMessage): string | null {
  if (!open) return null;
  return `https://discord.com/channels/${open.guildDiscordId}/${open.channelDiscordId}/${open.messageDiscordId}`;
}

export function FeedbackPublish({
  guilds,
  channels,
  initialOpenMessage,
}: {
  guilds: GuildOption[];
  channels: ChannelOption[];
  initialOpenMessage: OpenMessage;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guildId, setGuildId] = useState(
    initialOpenMessage?.guildDiscordId || guilds[0]?.discordId || "",
  );
  const [channelId, setChannelId] = useState(initialOpenMessage?.channelDiscordId || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const link = messageUrl(initialOpenMessage);

  async function publish() {
    if (!guildId || !channelId) {
      setMessage("Выберите сервер и канал для публикации кнопки.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/stage4", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish-feedback-open",
          guildDiscordId: guildId,
          channelDiscordId: channelId,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка публикации");
      setOpen(false);
      setMessage(
        "Кнопка обратной связи поставлена в очередь. Обновите страницу через несколько секунд — появится ссылка на сообщение Discord.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка публикации");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h2 className="panel-title" style={{ marginTop: 0, marginBottom: "0.25rem" }}>
            Кнопка для игроков
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            Игроки пишут обращения только через кнопку в Discord. Опубликуйте её в нужный канал.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Скрыть" : "Опубликовать кнопку обратной связи"}
        </button>
      </div>

      {link ? (
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          Ссылка на сообщение:{" "}
          <a href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          Кнопка ещё не опубликована — без неё игроки не смогут открыть форму обращения.
        </p>
      )}

      {open ? (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <div className="form-grid-3">
            <label className="field">
              <span>Сервер</span>
              <select
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
            </label>
            <label className="field">
              <span>Канал</span>
              <ChannelSelect
                id="feedback-open-channel"
                value={channelId}
                onChange={setChannelId}
                channels={channels}
                guildDiscordId={guildId}
                emptyLabel="Выберите канал"
              />
            </label>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={pending || !guildId || !channelId}
            onClick={() => void publish()}
          >
            {pending ? "Публикация…" : "Опубликовать в канал"}
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
