"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { LinkActions } from "./copy-button";

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

export function TokenReceivePublish({
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
  const [messageText, setMessageText] = useState("");
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
          action: "publish-token-receive",
          guildDiscordId: guildId,
          channelDiscordId: channelId,
          messageText: messageText.trim() || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка публикации");
      setOpen(false);
      setMessage(
        "Кнопка получения нашивки поставлена в очередь. Обновите страницу через несколько секунд — появится ссылка на сообщение Discord.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка публикации");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack u-gap3">
      <div className="row u-between u-wrap u-gap2">
        <div>
          <h3 className="u-m0 u-mb1 u-text-md">Кнопка для игроков</h3>
          <p className="muted u-m0 u-text-sm">
            Игроки могут получить нашивку через slash-команду или через кнопку в Discord.
            Опубликуйте кнопку в нужный канал.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Скрыть" : "Опубликовать кнопку получения нашивки"}
        </button>
      </div>

      {link ? (
        <div className="row u-gap2 u-text-sm">
          <span className="muted">Сообщение с кнопкой</span>
          <LinkActions href={link} />
        </div>
      ) : (
        <p className="muted u-m0 u-text-sm">
          Кнопка ещё не опубликована — игроки по-прежнему могут использовать{" "}
          <code>/нашивка получить</code>.
        </p>
      )}

      {open ? (
        <div className="stack u-gap2">
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
                id="token-receive-channel"
                value={channelId}
                onChange={setChannelId}
                channels={channels}
                guildDiscordId={guildId}
                emptyLabel="Выберите канал"
              />
            </label>
          </div>
          <label className="field">
            <span>Текст сообщения (необязательно)</span>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Нажмите кнопку ниже, чтобы получить номер нашивки по статику."
            />
          </label>
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
    </div>
  );
}
