"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";

type FormRow = {
  id: string;
  name: string;
  status?: "ACTIVE" | "CLOSED" | "ARCHIVED" | string;
  webhookUrl?: string | null;
  deliveryChannelId?: string | null;
  openGuildDiscordId?: string | null;
  openChannelDiscordId?: string | null;
  openMessageDiscordId?: string | null;
  slug?: string | null;
  publicEnabled?: boolean;
  /** False when the form has choice / checkbox fields that a Discord modal cannot show. */
  discordCompatible: boolean;
  fields: Array<{ key: string; label: string }>;
  _count: { submissions: number };
};

type GuildOption = { discordId: string; name: string };

function formMessageUrl(form: FormRow): string | null {
  if (!form.openGuildDiscordId || !form.openChannelDiscordId || !form.openMessageDiscordId) {
    return null;
  }
  return `https://discord.com/channels/${form.openGuildDiscordId}/${form.openChannelDiscordId}/${form.openMessageDiscordId}`;
}

export function DiscordFormsManager({
  initialForms,
  channels,
  guilds,
  publicBaseUrl,
}: {
  initialForms: FormRow[];
  channels: ChannelOption[];
  guilds: GuildOption[];
  publicBaseUrl: string | null;
}) {
  const router = useRouter();
  const [forms, setForms] = useState(initialForms);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publishFormId, setPublishFormId] = useState<string | null>(null);
  const [publishGuildId, setPublishGuildId] = useState(guilds[0]?.discordId ?? "");
  const [publishChannelId, setPublishChannelId] = useState("");
  const [origin, setOrigin] = useState(publicBaseUrl ?? "");

  useEffect(() => {
    setForms(initialForms);
  }, [initialForms]);

  // Without a configured public address, links use the address the admin is browsing from.
  useEffect(() => {
    if (!publicBaseUrl) setOrigin(window.location.origin);
  }, [publicBaseUrl]);

  async function publishFormOpen(formId: string) {
    if (!publishGuildId || !publishChannelId) {
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
          action: "publish-form-open",
          formId,
          guildDiscordId: publishGuildId,
          channelDiscordId: publishChannelId,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка публикации");
      setPublishFormId(null);
      setMessage(
        "Кнопка формы поставлена в очередь. Обновите список через несколько секунд — появится ссылка на сообщение Discord.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка публикации");
    } finally {
      setPending(false);
    }
  }

  async function setFormLifecycle(
    formId: string,
    action: "disable-form" | "enable-form" | "archive-form",
  ) {
    if (action === "archive-form") {
      const ok = window.confirm(
        "Убрать форму в архив? Кнопка в Discord и публичная страница перестанут работать. Ответы сохранятся.",
      );
      if (!ok) return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/stage4", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, formId }),
      });
      const body = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка изменения формы");
      if (action === "archive-form") {
        setForms((prev) => prev.filter((f) => f.id !== formId));
        setMessage("Форма убрана в архив.");
      } else if (action === "disable-form") {
        setForms((prev) =>
          prev.map((f) => (f.id === formId ? { ...f, status: "CLOSED" } : f)),
        );
        setMessage("Форма отключена — ответы не принимаются ни в Discord, ни на сайте.");
      } else {
        setForms((prev) =>
          prev.map((f) => (f.id === formId ? { ...f, status: "ACTIVE" } : f)),
        );
        setMessage("Форма снова включена.");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка изменения формы");
    } finally {
      setPending(false);
    }
  }

  function openPublish(form: FormRow) {
    setPublishFormId(form.id);
    setPublishGuildId(form.openGuildDiscordId || guilds[0]?.discordId || "");
    setPublishChannelId(form.openChannelDiscordId || "");
    setMessage(null);
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 className="panel-title" style={{ marginTop: 0, marginBottom: 0 }}>
          Формы
        </h2>
        <div className="row">
          <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>
            Обновить
          </button>
          <Link href="/settings/forms/new" className="btn btn-primary">
            Новая форма
          </Link>
        </div>
      </div>
      {message ? (
        <p className="muted" role="status" style={{ margin: 0 }}>
          {message}
        </p>
      ) : null}
      {forms.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Форм пока нет. Создайте первую кнопкой «Новая форма».
        </p>
      ) : (
        <div className="stack" style={{ gap: "0.85rem" }}>
          {forms.map((form) => {
            const link = formMessageUrl(form);
            const publishing = publishFormId === form.id;
            const disabled = form.status === "CLOSED";
            const publicUrl = form.publicEnabled && form.slug && origin ? `${origin}/f/${form.slug}` : null;
            return (
              <div key={form.id} className="builder-field">
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div>
                    <strong>{form.name}</strong>
                    {disabled ? (
                      <span className="stub-badge" style={{ marginLeft: "0.4rem" }}>
                        Отключена
                      </span>
                    ) : null}
                    <span className="muted">
                      {" "}
                      · полей: {form.fields.length} · ответов: {form._count.submissions}
                    </span>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
                    <Link href={`/settings/forms/${form.id}`} className="btn btn-secondary">
                      Изменить
                    </Link>
                    <Link href={`/settings/forms/${form.id}/responses`} className="btn btn-secondary">
                      Ответы
                    </Link>
                    {!disabled ? (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={pending}
                        onClick={() => (publishing ? setPublishFormId(null) : openPublish(form))}
                      >
                        {publishing ? "Скрыть" : "Кнопка в Discord"}
                      </button>
                    ) : null}
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={pending}
                      onClick={() => void setFormLifecycle(form.id, disabled ? "enable-form" : "disable-form")}
                    >
                      {disabled ? "Включить" : "Отключить"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={pending}
                      onClick={() => void setFormLifecycle(form.id, "archive-form")}
                    >
                      В архив
                    </button>
                  </div>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                  Доставка:{" "}
                  {[form.deliveryChannelId ? "канал" : null, form.webhookUrl ? "webhook" : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                  {form.discordCompatible ? "" : " · есть поля выбора: заполняется только на сайте"}
                </p>
                {publicUrl ? (
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    Публичная страница:{" "}
                    <a href={publicUrl} target="_blank" rel="noreferrer">
                      {publicUrl}
                    </a>
                  </p>
                ) : null}
                {link ? (
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    Сообщение с кнопкой:{" "}
                    <a href={link} target="_blank" rel="noreferrer">
                      {link}
                    </a>
                  </p>
                ) : !disabled && !publicUrl ? (
                  <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                    Форму пока негде заполнить: опубликуйте кнопку в Discord или включите публичную страницу.
                  </p>
                ) : null}
                {publishing && !disabled ? (
                  <div className="stack" style={{ gap: "0.5rem" }}>
                    {!form.discordCompatible ? (
                      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                        В Discord эта форма не открывается окном: кнопка пришлёт ссылку на публичную страницу.
                        Для этого включите страницу и укажите публичный адрес сайта ниже.
                      </p>
                    ) : null}
                    <div className="form-grid-3">
                      <label className="field">
                        <span>Сервер</span>
                        <select
                          value={publishGuildId}
                          onChange={(e) => {
                            setPublishGuildId(e.target.value);
                            setPublishChannelId("");
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
                          id={`form-open-channel-${form.id}`}
                          value={publishChannelId}
                          onChange={setPublishChannelId}
                          channels={channels}
                          guildDiscordId={publishGuildId}
                          emptyLabel="Выберите канал"
                        />
                      </label>
                    </div>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={pending || !publishGuildId || !publishChannelId}
                      onClick={() => void publishFormOpen(form.id)}
                    >
                      {pending ? "Публикация…" : "Опубликовать в канал"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
