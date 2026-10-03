"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { FormPreview } from "./form-preview";
import { ToggleRow } from "./toggle-row";

// Mirrors FORM_FIELD_TYPES in @mirror/core (the core entry point is server-only).
const FIELD_TYPES = [
  { value: "short", label: "Короткий текст", discord: true },
  { value: "paragraph", label: "Абзац", discord: true },
  { value: "number", label: "Число", discord: true },
  { value: "date", label: "Дата", discord: true },
  { value: "select", label: "Выбор одного", discord: false },
  { value: "multiselect", label: "Выбор нескольких", discord: false },
  { value: "checkbox", label: "Флажок", discord: false },
] as const;
type FieldType = (typeof FIELD_TYPES)[number]["value"];

const MAX_FIELDS = 25;
const MODAL_FIELDS = 5;
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;

export type FormBuilderField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  helpText: string;
  options: string[];
  minLength: string;
  maxLength: string;
  min: string;
  max: string;
};

export type FormBuilderValue = {
  id: string | null;
  name: string;
  description: string;
  webhookUrl: string;
  deliveryChannelId: string;
  expiresAt: string;
  responseLimit: string;
  publicEnabled: boolean;
  slug: string;
  successMessage: string;
  fields: FormBuilderField[];
};

/** `autoKey`: the key follows the label until someone edits it or the field is saved. */
type Row = FormBuilderField & { rowId: number; optionsText: string; autoKey: boolean };

let nextRowId = 1;

