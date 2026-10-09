"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { LinkActions } from "./copy-button";

type OpenMessage = {
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
} | null;

const DEFAULT_TEXT = "Для вызова адвоката нажмите кнопку ниже.";

/** «Вызвать адвоката»: the message with the button, into a channel of the ЧП server. */
export function LawyerCallPublish({
  channels,
  incidentGuildId,
  initialOpenMessage,
}: {
  channels: ChannelOption[];
  incidentGuildId: string | null;
  initialOpenMessage: OpenMessage;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState(initialOpenMessage?.channelDiscordId || "");
  const [messageText, setMessageText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const link = initialOpenMessage
    ? `https://discord.com/channels/${initialOpenMessage.guildDiscordId}/${initialOpenMessage.channelDiscordId}/${initialOpenMessage.messageDiscordId}`
    : null;

  async function publish() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/stage4", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish-lawyer-call",
          channelDiscordId: channelId,
          messageText: messageText.trim() || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка публикации");
      setOpen(false);
      setMessage("Кнопка поставлена в очередь. Обновите страницу через несколько секунд — появится ссылка на сообщение.");
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
          <h3 className="u-m0 u-mb1 u-text-md">Кнопка «Вызвать адвоката»</h3>
          <p className="muted u-m0 u-text-sm">
            Нажавший выбирает место в окне — дальше всё как у <code>/вызов-адвоката</code>: вызов появляется в том же
            канале. Повторная публикация в тот же канал обновляет прежнее сообщение.
          </p>
        </div>
        <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => setOpen((v) => !v)}>
          {open ? "Скрыть" : "Опубликовать кнопку"}
        </button>
      </div>

      {link ? (
        <div className="row u-gap2 u-text-sm">
          <span className="muted">Сообщение с кнопкой</span>
          <LinkActions href={link} />
        </div>
      ) : (
        <p className="muted u-m0 u-text-sm">Кнопка ещё не опубликована.</p>
      )}

      {open ? (
        <div className="stack u-gap2">
          <label className="field">
            <span>Канал сервера ЧП</span>
            <ChannelSelect
              id="lawyer-call-channel"
              value={channelId}
              onChange={setChannelId}
              channels={channels}
              guildDiscordId={incidentGuildId}
              emptyLabel={incidentGuildId ? "Выберите канал" : "Сначала задайте сервер ЧП"}
            />
          </label>
          <label className="field">
            <span>Текст над кнопкой (необязательно)</span>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={DEFAULT_TEXT}
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={pending || !channelId}
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
