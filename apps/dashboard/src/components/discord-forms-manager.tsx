"use client";

import { confirmDialog } from "@/lib/confirm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import type { MouseEvent } from "react";
import { LinkActions } from "./copy-button";
import { EmptyState, MoreMenu } from "./ui";

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
  /** `PUBLIC_BASE_URL` from the environment. */
  publicBaseUrl: string;
}) {
  const router = useRouter();
  const [forms, setForms] = useState(initialForms);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publishFormId, setPublishFormId] = useState<string | null>(null);
  const [publishGuildId, setPublishGuildId] = useState(guilds[0]?.discordId ?? "");
  const [publishChannelId, setPublishChannelId] = useState("");

  useEffect(() => {
    setForms(initialForms);
  }, [initialForms]);

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
      const ok = await confirmDialog(
        "Убрать форму в архив? Кнопка в Discord и публичная страница перестанут работать. Ответы сохранятся.",
        { confirmLabel: "В архив" },
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
      <div className="row u-between u-wrap u-gap2">
        <h2 className="panel-title u-mt0 u-mb0">
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
        <p className="form-ok u-m0" role="status">
          {message}
        </p>
      ) : null}
      {forms.length === 0 ? (
        <EmptyState
          icon="form"
          title="Форм пока нет"
          action={
            <Link href="/settings/forms/new" className="btn btn-primary">
              Новая форма
            </Link>
          }
        />
      ) : (
        <div className="form-list">
          {forms.map((form) => {
            const link = formMessageUrl(form);
            const publishing = publishFormId === form.id;
            const disabled = form.status === "CLOSED";
            const publicUrl = form.publicEnabled && form.slug ? `${publicBaseUrl}/f/${form.slug}` : null;
            const closeMenu = (event: MouseEvent<HTMLElement>) => event.currentTarget.closest("details")?.removeAttribute("open");
            return (
              <div key={form.id} className="form-item" data-off={disabled ? "" : undefined}>
                <div className="form-item-head">
                  <div className="form-item-title">
                    <strong>{form.name}</strong>
                    <span className="registry-status" data-status={disabled ? "muted" : "ok"}>
                      {disabled ? "Отключена" : "Активна"}
                    </span>
                  </div>
                  <div className="row u-gap2">
                    <Link href={`/settings/forms/${form.id}`} className="btn btn-secondary">
                      Изменить
                    </Link>
                    <Link href={`/settings/forms/${form.id}/responses`} className="btn btn-secondary">
                      Ответы
                    </Link>
                    <MoreMenu label={`Действия: ${form.name}`}>
                      {!disabled ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={(event) => {
                            closeMenu(event);
                            if (publishing) setPublishFormId(null);
                            else openPublish(form);
                          }}
                        >
                          {publishing ? "Скрыть публикацию" : "Кнопка в Discord"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={(event) => {
                          closeMenu(event);
                          void setFormLifecycle(form.id, disabled ? "enable-form" : "disable-form");
                        }}
                      >
                        {disabled ? "Включить" : "Отключить"}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={pending}
                        onClick={(event) => {
                          closeMenu(event);
                          void setFormLifecycle(form.id, "archive-form");
                        }}
                      >
                        В архив
                      </button>
                    </MoreMenu>
                  </div>
                </div>
                <dl className="form-item-facts">
                  <div>
                    <dt>Полей</dt>
                    <dd>{form.fields.length}</dd>
                  </div>
                  <div>
                    <dt>Ответов</dt>
                    <dd>{form._count.submissions}</dd>
                  </div>
                  <div>
                    <dt>Доставка</dt>
                    <dd>
                      {[form.deliveryChannelId ? "канал" : null, form.webhookUrl ? "вебхук" : null].filter(Boolean).join(" · ") ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Заполнение</dt>
                    <dd>{form.discordCompatible ? "Discord и сайт" : "только сайт"}</dd>
                  </div>
                </dl>
                {publicUrl || link ? (
                  <div className="form-item-links">
                    {publicUrl ? (
                      <span>
                        <span className="muted">Страница</span>
                        <LinkActions href={publicUrl} />
                      </span>
                    ) : null}
                    {link ? (
                      <span>
                        <span className="muted">Кнопка в Discord</span>
                        <LinkActions href={link} />
                      </span>
                    ) : null}
                  </div>
                ) : !disabled ? (
                  <p className="muted u-m0 u-text-sm">Форму пока негде заполнить</p>
                ) : null}
                {publishing && !disabled ? (
                  <div className="stack u-gap2">
                    {!form.discordCompatible && !publicUrl ? (
                      <p className="form-error u-m0">Сначала включите публичную страницу: кнопка даст ссылку на неё.</p>
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