function toRow(field: FormBuilderField, autoKey = false): Row {
  return { ...field, rowId: nextRowId++, optionsText: field.options.join("\n"), autoKey };
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Storage key made from the label: «Ваш возраст» → «vash_vozrast»; unique among `taken`. */
function keyFromLabel(label: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    [...label.toLowerCase()]
      .map((char) => TRANSLIT[char] ?? char)
      .join("")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[^a-z]+|_+$/g, "")
      .slice(0, 28) || fallback;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

function TypeIcon({ type }: { type: FieldType }) {
  const paths: Record<FieldType, string> = {
    short: "M5 8h14M5 12h8",
    paragraph: "M5 7h14M5 11h14M5 15h14M5 19h8",
    number: "M9 5 7.5 19M16.5 5 15 19M5 9.5h15M4 14.5h15",
    date: "M6 6.5h12a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1ZM5 10.5h14M9 4.5v3M15 4.5v3",
    select: "M5 7h14M5 12h14M5 17h14M16 10.5l1.5 1.5 1.5-1.5",
    multiselect: "m4.5 7 1.5 1.5L8.5 6M4.5 13l1.5 1.5L8.5 12M11.5 7.5H19M11.5 13.5H19M4.5 19H19",
    checkbox: "M6 5.5h12a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5ZM8.5 12.5l2.5 2.5 4.5-5",
  };
  return (
    <span className="builder-type" aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
        <path d={paths[type]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}


function blankField(index: number): FormBuilderField {
  return {
    key: `field_${index}`,
    label: "",
    type: "short",
    required: false,
    helpText: "",
    options: [],
    minLength: "",
    maxLength: "",
    min: "",
    max: "",
  };
}

function numberOrUndefined(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

/** ISO instant → `datetime-local` value in the browser's time zone. */
function isoToLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const RU_DATE_TIME = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/;

/** «05.10.2026 18:00» → local `YYYY-MM-DDTHH:mm`; empty text → empty; anything else → null. */
function ruToLocal(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = RU_DATE_TIME.exec(trimmed);
  if (!match) return null;
  const [day, month, year, hours, minutes] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(year ?? 0, (month ?? 1) - 1, day, hours, minutes);
  // 31.02 rolls over to March: reject it instead of silently moving the deadline.
  if (date.getDate() !== day || date.getMonth() !== (month ?? 1) - 1) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local `YYYY-MM-DDTHH:mm` → «05.10.2026 18:00». */
function localToRu(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}` : "";
}

/** `datetime-local` value (local time) → ISO string, or null. */
function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function FormBuilder({
  initial,
  channels,
  publicBaseUrl,
}: {
  initial: FormBuilderValue;
  channels: ChannelOption[];
  /** `PUBLIC_BASE_URL` from the environment. */
  publicBaseUrl: string;
}) {
  const router = useRouter();
  // `initial.expiresAt` is an ISO instant; the input needs the viewer's local time, which only the
  // browser knows — so it is filled in after mount to keep server and client markup identical.
  const [form, setForm] = useState({ ...initial, expiresAt: "" });
  // The deadline is typed the Russian way; the browser's own date field follows the system language.
  const [expiresText, setExpiresText] = useState("");
  useEffect(() => {
    if (!initial.expiresAt) return;
    const local = isoToLocal(initial.expiresAt);
    setForm((current) => ({ ...current, expiresAt: local }));
    setExpiresText(localToRu(local));
  }, [initial.expiresAt]);
  const [rows, setRows] = useState<Row[]>(() => initial.fields.map((field) => toRow(field, initial.id === null)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof FormBuilderValue>(key: K, value: FormBuilderValue[K]) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const setRow = (rowId: number, patch: Partial<Row>) => {
    setSaved(false);
    setRows((current) =>
      current.map((row) => {
        if (row.rowId !== rowId) return row;
        const next = { ...row, ...patch };
        if (next.autoKey && patch.label !== undefined) {
          const taken = new Set(current.filter((entry) => entry.rowId !== rowId).map((entry) => entry.key));
          next.key = keyFromLabel(patch.label, taken, row.key);
        }
        return next;
      }),
    );
  };
  // Drag a field by its handle to reorder.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dropRow = (target: number) => {
    if (dragIndex === null || dragIndex === target) return;
    setSaved(false);
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(dragIndex, 1);
      if (row) next.splice(target, 0, row);
      return next;
    });
    setDragIndex(null);
  };
  const moveRow = (index: number, delta: -1 | 1) => {
    setSaved(false);
    setRows((current) => {
      const next = [...current];
      const target = index + delta;
      const [row] = next.splice(index, 1);
      if (row && target >= 0 && target <= next.length) next.splice(target, 0, row);
      return next;
    });
  };

  const discordReady = rows.every((row) => FIELD_TYPES.find((type) => type.value === row.type)?.discord);
  const steps = Math.ceil(rows.length / MODAL_FIELDS);
  const publicUrl = form.slug ? `${publicBaseUrl}/f/${form.slug}` : null;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!form.name.trim()) list.push("Укажите название формы.");
    if (!form.webhookUrl.trim() && !form.deliveryChannelId) {
      list.push("Укажите, куда отправлять ответы: канал и/или webhook.");
    }
    if (rows.length === 0) list.push("Добавьте хотя бы одно поле.");
    const keys = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const name = row.label.trim() || `поле ${index + 1}`;
      if (!row.label.trim()) list.push(`Поле ${index + 1}: укажите подпись.`);
      if (!KEY_RE.test(row.key)) list.push(`«${name}»: ключ — латиница, цифры и _, с буквы.`);
      if (keys.has(row.key)) list.push(`«${name}»: ключ «${row.key}» уже используется.`);
      keys.add(row.key);
      if ((row.type === "select" || row.type === "multiselect") && !row.optionsText.trim()) {
        list.push(`«${name}»: добавьте варианты выбора.`);
      }
    }
    if (ruToLocal(expiresText) === null) list.push("Срок приёма ответов: дата в виде ДД.ММ.ГГГГ ЧЧ:ММ.");
    if (form.publicEnabled && !SLUG_RE.test(form.slug)) {
      list.push("Адрес публичной страницы: 3–48 символов, латиница, цифры и дефис.");
    }
    return list;
  }, [form, rows, expiresText]);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        webhookUrl: form.webhookUrl,
        deliveryChannelId: form.deliveryChannelId,
        expiresAt: localToIso(form.expiresAt),
        responseLimit: numberOrUndefined(form.responseLimit) ?? null,
        publicEnabled: form.publicEnabled,
        slug: form.slug,
        successMessage: form.successMessage,
        fields: rows.map((row) => {
          const text = row.type === "short" || row.type === "paragraph";
          const minLength = text ? numberOrUndefined(row.minLength) : undefined;
          const maxLength = text ? numberOrUndefined(row.maxLength) : undefined;
          const min = row.type === "number" ? numberOrUndefined(row.min) : undefined;
          const max = row.type === "number" ? numberOrUndefined(row.max) : undefined;
          return {
            key: row.key,
            label: row.label,
            type: row.type,
            required: row.required,
            helpText: row.helpText,
            options: row.optionsText.split("\n"),
            validation: {
              ...(minLength !== undefined ? { minLength } : {}),
              ...(maxLength !== undefined ? { maxLength } : {}),
              ...(min !== undefined ? { min } : {}),
              ...(max !== undefined ? { max } : {}),
            },
          };
        }),
      };
      const res = await fetch(form.id ? `/api/forms/${form.id}` : "/api/forms", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; form?: { id: string } };
      if (!res.ok || !data.form) throw new Error(data.error ?? "Ошибка сохранения");
      if (!form.id) {
        router.push(`/settings/forms/${data.form.id}`);
        router.refresh();
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="builder-layout">
    <div className="stack">
      <section className="panel">
        <h2 className="panel-title">Основное</h2>
        <div className="field">
          <label htmlFor="formName">Название</label>
          <input
            id="formName"
            maxLength={120}
            placeholder="Например: Заявка на собеседование"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="formDescription">Описание (видно заполняющему)</label>
          <textarea
            id="formDescription"
            rows={3}
            maxLength={1000}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Куда приходят ответы</h2>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="formChannel">Канал Discord</label>
            <ChannelSelect
              id="formChannel"
              value={form.deliveryChannelId}
              onChange={(value) => set("deliveryChannelId", value)}
              channels={channels}
            />
          </div>
          <div className="field u-span2">
            <label htmlFor="formWebhook">Webhook URL</label>
            <input
              id="formWebhook"
              placeholder="https://discord.com/api/webhooks/…"
              value={form.webhookUrl}
              onChange={(event) => set("webhookUrl", event.target.value)}
            />
          </div>
        </div>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="formLimit">Лимит ответов</label>
            <input
              id="formLimit"
              type="number"
              min={1}
              placeholder="Без лимита"
              value={form.responseLimit}
              onChange={(event) => set("responseLimit", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="formExpires">Принимать ответы до</label>
            <input
              id="formExpires"
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ ЧЧ:ММ"
              value={expiresText}
              onChange={(event) => {
                setExpiresText(event.target.value);
                const local = ruToLocal(event.target.value);
                if (local !== null) set("expiresAt", local);
              }}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="row builder-head">
          <h2 className="panel-title">Поля ({rows.length} из {MAX_FIELDS})</h2>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={rows.length >= MAX_FIELDS}
            onClick={() => {
              setSaved(false);
              setRows((current) => {
                const taken = new Set(current.map((entry) => entry.key));
                let index = current.length + 1;
                while (taken.has(`field_${index}`)) index += 1;
                return [...current, toRow(blankField(index), true)];
              });
            }}
          >
            Добавить поле
          </button>
        </div>
        {rows.length > 0 ? (
          <p className="muted u-mt0">
            {discordReady
              ? steps > 1
                ? `В Discord — ${steps} окна по ${MODAL_FIELDS} полей`
                : "В Discord — одно окно"
              : "Только сайт: есть поля выбора или флажки"}
          </p>
        ) : null}

        <div className="builder-fields">
          {rows.map((row, index) => {
            const choice = row.type === "select" || row.type === "multiselect";
            const text = row.type === "short" || row.type === "paragraph";
            return (
              <div
                key={row.rowId}
                className="builder-field"
                data-dragging={dragIndex === index ? "" : undefined}
                onDragOver={(event) => {
                  if (dragIndex !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropRow(index);
                }}
              >
                <div className="row builder-field-head">
                  <span
                    className="builder-handle"
                    draggable
                    title="Перетащите, чтобы изменить порядок"
                    aria-hidden
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragIndex(index);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <circle cx="9" cy="6" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" />
                      <circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </span>
                  <TypeIcon type={row.type} />
                  <strong className="builder-field-name">
                    {index + 1}. {row.label.trim() || "Новое поле"}
                  </strong>
                  <div className="row u-gap1">
                    <button
                      type="button"
                      className="icon-action"
                      aria-label="Поднять поле"
                      title="Выше"
                      disabled={index === 0}
                      onClick={() => moveRow(index, -1)}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                        <path d="m6 14 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-action"
                      aria-label="Опустить поле"
                      title="Ниже"
                      disabled={index === rows.length - 1}
                      onClick={() => moveRow(index, 1)}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                        <path d="m6 10 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-action"
                      aria-label="Убрать поле"
                      title="Убрать"
                      onClick={() => {
                        setSaved(false);
                        setRows((current) => current.filter((entry) => entry.rowId !== row.rowId));
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="builder-grid-2">
                  <div className="field">
                    <label htmlFor={`label-${row.rowId}`}>Подпись</label>
                    <input
                      id={`label-${row.rowId}`}
                      maxLength={100}
                      value={row.label}
                      onChange={(event) => setRow(row.rowId, { label: event.target.value })}
                    />
                    {row.label.length > 45 ? (
                      <span className="field-hint">В Discord подпись обрежется до 45 символов.</span>
                    ) : null}
                  </div>
                  <div className="field">
                    <label htmlFor={`type-${row.rowId}`}>Тип</label>
                    <select
                      id={`type-${row.rowId}`}
                      value={row.type}
                      onChange={(event) => setRow(row.rowId, { type: event.target.value as FieldType })}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                          {type.discord ? "" : " (только сайт)"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`help-${row.rowId}`}>Подсказка</label>
                  <input
                    id={`help-${row.rowId}`}
                    maxLength={300}
                    value={row.helpText}
                    onChange={(event) => setRow(row.rowId, { helpText: event.target.value })}
                  />
                </div>
                {choice ? (
                  <div className="field">
                    <label htmlFor={`options-${row.rowId}`}>Варианты — по одному на строке (до 25)</label>
                    <textarea
                      id={`options-${row.rowId}`}
                      rows={4}
                      value={row.optionsText}
                      onChange={(event) => setRow(row.rowId, { optionsText: event.target.value })}
                    />
                  </div>
                ) : null}
                <div className="builder-limits">
                  {text ? (
                    <>
                      <div className="field">
                        <label htmlFor={`minlen-${row.rowId}`}>Мин. длина</label>
                        <input
                          id={`minlen-${row.rowId}`}
                          type="number"
                          min={0}
                          value={row.minLength}
                          onChange={(event) => setRow(row.rowId, { minLength: event.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`maxlen-${row.rowId}`}>Макс. длина</label>
                        <input
                          id={`maxlen-${row.rowId}`}
                          type="number"
                          min={1}
                          placeholder={row.type === "paragraph" ? "4000" : "300"}
                          value={row.maxLength}
                          onChange={(event) => setRow(row.rowId, { maxLength: event.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                  {row.type === "number" ? (
                    <>
                      <div className="field">
                        <label htmlFor={`min-${row.rowId}`}>Минимум</label>
                        <input
                          id={`min-${row.rowId}`}
                          inputMode="decimal"
                          value={row.min}
                          onChange={(event) => setRow(row.rowId, { min: event.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`max-${row.rowId}`}>Максимум</label>
                        <input
                          id={`max-${row.rowId}`}
                          inputMode="decimal"
                          value={row.max}
                          onChange={(event) => setRow(row.rowId, { max: event.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                  <ToggleRow
                    id={`required-${row.rowId}`}
                    checked={row.required}
                    onChange={(checked) => setRow(row.rowId, { required: checked })}
                    label={row.type === "checkbox" ? "Нужно отметить" : "Обязательное"}
                  />
                </div>
                <details className="builder-more">
                  <summary>Дополнительно</summary>
                  <div className="field">
                    <label htmlFor={`key-${row.rowId}`}>Ключ хранения</label>
                    <input
                      id={`key-${row.rowId}`}
                      maxLength={32}
                      value={row.key}
                      onChange={(event) => setRow(row.rowId, { key: event.target.value.toLowerCase(), autoKey: false })}
                    />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Публичная страница</h2>
        <ToggleRow
          id="formPublic"
          checked={form.publicEnabled}
          onChange={(checked) => set("publicEnabled", checked)}
          label="Форму можно заполнить на сайте без входа"
        />
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="formSlug">Адрес страницы</label>
            <input
              id="formSlug"
              maxLength={48}
              placeholder="zayavka-fib"
              value={form.slug}
              onChange={(event) => set("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
            {publicUrl ? <span className="field-hint">{publicUrl}</span> : null}
          </div>
        </div>
        <div className="field">
          <label htmlFor="formSuccess">Сообщение после отправки</label>
          <input
            id="formSuccess"
            maxLength={500}
            placeholder="Спасибо! Ваш ответ принят."
            value={form.successMessage}
            onChange={(event) => set("successMessage", event.target.value)}
          />
        </div>
      </section>

      {problems.length > 0 ? (
        <div className="form-error">
          <strong>Перед сохранением исправьте:</strong>
          <ul className="builder-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p className="form-ok">Форма сохранена.</p> : null}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || problems.length > 0}
          onClick={() => void save()}
        >
          {pending ? "Сохранение…" : form.id ? "Сохранить изменения" : "Создать форму"}
        </button>
        <Link href="/settings/forms" className="btn btn-secondary">
          К списку форм
        </Link>
        {form.id && form.publicEnabled && publicUrl ? (
          <a href={publicUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
            Открыть публичную страницу
          </a>
        ) : null}
      </div>
    </div>
      <FormPreview
        name={form.name}
        description={form.description}
        discordReady={discordReady}
        fields={rows.map((row) => ({
          id: row.rowId,
          label: row.label,
          type: row.type,
          required: row.required,
          helpText: row.helpText,
          options: row.optionsText.split("\n").map((option) => option.trim()).filter(Boolean),
        }))}
      />
    </div>
  );
}
