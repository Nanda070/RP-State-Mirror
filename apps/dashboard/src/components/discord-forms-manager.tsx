"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";

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
  webhookUrl?: string | null;
  deliveryChannelId?: string | null;
  fields: Array<{ key: string; label: string }>;
  _count: { submissions: number };
};

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

export function DiscordFormsManager({
  initialForms,
  channels,
  initialWebhookUrl = "",
}: {
  initialForms: FormRow[];
  channels: ChannelOption[];
  initialWebhookUrl?: string;
}) {
  const [forms, setForms] = useState(initialForms);
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState(initialWebhookUrl);
  const [formDeliveryChannelId, setFormDeliveryChannelId] = useState("");
  const [formResponseLimit, setFormResponseLimit] = useState("");
  const [formFields, setFormFields] = useState<FormField[]>(() => [createEmptyField()]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createForm() {
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
            deliveryChannelId: formDeliveryChannelId.trim() || null,
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
            fields: fieldsPayload.map((f) => ({ key: f.key, label: f.label })),
            _count: body.form!._count ?? { submissions: 0 },
          },
          ...prev,
        ]);
      }
      setFormName("");
      setFormWebhookUrl("");
      setFormDeliveryChannelId("");
      setFormResponseLimit("");
      setFormFields([createEmptyField()]);
      setMessage("Форма создана.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка создания формы");
    } finally {
      setPending(false);
    }
  }

  function updateField(index: number, patch: Partial<Omit<FormField, "clientId">>) {
    setFormFields((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="panel-title">Новая Discord-форма</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          До 5 полей на форму (лимит Discord modal). Доставка ответа — в канал и/или webhook.
        </p>

        <label className="field">
          <span>Название формы</span>
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Например: Заявка на собеседование"
          />
        </label>

        <div className="form-grid-3">
          <label className="field">
            <span>Webhook URL (опционально)</span>
            <input
              value={formWebhookUrl}
              onChange={(e) => setFormWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
            />
          </label>
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
        </div>

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
              <label className="form-field-required">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                />
                Обязательное
              </label>
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
            disabled={!formName.trim() || pending}
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

      <section className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Существующие формы
        </h2>
        {forms.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Форм пока нет.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Поля</th>
                  <th>Ответов</th>
                  <th>Доставка</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => (
                  <tr key={form.id}>
                    <td>{form.name}</td>
                    <td>{form.fields.map((f) => f.label).join(", ")}</td>
                    <td>{form._count.submissions}</td>
                    <td>
                      {form.deliveryChannelId ? "канал" : ""}
                      {form.deliveryChannelId && form.webhookUrl ? " · " : ""}
                      {form.webhookUrl ? "webhook" : ""}
                      {!form.deliveryChannelId && !form.webhookUrl ? "—" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
