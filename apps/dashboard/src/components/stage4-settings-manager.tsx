"use client";

import { useEffect, useState } from "react";

type Stage4Data = {
  settings: Record<string, unknown>;
  panels: Array<{ id: string; guildDiscordId: string; channelDiscordId: string; messageDiscordId?: string | null; spec: unknown }>;
  forms: Array<{
    id: string;
    name: string;
    webhookUrl?: string | null;
    deliveryChannelId?: string | null;
    fields: Array<{ key: string; label: string }>;
    _count: { submissions: number };
  }>;
  feedback: Array<{ id: string; category: string; status: string; authorDiscordId: string; messages: Array<{ authorDiscordId: string; content: string }> }>;
};

const settingFields = [
  ["registrations.ttlDays", "TTL регистраций, дней"],
  ["registrations.channelId", "Канал заявок"],
  ["registrations.coordinatorRoleIds", "Роли координаторов (JSON-массив)"],
  ["transfers.channelId", "Канал переводов"],
  ["transfers.approvalDmText", "ЛС после одобрения"],
  ["webhooks.notifyChannelId", "Канал уведомлений webhook"],
  ["feedback.notifyChannelId", "Канал уведомлений обратной связи"],
  ["icBlacklist.managerRoleIds", "Роли управления ЧС (JSON-массив)"],
  ["icBlacklist.searchRoleIds", "Роли поиска ЧС (JSON-массив)"],
  ["invites.guildIds", "Серверы /инвайт-админ (JSON-массив)"],
  ["invites.defaultMaxAgeSeconds", "Срок инвайта, сек"],
  ["tokens.expandThresholdPercent", "Порог расширения нашивок, %"],
  ["tokens.finderRoleIds", "Роли /token find (JSON-массив)"],
] as const;

function parseSnowflakeList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => /^\d{17,20}$/.test(item));
}

