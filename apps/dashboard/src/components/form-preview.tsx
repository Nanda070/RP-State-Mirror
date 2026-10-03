"use client";

import { useState } from "react";

export type PreviewField = {
  id: number;
  label: string;
  type: "short" | "paragraph" | "number" | "select" | "multiselect" | "checkbox" | "date";
  required: boolean;
  helpText: string;
  options: string[];
};

const MODAL_FIELDS = 5;
const DISCORD_LABEL_MAX = 45;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What the person filling the form will see: the Discord window (step by step) or the web page. */
export function FormPreview({
  name,
  description,
  fields,
  discordReady,
}: {
  name: string;
  description: string;
  fields: PreviewField[];
  /** False when the form has choice fields or checkboxes: Discord cannot show those in a window. */
  discordReady: boolean;
}) {
  const [mode, setMode] = useState<"discord" | "web">("discord");
  const [step, setStep] = useState(0);
  const shown = discordReady ? mode : "web";
  const steps = Math.max(1, Math.ceil(fields.length / MODAL_FIELDS));
  const current = Math.min(step, steps - 1);
  const title = name.trim() || "Новая форма";

  return (
    <aside className="panel form-preview">
      <div className="row form-preview-head">
        <h2 className="panel-title">Предпросмотр</h2>
        <div className="seg" role="tablist" aria-label="Где откроется форма">
          <button
            type="button"
            role="tab"
            aria-selected={shown === "discord"}
            disabled={!discordReady}
            title={discordReady ? undefined : "Поля выбора и флажки открываются только на сайте"}
            onClick={() => setMode("discord")}
          >
            Discord
          </button>
          <button type="button" role="tab" aria-selected={shown === "web"} onClick={() => setMode("web")}>
            Сайт
          </button>
        </div>
      </div>

      {fields.length === 0 ? (
        <p className="muted u-m0">Добавьте поле — оно появится здесь.</p>
      ) : shown === "discord" ? (
        <>
          <div className="dc-modal">
            <div className="dc-modal-title">{cut(title, DISCORD_LABEL_MAX)}</div>
            {fields.slice(current * MODAL_FIELDS, (current + 1) * MODAL_FIELDS).map((field) => (
              <div key={field.id} className="dc-modal-field">
                <span className="dc-modal-label">
                  {cut(field.label.trim() || "Новое поле", DISCORD_LABEL_MAX)}
                  {field.required ? <span className="dc-modal-required"> *</span> : null}
                </span>
                <span className="dc-modal-input" data-tall={field.type === "paragraph" ? "" : undefined}>
                  {field.helpText.trim() ? cut(field.helpText.trim(), 100) : ""}
                </span>
              </div>
            ))}
            <div className="dc-modal-foot">
              <span>Отмена</span>
              <span className="dc-modal-submit">{current < steps - 1 ? "Далее" : "Отправить"}</span>
            </div>
          </div>
          {steps > 1 ? (
            <div className="row form-preview-steps">
              <button type="button" className="icon-action" aria-label="Предыдущий шаг" disabled={current === 0} onClick={() => setStep(current - 1)}>
                ‹
              </button>
              <span className="muted">
                Шаг {current + 1} из {steps}
              </span>
              <button
                type="button"
                className="icon-action"
                aria-label="Следующий шаг"
                disabled={current >= steps - 1}
                onClick={() => setStep(current + 1)}
              >
                ›
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="web-preview">
          <div className="web-preview-title">{title}</div>
          {description.trim() ? <p className="web-preview-text">{description.trim()}</p> : null}
          {fields.map((field) => (
            <div key={field.id} className="web-preview-field">
              {field.type === "checkbox" ? (
                <span className="web-preview-check">
                  <i aria-hidden />
                  {field.label.trim() || "Новое поле"}
                  {field.required ? <b> *</b> : null}
                </span>
              ) : (
                <>
                  <span className="web-preview-label">
                    {field.label.trim() || "Новое поле"}
                    {field.required ? <b> *</b> : null}
                  </span>
                  {field.type === "multiselect" ? (
                    <span className="chip-row">
                      {(field.options.length > 0 ? field.options : ["Вариант"]).slice(0, 6).map((option) => (
                        <span key={option} className="chip-toggle">
                          {option}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="dc-modal-input web" data-tall={field.type === "paragraph" ? "" : undefined}>
                      {field.type === "select" ? "Выберите…" : field.type === "date" ? "дд.мм.гггг" : ""}
                    </span>
                  )}
                </>
              )}
              {field.helpText.trim() ? <span className="field-hint">{field.helpText.trim()}</span> : null}
            </div>
          ))}
          <span className="web-preview-submit">Отправить</span>
        </div>
      )}
    </aside>
  );
}
