"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { ToggleRow } from "./toggle-row";

type FormField = {
  /** Stable React list identity — never used as Discord field key / API payload. */
  clientId: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
};

type FormRow = {
  id: string;
  name: string;
  status?: "ACTIVE" | "CLOSED" | "ARCHIVED" | string;
  webhookUrl?: string | null;
  deliveryChannelId?: string | null;
  openGuildDiscordId?: string | null;
  openChannelDiscordId?: string | null;
  openMessageDiscordId?: string | null;
  fields: Array<{ key: string; label: string }>;
  _count: { submissions: number };
};

type GuildOption = { discordId: string; name: string };

const SNOWFLAKE_RE = /^\d{17,20}$/;

function createEmptyField(overrides?: Partial<Omit<FormField, "clientId">>): FormField {
  return {
    clientId: crypto.randomUUID(),
    key: "name",
    label: "Имя",
    type: "short",
    required: true,
    ...overrides,
  };
}

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
  initialWebhookUrl = "",
}: {
  initialForms: FormRow[];
  channels: ChannelOption[];
  guilds: GuildOption[];
  initialWebhookUrl?: string;
}) {
  const router = useRouter();
  const [forms, setForms] = useState(initialForms);
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState(initialWebhookUrl);
  const [formDeliveryChannelId, setFormDeliveryChannelId] = useState("");
  const [deliveryById, setDeliveryById] = useState(false);
  const [deliveryGuildId, setDeliveryGuildId] = useState(guilds[0]?.discordId ?? "");
  const [deliveryChannelIdManual, setDeliveryChannelIdManual] = useState("");
  const [formResponseLimit, setFormResponseLimit] = useState("");
  const [formFields, setFormFields] = useState<FormField[]>(() => [createEmptyField()]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publishFormId, setPublishFormId] = useState<string | null>(null);
  const [publishGuildId, setPublishGuildId] = useState(guilds[0]?.discordId ?? "");
  const [publishChannelId, setPublishChannelId] = useState("");

  useEffect(() => {
    setForms(initialForms);
  }, [initialForms]);

  const resolvedDeliveryChannelId = useMemo(() => {
    if (deliveryById) return deliveryChannelIdManual.trim();
    return formDeliveryChannelId.trim();
  }, [deliveryById, deliveryChannelIdManual, formDeliveryChannelId]);

  const hasDelivery = Boolean(formWebhookUrl.trim() || resolvedDeliveryChannelId);
  const deliveryChannelValid =
    !resolvedDeliveryChannelId || SNOWFLAKE_RE.test(resolvedDeliveryChannelId);
  const canCreate =
    Boolean(formName.trim()) && hasDelivery && deliveryChannelValid && !pending;

  async function createForm() {
    if (!formName.trim()) {
      setMessage("Укажите название формы.");
      return;
    }
    if (!hasDelivery) {
      setMessage("Укажите, куда отправлять ответы: канал и/или webhook URL.");
      return;
    }
    if (resolvedDeliveryChannelId && !SNOWFLAKE_RE.test(resolvedDeliveryChannelId)) {
      setMessage("ID канала должен быть snowflake Discord (17–20 цифр).");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const fieldsPayload = formFields.map(({ key, label, type, required }) => ({
        key,
        label,
        type,
        required,
      }));
      const response = await fetch("/api/settings/stage4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: {
            name: formName.trim(),
            webhookUrl: formWebhookUrl.trim() || null,
            deliveryChannelId: resolvedDeliveryChannelId || null,
            responseLimit: formResponseLimit.trim() ? Number(formResponseLimit) : null,
            fields: fieldsPayload,
          },
        }),
      });
      const body = (await response.json()) as { form?: FormRow; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка создания формы");
      if (body.form) {
        setForms((prev) => [
          {
            ...body.form!,
            status: body.form!.status ?? "ACTIVE",
            fields: fieldsPayload.map((f) => ({ key: f.key, label: f.label })),
            _count: body.form!._count ?? { submissions: 0 },
          },
          ...prev,
        ]);
      }
      setFormName("");
      setFormWebhookUrl("");
      setFormDeliveryChannelId("");
      setDeliveryChannelIdManual("");
      setDeliveryById(false);
      setFormResponseLimit("");
      setFormFields([createEmptyField()]);
      setMessage("Форма создана. Опубликуйте кнопку формы, чтобы получить ссылку на сообщение.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка создания формы");
    } finally {
      setPending(false);
    }
  }

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
        "Удалить форму? Кнопка «Открыть форму» перестанет работать. Ответы сохранятся в архиве.",
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
        setMessage("Форма удалена (архив).");
      } else if (action === "disable-form") {
        setForms((prev) =>
          prev.map((f) => (f.id === formId ? { ...f, status: "CLOSED" } : f)),
        );
        setMessage("Форма отключена — кнопка в Discord больше не открывает её.");
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

  function updateField(index: number, patch: Partial<Omit<FormField, "clientId">>) {
    setFormFields((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function openPublish(form: FormRow) {
    setPublishFormId(form.id);
    setPublishGuildId(form.openGuildDiscordId || guilds[0]?.discordId || "");
    setPublishChannelId(form.openChannelDiscordId || "");
    setMessage(null);
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="panel-title">Новая Discord-форма</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          До 5 полей на форму (лимит Discord modal). Перед созданием обязательно укажите, куда
          уходят ответы — канал и/или webhook. Чтобы игроки могли открыть форму, опубликуйте кнопку
          ниже в списке форм.
        </p>

        <label className="field">
          <span>Название формы</span>
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Например: Заявка на собеседование"
          />
        </label>

        <div className="stack" style={{ gap: "0.65rem" }}>
          <span className="field-label">Куда отправлять ответы (обязательно)</span>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            Нужен хотя бы один вариант: канал Discord или webhook URL.
          </p>
          <label className="field">
            <span>Webhook URL</span>
            <input
              value={formWebhookUrl}
              onChange={(e) => setFormWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
            />
          </label>

          {!deliveryById ? (
            <label className="field">
              <span>Канал доставки</span>
              <ChannelSelect
                id="form-delivery-channel"
                value={formDeliveryChannelId}
                onChange={setFormDeliveryChannelId}
                channels={channels}
                emptyLabel="Не выбран"
              />
            </label>
          ) : (
            <div className="form-grid-3">
              <label className="field">
                <span>Сервер</span>
                <select
                  value={deliveryGuildId}
                  onChange={(e) => setDeliveryGuildId(e.target.value)}
                >
                  {guilds.map((g) => (
                    <option key={g.discordId} value={g.discordId}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>ID канала</span>
                <input
                  value={deliveryChannelIdManual}
                  onChange={(e) => setDeliveryChannelIdManual(e.target.value.replace(/\D/g, ""))}
                  placeholder="17–20 цифр"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
            </div>
          )}

          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setDeliveryById((v) => !v);
              if (!deliveryById) {
                setFormDeliveryChannelId("");
              } else {
                setDeliveryChannelIdManual("");
              }
            }}
          >
            {deliveryById ? "Выбрать канал из списка" : "Указать ID канала"}
          </button>
        </div>

        <label className="field">
          <span>Лимит ответов</span>
          <input
            type="number"
            min={1}
            step={1}
            value={formResponseLimit}
            onChange={(e) => setFormResponseLimit(e.target.value)}
            placeholder="Без лимита"
          />
        </label>

        <div className="stack" style={{ gap: "0.65rem" }}>
          <span className="field-label">Поля формы</span>
          {formFields.map((field, index) => (
            <div className="form-field-row" key={field.clientId}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Ключ</span>
                <input
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder="name"
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Подпись</span>
                <input
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder="Имя"
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Тип</span>
                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value })}
                >
                  <option value="short">Короткий текст</option>
                  <option value="paragraph">Абзац</option>
                </select>
              </label>
              <ToggleRow
                id={`form-field-required-${field.clientId}`}
                checked={field.required}
                onChange={(checked) => updateField(index, { required: checked })}
                label="Обязательное"
              />
            </div>
          ))}
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={formFields.length >= 5}
            onClick={() =>
              setFormFields((prev) => [
                ...prev,
                createEmptyField({
                  key: `field_${prev.length + 1}`,
                  label: "Новое поле",
                  type: "short",
                  required: false,
                }),
              ])
            }
          >
            Добавить поле
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!canCreate}
            onClick={() => void createForm()}
          >
            {pending ? "Создание…" : "Создать форму"}
          </button>
        </div>
        {message ? (
          <p className="muted" role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <h2 className="panel-title" style={{ marginTop: 0, marginBottom: 0 }}>
            Существующие формы
          </h2>
          <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>
            Обновить
          </button>
        </div>
        {forms.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Форм пока нет.
          </p>
        ) : (
          <div className="stack" style={{ gap: "0.85rem" }}>
            {forms.map((form) => {
              const link = formMessageUrl(form);
              const publishing = publishFormId === form.id;
              const disabled = form.status === "CLOSED";
              return (
                <div key={form.id} className="stack" style={{ gap: "0.45rem" }}>
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
                        · {form.fields.map((f) => f.label).join(", ") || "без полей"} · ответов:{" "}
                        {form._count.submissions}
                      </span>
                    </div>
                    <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
                      {!disabled ? (
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={pending}
                          onClick={() => (publishing ? setPublishFormId(null) : openPublish(form))}
                        >
                          {publishing ? "Скрыть" : "Опубликовать кнопку формы"}
                        </button>
                      ) : null}
                      {disabled ? (
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={pending}
                          onClick={() => void setFormLifecycle(form.id, "enable-form")}
                        >
                          Включить
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={pending}
                          onClick={() => void setFormLifecycle(form.id, "disable-form")}
                        >
                          Отключить
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={pending}
                        onClick={() => void setFormLifecycle(form.id, "archive-form")}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                    Доставка:{" "}
                    {[
                      form.deliveryChannelId ? "канал" : null,
                      form.webhookUrl ? "webhook" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                    {disabled
                      ? " · кнопка form.open не работает, пока форма отключена"
                      : null}
                  </p>
                  {link ? (
                    <p style={{ margin: 0, fontSize: "0.9rem" }}>
                      Ссылка на сообщение:{" "}
                      <a href={link} target="_blank" rel="noreferrer">
                        {link}
                      </a>
                    </p>
                  ) : !disabled ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                      Кнопка ещё не опубликована — без неё форму нельзя открыть в Discord.
                    </p>
                  ) : null}
                  {publishing && !disabled ? (
                    <div className="stack" style={{ gap: "0.5rem" }}>
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
    </div>
  );
}