export function Stage4SettingsManager() {
  const [data, setData] = useState<Stage4Data | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState("");
  const [formDeliveryChannelId, setFormDeliveryChannelId] = useState("");
  const [formResponseLimit, setFormResponseLimit] = useState("");
  const [formFields, setFormFields] = useState([{ key: "name", label: "Имя", type: "short", required: true }]);
  const [panelGuildId, setPanelGuildId] = useState("");
  const [panelChannelId, setPanelChannelId] = useState("");
  const [panelTitle, setPanelTitle] = useState("");
  const [panelDescription, setPanelDescription] = useState("");
  const [panelRoleId, setPanelRoleId] = useState("");
  const [panelButtonLabel, setPanelButtonLabel] = useState("");
  const [panelAllowedRoles, setPanelAllowedRoles] = useState("");
  const [panelExclusiveRoles, setPanelExclusiveRoles] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/settings/stage4");
    const next = (await response.json()) as Stage4Data;
    if (!response.ok) throw new Error((next as unknown as { error?: string }).error ?? "Не удалось загрузить настройки");
    setData(next);
    setSettings(Object.fromEntries(Object.entries(next.settings).map(([key, value]) => [key, JSON.stringify(value)])));
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Ошибка загрузки"));
  }, []);

  async function saveSettings() {
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      try {
        parsed[key] = value.trim().startsWith("[") ? JSON.parse(value) : value;
        if (/Days|Percent|Seconds/.test(key)) parsed[key] = Number(parsed[key]);
      } catch {
        throw new Error(`Некорректное JSON-значение для ${key}`);
      }
    }
    const response = await fetch("/api/settings/stage4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: parsed }),
    });
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Ошибка сохранения");
    setMessage("Настройки сохранены.");
  }

  async function createForm() {
    const response = await fetch("/api/settings/stage4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form: {
          name: formName,
          webhookUrl: formWebhookUrl.trim() || null,
          deliveryChannelId: formDeliveryChannelId.trim() || null,
          responseLimit: formResponseLimit.trim() ? Number(formResponseLimit) : null,
          fields: formFields,
        },
      }),
    });
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Ошибка создания формы");
    setFormName("");
    setFormWebhookUrl("");
    setFormDeliveryChannelId("");
    setFormResponseLimit("");
    setMessage("Форма создана.");
    await load();
  }

  async function createPanel() {
    const allowedRoleIds = parseSnowflakeList(panelAllowedRoles);
    const exclusiveRoleIds = parseSnowflakeList(panelExclusiveRoles);
    const spec = {
      version: 1,
      embeds: [
        {
          type: "embed",
          title: panelTitle.trim() || "Получение роли",
          description: panelDescription.trim() || "Нажмите кнопку ниже, чтобы получить или снять роль.",
          color: 0x5865f2,
        },
      ],
      components: [
        {
          type: "action_row",
          components: [
            {
              type: "button",
              style: "primary",
              label: panelButtonLabel.trim() || "Получить/снять роль",
              action: "role.toggle",
              params: {
                roleDiscordId: panelRoleId.trim(),
                ...(allowedRoleIds.length ? { allowedRoleIds } : {}),
                ...(exclusiveRoleIds.length ? { exclusiveRoleIds } : {}),
              },
            },
          ],
        },
      ],
    };
    const response = await fetch("/api/settings/stage4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rolePanel: {
          guildDiscordId: panelGuildId.trim(),
          channelDiscordId: panelChannelId.trim(),
          spec,
        },
      }),
    });
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Ошибка создания панели");
    setPanelTitle("");
    setPanelRoleId("");
    setPanelAllowedRoles("");
    setPanelExclusiveRoles("");
    setMessage("Панель создана и отправлена в очередь на публикацию.");
    await load();
  }

  async function feedbackAction(action: "close-feedback" | "reply-feedback", id: string) {
    const response = await fetch("/api/settings/stage4", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "reply-feedback"
        ? { action, id, content: reply[id] ?? "" }
        : { action, id }),
    });
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Ошибка обработки");
    setMessage(action === "reply-feedback" ? "Ответ отправлен в ЛС игроку." : "Тикет закрыт.");
    await load();
  }

  if (!data) return <div className="panel muted">Загрузка настроек…</div>;
  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="panel-title">Конфигурация модулей</h2>
        {settingFields.map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input value={settings[key] ?? ""} onChange={(event) => setSettings((prev) => ({ ...prev, [key]: event.target.value }))} />
          </label>
        ))}
        <button className="btn btn-primary" type="button" onClick={() => void saveSettings().catch((error) => setMessage(error.message))}>Сохранить</button>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">Discord-формы</h2>
        <p className="muted">До 5 полей на форму (лимит Discord modal). Доставка ответа — в канал и/или webhook.</p>
        <input placeholder="Название формы" value={formName} onChange={(event) => setFormName(event.target.value)} />
        <div className="row">
          <input placeholder="Webhook URL (опционально)" value={formWebhookUrl} onChange={(event) => setFormWebhookUrl(event.target.value)} />
          <input placeholder="ID канала доставки (опционально)" value={formDeliveryChannelId} onChange={(event) => setFormDeliveryChannelId(event.target.value)} />
          <input placeholder="Лимит ответов" value={formResponseLimit} onChange={(event) => setFormResponseLimit(event.target.value)} />
        </div>
        {formFields.map((field, index) => (
          <div className="row" key={`${field.key}-${index}`}>
            <input aria-label="Ключ поля" value={field.key} onChange={(event) => setFormFields((prev) => prev.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
            <input aria-label="Подпись поля" value={field.label} onChange={(event) => setFormFields((prev) => prev.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
            <select value={field.type} onChange={(event) => setFormFields((prev) => prev.map((item, i) => i === index ? { ...item, type: event.target.value } : item))}><option value="short">Короткий текст</option><option value="paragraph">Абзац</option></select>
            <label><input type="checkbox" checked={field.required} onChange={(event) => setFormFields((prev) => prev.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} /> Обязательное</label>
          </div>
        ))}
        <button className="btn btn-secondary" type="button" onClick={() => setFormFields((prev) => [...prev, { key: `field_${prev.length + 1}`, label: "Новое поле", type: "short", required: false }])} disabled={formFields.length >= 5}>Добавить поле</button>
        <button className="btn btn-primary" type="button" disabled={!formName.trim()} onClick={() => void createForm().catch((error) => setMessage(error.message))}>Создать форму</button>
        <ul>
          {data.forms.map((form) => (
            <li key={form.id}>
              {form.name} · ответов: {form._count.submissions}
              {form.deliveryChannelId ? ` · канал ${form.deliveryChannelId}` : ""}
              {form.webhookUrl ? " · webhook" : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">Панели ролей (Role Panels)</h2>
        <div className="stack" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1rem" }}>
          <h3 style={{ margin: 0 }}>Создать новую панель ролей</h3>
          <div className="row">
            <input placeholder="ID сервера (Guild Discord ID)" value={panelGuildId} onChange={(e) => setPanelGuildId(e.target.value)} />
            <input placeholder="ID канала (Channel Discord ID)" value={panelChannelId} onChange={(e) => setPanelChannelId(e.target.value)} />
          </div>
          <div className="row">
            <input placeholder="Заголовок панели (напр. Выдача роли)" value={panelTitle} onChange={(e) => setPanelTitle(e.target.value)} />
            <input placeholder="Описание панели" value={panelDescription} onChange={(e) => setPanelDescription(e.target.value)} />
          </div>
          <div className="row">
            <input placeholder="ID роли для выдачи" value={panelRoleId} onChange={(e) => setPanelRoleId(e.target.value)} />
            <input placeholder="Текст на кнопке (напр. Получить роль)" value={panelButtonLabel} onChange={(e) => setPanelButtonLabel(e.target.value)} />
          </div>
          <div className="row">
            <input placeholder="Кто может нажимать (ID ролей через запятую)" value={panelAllowedRoles} onChange={(e) => setPanelAllowedRoles(e.target.value)} />
            <input placeholder="Взаимоисключающие роли (ID через запятую)" value={panelExclusiveRoles} onChange={(e) => setPanelExclusiveRoles(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!panelGuildId.trim() || !panelChannelId.trim() || !panelRoleId.trim()}
            onClick={() => void createPanel().catch((err) => setMessage(err.message))}
          >
            Создать и опубликовать панель
          </button>
        </div>
        <p>Активных панелей: {data.panels.length}</p>
        <ul>
          {data.panels.map((panel) => (
            <li key={panel.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span>
                <strong>{panel.guildDiscordId} / {panel.channelDiscordId}</strong> · {panel.messageDiscordId ? `Опубликовано (сообщение ${panel.messageDiscordId})` : "В очереди на публикацию"}
              </span>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void fetch("/api/settings/stage4", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive-panel", id: panel.id }) }).then(() => load())}
              >
                Архивировать
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">Обратная связь (Feedback)</h2>
        <ul>
          {data.feedback.map((ticket) => (
            <li key={ticket.id} className="stack" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.75rem", marginBottom: "0.75rem" }}>
              <div>
                <strong>{ticket.category}</strong> · Статус: <code>{ticket.status}</code> · Автор: <code>{ticket.authorDiscordId}</code>
              </div>
              <ul style={{ margin: "0.5rem 0", paddingLeft: "1.2rem" }}>
                {ticket.messages.map((item, idx) => (
                  <li key={idx}><strong>{item.authorDiscordId}:</strong> {item.content}</li>
                ))}
              </ul>
              {ticket.status !== "CLOSED" ? (
                <div className="row">
                  <input
                    value={reply[ticket.id] ?? ""}
                    onChange={(event) => setReply((prev) => ({ ...prev, [ticket.id]: event.target.value }))}
                    placeholder="Ответ администратора (будет отправлен игроку в ЛС Discord)..."
                  />
                  <button className="btn btn-primary" type="button" onClick={() => void feedbackAction("reply-feedback", ticket.id)}>Ответить в ЛС</button>
                  <button className="btn btn-secondary" type="button" onClick={() => void feedbackAction("close-feedback", ticket.id)}>Закрыть тикет</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {message ? <p className="muted" role="status">{message}</p> : null}
    </div>
  );
}
