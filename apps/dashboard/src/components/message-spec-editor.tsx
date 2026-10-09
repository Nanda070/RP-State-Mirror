"use client";

import type { ClassicEmbed, EmbedSpec, InteractiveRow, V2Button, V2Component } from "@mirror/core/embeds";

export type EditorRole = { discordId: string; name: string; guildName: string };
export type EditorForm = { id: string; name: string };

type Container = Extract<EmbedSpec, { version: 2 }>["components"][number];
type ButtonKind = "link" | "callback" | "role.toggle" | "form.open" | "feedback.open" | "lawyer.call";

const BUTTON_KINDS: { value: ButtonKind; label: string }[] = [
  { value: "link", label: "Ссылка" },
  { value: "callback", label: "Ответ текстом" },
  { value: "role.toggle", label: "Выдать / снять роль" },
  { value: "form.open", label: "Открыть форму" },
  { value: "feedback.open", label: "Обратная связь" },
  { value: "lawyer.call", label: "Вызов адвоката" },
];

const BLOCK_TYPES: { value: V2Component["type"]; label: string }[] = [
  { value: "text_display", label: "Текст" },
  { value: "separator", label: "Разделитель" },
  { value: "media_gallery", label: "Изображения" },
  { value: "action_row", label: "Ряд кнопок" },
];

const hex = (color: number | undefined) => `#${(color ?? 0xff6a1a).toString(16).padStart(6, "0")}`;
const fromHex = (value: string) => Number.parseInt(value.replace("#", ""), 16);

/** Copy of `object` where `key` holds `value`, or is absent when the value is empty. */
function withOptional<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | "" | undefined | null): T {
  const { [key]: _removed, ...rest } = object;
  return (value === "" || value === undefined || value === null ? rest : { ...rest, [key]: value }) as T;
}

function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function buttonKind(button: V2Button): ButtonKind {
  if (button.style === "link" || button.url !== undefined) return "link";
  return (button.action as ButtonKind | undefined) ?? "callback";
}

function ButtonEditor({
  button,
  onChange,
  onRemove,
  roles,
  forms,
}: {
  button: V2Button;
  onChange: (next: V2Button) => void;
  onRemove: () => void;
  roles: EditorRole[];
  forms: EditorForm[];
}) {
  const kind = buttonKind(button);
  const params = (button.params ?? {}) as Record<string, unknown>;

  function setKind(next: ButtonKind) {
    const base = { type: "button" as const, label: button.label };
    if (next === "link") onChange({ ...base, style: "link", url: "https://" });
    else onChange({ ...base, style: button.style === "link" ? "secondary" : (button.style ?? "secondary"), action: next, params: {} });
  }

  return (
    <div className="spec-button">
      <div className="field">
        <label>Надпись</label>
        <input maxLength={80} value={button.label} onChange={(e) => onChange({ ...button, label: e.target.value })} />
      </div>
      <div className="field">
        <label>Действие</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ButtonKind)}>
          {BUTTON_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      {kind === "link" ? (
        <div className="field">
          <label>Адрес</label>
          <input type="url" placeholder="https://" value={button.url ?? ""} onChange={(e) => onChange({ ...button, style: "link", url: e.target.value })} />
        </div>
      ) : (
        <div className="field">
          <label>Цвет</label>
          <select
            value={button.style ?? "secondary"}
            onChange={(e) => onChange({ ...button, style: e.target.value as NonNullable<V2Button["style"]> })}
          >
            <option value="primary">Синяя</option>
            <option value="secondary">Серая</option>
            <option value="success">Зелёная</option>
            <option value="danger">Красная</option>
          </select>
        </div>
      )}
      {kind === "callback" ? (
        <div className="field spec-button-wide">
          <label>Что бот ответит нажавшему</label>
          <input
            maxLength={500}
            value={typeof params.message === "string" ? params.message : ""}
            onChange={(e) => onChange({ ...button, params: { message: e.target.value } })}
          />
        </div>
      ) : null}
      {kind === "role.toggle" ? (
        <div className="field spec-button-wide">
          <label>Роль</label>
          <select
            value={typeof params.roleDiscordId === "string" ? params.roleDiscordId : ""}
            onChange={(e) => onChange({ ...button, params: { roleDiscordId: e.target.value } })}
          >
            <option value="">Выберите роль</option>
            {roles.map((role) => (
              <option key={role.discordId} value={role.discordId}>
                {role.guildName} · {role.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {kind === "form.open" ? (
        <div className="field spec-button-wide">
          <label>Форма</label>
          <select
            value={typeof params.formId === "string" ? params.formId : ""}
            onChange={(e) => onChange({ ...button, params: { formId: e.target.value } })}
          >
            <option value="">Выберите форму</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button type="button" className="btn btn-ghost spec-remove" onClick={onRemove}>
        Убрать кнопку
      </button>
    </div>
  );
}

function ButtonRowEditor({
  buttons,
  onChange,
  onRemove,
  roles,
  forms,
}: {
  buttons: V2Button[];
  onChange: (next: V2Button[]) => void;
  onRemove: () => void;
  roles: EditorRole[];
  forms: EditorForm[];
}) {
  return (
    <div className="spec-row">
      {buttons.map((button, index) => (
        <ButtonEditor
          key={index}
          button={button}
          roles={roles}
          forms={forms}
          onChange={(next) => onChange(buttons.map((entry, i) => (i === index ? next : entry)))}
          onRemove={() => (buttons.length === 1 ? onRemove() : onChange(buttons.filter((_, i) => i !== index)))}
        />
      ))}
      <div className="row">
        {buttons.length < 5 ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onChange([...buttons, { type: "button", label: "Кнопка", style: "secondary", action: "callback", params: {} }])}
          >
            Добавить кнопку в ряд
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={onRemove}>
          Убрать ряд
        </button>
      </div>
    </div>
  );
}

function EmbedEditor({
  embed,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  embed: ClassicEmbed;
  index: number;
  canRemove: boolean;
  onChange: (next: ClassicEmbed) => void;
  onRemove: () => void;
}) {
  const fields = embed.fields ?? [];
  return (
    <details className="spec-block" open={index === 0}>
      <summary>
        Эмбед {index + 1}
        {embed.title ? ` · ${embed.title}` : ""}
      </summary>
      <div className="field">
        <label>Заголовок</label>
        <input maxLength={256} value={embed.title ?? ""} onChange={(e) => onChange(withOptional(embed, "title", e.target.value))} />
      </div>
      <div className="field">
        <label>Текст</label>
        <textarea rows={5} maxLength={4096} value={embed.description ?? ""} onChange={(e) => onChange(withOptional(embed, "description", e.target.value))} />
      </div>
      <div className="form-grid-3">
        <div className="field">
          <label>Цвет полосы</label>
          <input type="color" value={hex(embed.color)} onChange={(e) => onChange({ ...embed, color: fromHex(e.target.value) })} />
        </div>
        <div className="field">
          <label>Ссылка заголовка</label>
          <input type="url" placeholder="https://" value={embed.url ?? ""} onChange={(e) => onChange(withOptional(embed, "url", e.target.value))} />
        </div>
        <div className="field">
          <label>Автор</label>
          <input
            maxLength={256}
            value={embed.author?.name ?? ""}
            onChange={(e) => onChange(withOptional(embed, "author", e.target.value ? { ...embed.author, name: e.target.value } : undefined))}
          />
        </div>
        <div className="field">
          <label>Картинка (адрес)</label>
          <input type="url" placeholder="https://" value={embed.image ?? ""} onChange={(e) => onChange(withOptional(embed, "image", e.target.value))} />
        </div>
        <div className="field">
          <label>Миниатюра (адрес)</label>
          <input type="url" placeholder="https://" value={embed.thumbnail ?? ""} onChange={(e) => onChange(withOptional(embed, "thumbnail", e.target.value))} />
        </div>
        <div className="field">
          <label>Подвал</label>
          <input
            maxLength={2048}
            value={embed.footer?.text ?? ""}
            onChange={(e) => onChange(withOptional(embed, "footer", e.target.value ? { ...embed.footer, text: e.target.value } : undefined))}
          />
        </div>
      </div>
      <label className="toggle-row">
        <input type="checkbox" checked={embed.timestamp ?? false} onChange={(e) => onChange(withOptional(embed, "timestamp", e.target.checked || undefined))} />
        <span>Показывать время отправки</span>
      </label>

      <div className="spec-fields">
        {fields.map((field, fieldIndex) => (
          <div key={fieldIndex} className="spec-field-row">
            <div className="field">
              <label>Поле: название</label>
              <input
                maxLength={256}
                value={field.name}
                onChange={(e) => onChange({ ...embed, fields: fields.map((entry, i) => (i === fieldIndex ? { ...entry, name: e.target.value } : entry)) })}
              />
            </div>
            <div className="field">
              <label>Значение</label>
              <input
                maxLength={1024}
                value={field.value}
                onChange={(e) => onChange({ ...embed, fields: fields.map((entry, i) => (i === fieldIndex ? { ...entry, value: e.target.value } : entry)) })}
              />
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={field.inline ?? false}
                onChange={(e) => onChange({ ...embed, fields: fields.map((entry, i) => (i === fieldIndex ? { ...entry, inline: e.target.checked } : entry)) })}
              />
              <span>В строку</span>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onChange(withOptional(embed, "fields", fields.length === 1 ? undefined : fields.filter((_, i) => i !== fieldIndex)))}
            >
              Убрать
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        {fields.length < 25 ? (
          <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...embed, fields: [...fields, { name: "Поле", value: "Значение" }] })}>
            Добавить поле
          </button>
        ) : null}
        {canRemove ? (
          <button type="button" className="btn btn-ghost" onClick={onRemove}>
            Убрать эмбед
          </button>
        ) : null}
      </div>
    </details>
  );
}

function newBlock(type: V2Component["type"]): V2Component {
  switch (type) {
    case "separator":
      return { type: "separator", divider: true };
    case "media_gallery":
      return { type: "media_gallery", items: [{ url: "https://" }] };
    case "action_row":
      return { type: "action_row", components: [{ type: "button", label: "Кнопка", style: "secondary", action: "callback", params: {} }] };
    default:
      return { type: "text_display", content: "" };
  }
}

function BlockEditor({
  block,
  onChange,
  roles,
  forms,
  onRemove,
}: {
  block: V2Component;
  onChange: (next: V2Component) => void;
  onRemove: () => void;
  roles: EditorRole[];
  forms: EditorForm[];
}) {
  if (block.type === "text_display") {
    return (
      <div className="field">
        <label>Текст (Markdown Discord)</label>
        <textarea rows={4} maxLength={4096} value={block.content} onChange={(e) => onChange({ ...block, content: e.target.value })} />
      </div>
    );
  }
  if (block.type === "separator") {
    return (
      <div className="row">
        <label className="toggle-row">
          <input type="checkbox" checked={block.divider ?? false} onChange={(e) => onChange({ ...block, divider: e.target.checked })} />
          <span>Линия</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={block.spacing === "large"} onChange={(e) => onChange({ ...block, spacing: e.target.checked ? "large" : "small" })} />
          <span>Большой отступ</span>
        </label>
      </div>
    );
  }
  if (block.type === "media_gallery") {
    return (
      <>
        {block.items.map((item, index) => (
          <div key={index} className="spec-field-row">
            <div className="field">
              <label>Адрес изображения</label>
              <input
                type="url"
                placeholder="https://"
                value={item.url}
                onChange={(e) => onChange({ ...block, items: block.items.map((entry, i) => (i === index ? { ...entry, url: e.target.value } : entry)) })}
              />
            </div>
            {block.items.length > 1 ? (
              <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...block, items: block.items.filter((_, i) => i !== index) })}>
                Убрать
              </button>
            ) : null}
          </div>
        ))}
        {block.items.length < 10 ? (
          <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...block, items: [...block.items, { url: "https://" }] })}>
            Добавить изображение
          </button>
        ) : null}
      </>
    );
  }
  if (block.type === "action_row") {
    return <ButtonRowEditor buttons={block.components} roles={roles} forms={forms} onRemove={onRemove} onChange={(components) => onChange({ ...block, components })} />;
  }
  return <p className="muted">Список ролей редактируется в разделе «Кнопки и роли».</p>;
}

/**
 * Editor of a whole message: every field of classic embeds, the block tree of Components V2,
 * and buttons with their actions. Works on the same JSON the bot sends.
 */
export function MessageSpecEditor({
  spec,
  onChange,
  roles,
  forms,
}: {
  spec: EmbedSpec;
  onChange: (next: EmbedSpec) => void;
  roles: EditorRole[];
  forms: EditorForm[];
}) {
  if (spec.version === 1) {
    const rows: InteractiveRow[] = spec.components ?? [];
    const setRows = (next: InteractiveRow[]) => onChange(withOptional(spec, "components", next.length > 0 ? next : undefined));
    return (
      <>
        {spec.embeds.map((embed, index) => (
          <EmbedEditor
            key={index}
            embed={embed}
            index={index}
            canRemove={spec.embeds.length > 1}
            onChange={(next) => onChange({ ...spec, embeds: spec.embeds.map((entry, i) => (i === index ? next : entry)) })}
            onRemove={() => onChange({ ...spec, embeds: spec.embeds.filter((_, i) => i !== index) })}
          />
        ))}
        {rows.map((row, index) => (
          <div key={`row-${index}`} className="spec-block">
            <div className="spec-block-head">Ряд под сообщением {index + 1}</div>
            {row.type === "action_row" ? (
              <ButtonRowEditor
                buttons={row.components}
                roles={roles}
                forms={forms}
                onChange={(components) => setRows(rows.map((entry, i) => (i === index ? { type: "action_row", components } : entry)))}
                onRemove={() => setRows(rows.filter((_, i) => i !== index))}
              />
            ) : (
              <p className="muted">Список ролей редактируется в разделе «Кнопки и роли».</p>
            )}
          </div>
        ))}
        <div className="row">
          {spec.embeds.length < 10 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onChange({ ...spec, embeds: [...spec.embeds, { type: "embed", title: "", description: "", color: 0xff6a1a }] })}
            >
              Добавить эмбед
            </button>
          ) : null}
          {rows.length < 5 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setRows([...rows, newBlock("action_row") as InteractiveRow])}>
              Добавить ряд кнопок
            </button>
          ) : null}
        </div>
      </>
    );
  }

  const containers = spec.components;
  const setContainer = (index: number, next: Container) =>
    onChange({ version: 2, components: containers.map((entry, i) => (i === index ? next : entry)) });

  return (
    <>
      {containers.map((container, containerIndex) => (
        <details key={containerIndex} className="spec-block" open>
          <summary>Контейнер {containerIndex + 1}</summary>
          <div className="field">
            <label>Цвет полосы</label>
            <input type="color" value={hex(container.accentColor)} onChange={(e) => setContainer(containerIndex, { ...container, accentColor: fromHex(e.target.value) })} />
          </div>
          {container.components.map((block, blockIndex) => (
            <div key={blockIndex} className="spec-subblock">
              <div className="spec-block-head">
                <span>{BLOCK_TYPES.find((entry) => entry.value === block.type)?.label ?? "Список ролей"}</span>
                <span className="spec-block-tools">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label="Выше"
                    disabled={blockIndex === 0}
                    onClick={() => setContainer(containerIndex, { ...container, components: move(container.components, blockIndex, -1) })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label="Ниже"
                    disabled={blockIndex === container.components.length - 1}
                    onClick={() => setContainer(containerIndex, { ...container, components: move(container.components, blockIndex, 1) })}
                  >
                    ↓
                  </button>
                  {container.components.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setContainer(containerIndex, { ...container, components: container.components.filter((_, i) => i !== blockIndex) })}
                    >
                      Убрать
                    </button>
                  ) : null}
                </span>
              </div>
              <BlockEditor
                block={block}
                roles={roles}
                forms={forms}
                onChange={(next) => setContainer(containerIndex, { ...container, components: container.components.map((entry, i) => (i === blockIndex ? next : entry)) })}
                onRemove={() => setContainer(containerIndex, { ...container, components: container.components.filter((_, i) => i !== blockIndex) })}
              />
            </div>
          ))}
          <div className="row">
            {container.components.length < 10
              ? BLOCK_TYPES.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setContainer(containerIndex, { ...container, components: [...container.components, newBlock(entry.value)] })}
                  >
                    + {entry.label}
                  </button>
                ))
              : null}
            {containers.length > 1 ? (
              <button type="button" className="btn btn-ghost" onClick={() => onChange({ version: 2, components: containers.filter((_, i) => i !== containerIndex) })}>
                Убрать контейнер
              </button>
            ) : null}
          </div>
        </details>
      ))}
      {containers.length < 5 ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChange({ version: 2, components: [...containers, { type: "container", accentColor: 0xff6a1a, components: [newBlock("text_display")] }] })}
        >
          Добавить контейнер
        </button>
      ) : null}
    </>
  );
}
