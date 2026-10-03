"use client";

import { confirmDialog } from "@/lib/confirm";
import { useMemo, useState } from "react";
import { markdownText } from "@/lib/markdown";
import { Markdown } from "./markdown";

type FaqItem = { id: string; title: string; body: string };
type FaqSection = { id: string; title: string; items: FaqItem[] };

type Editor =
  | { kind: "section"; id: string | null; title: string }
  | { kind: "item"; id: string | null; sectionId: string; title: string; body: string; preview: boolean };

function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [entry] = next.splice(index, 1);
  if (entry !== undefined) next.splice(target, 0, entry);
  return next;
}

export function FaqBrowser({ sections: initial, canEdit }: { sections: FaqSection[]; canEdit: boolean }) {
  const [sections, setSections] = useState(initial);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => item.title.toLowerCase().includes(q) || markdownText(item.body).toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0 || section.title.toLowerCase().includes(q));
  }, [sections, query]);

  const searching = query.trim() !== "";

  async function call(payload: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; sections?: Array<FaqSection & { items: FaqItem[] }> };
      if (!res.ok || !data.sections) throw new Error(data.error ?? "Ошибка сохранения");
      setSections(
        data.sections.map((section) => ({
          id: section.id,
          title: section.title,
          items: section.items.map((item) => ({ id: item.id, title: item.title, body: item.body })),
        })),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const ok =
      editor.kind === "section"
        ? await call(
            editor.id
              ? { action: "update-section", id: editor.id, title: editor.title }
              : { action: "create-section", title: editor.title },
          )
        : await call(
            editor.id
              ? {
                  action: "update-item",
                  id: editor.id,
                  sectionId: editor.sectionId,
                  title: editor.title,
                  body: editor.body,
                }
              : { action: "create-item", sectionId: editor.sectionId, title: editor.title, body: editor.body },
          );
    if (ok) setEditor(null);
  }

  return (
    <div className="stack">
      <div className="panel catalog-toolbar">
        <div className="field catalog-search">
          <label htmlFor="faqSearch">Поиск</label>
          <input
            id="faqSearch"
            type="search"
            placeholder="Слово из вопроса или ответа"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {canEdit ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              setEditor({ kind: "section", id: null, title: "" });
            }}
          >
            Новый раздел
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {canEdit && editor ? (
        <form className="panel" onSubmit={(event) => void saveEditor(event)}>
          <h2 className="panel-title">
            {editor.kind === "section"
              ? editor.id
                ? "Переименовать раздел"
                : "Новый раздел"
              : editor.id
                ? "Изменить статью"
                : "Новая статья"}
          </h2>
          {editor.kind === "item" ? (
            <div className="field">
              <label htmlFor="faqItemSection">Раздел</label>
              <select
                id="faqItemSection"
                value={editor.sectionId}
                onChange={(event) => setEditor({ ...editor, sectionId: event.target.value })}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="faqTitle">{editor.kind === "section" ? "Название раздела" : "Заголовок (вопрос)"}</label>
            <input
              id="faqTitle"
              required
              maxLength={160}
              value={editor.title}
              onChange={(event) => setEditor({ ...editor, title: event.target.value })}
            />
          </div>
          {editor.kind === "item" ? (
            <div className="field">
              <div className="row faq-editor-head">
                <label htmlFor="faqBody">Текст (Markdown)</label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditor({ ...editor, preview: !editor.preview })}
                >
                  {editor.preview ? "Редактировать" : "Предпросмотр"}
                </button>
              </div>
              {editor.preview ? (
                <div className="faq-preview">
                  {editor.body.trim() ? <Markdown source={editor.body} /> : <p className="muted">Текст пуст.</p>}
                </div>
              ) : (
                <textarea
                  id="faqBody"
                  required
                  rows={12}
                  maxLength={20000}
                  value={editor.body}
                  onChange={(event) => setEditor({ ...editor, body: event.target.value })}
                />
              )}
              <span className="field-hint">
                Заголовки: <code># Текст</code>. Выделение: <code>**жирный**</code>, <code>*курсив*</code>,{" "}
                <code>`код`</code>. Списки: <code>- пункт</code> или <code>1. пункт</code>. Ссылка:{" "}
                <code>[текст](https://…)</code>.
              </span>
            </div>
          ) : null}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setEditor(null)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {sections.length === 0 ? (
        <div className="panel empty-state">
          <h2 className="panel-title">Статей пока нет</h2>
          <p className="muted">
            {canEdit ? "Создайте первый раздел кнопкой выше." : "Администрация ещё не добавила материалы."}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="panel empty-state">
          <h2 className="panel-title">Ничего не найдено</h2>
          <p className="muted">Попробуйте другое слово.</p>
        </div>
      ) : (
        visible.map((section) => {
          const sectionIndex = sections.findIndex((entry) => entry.id === section.id);
          const allItems = sections[sectionIndex]?.items ?? [];
          return (
            <section key={section.id} className="panel faq-section">
              <div className="row faq-section-head">
                <h2 className="panel-title">{section.title}</h2>
                {canEdit && !searching ? (
                  <div className="row faq-controls">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-label="Поднять раздел"
                      disabled={pending || sectionIndex === 0}
                      onClick={() =>
                        void call({
                          action: "reorder-sections",
                          ids: move(sections, sectionIndex, -1).map((entry) => entry.id),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-label="Опустить раздел"
                      disabled={pending || sectionIndex === sections.length - 1}
                      onClick={() =>
                        void call({
                          action: "reorder-sections",
                          ids: move(sections, sectionIndex, 1).map((entry) => entry.id),
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setEditor({ kind: "section", id: section.id, title: section.title })}
                    >
                      Переименовать
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={pending}
                      onClick={() => {
                        void confirmDialog(`Убрать раздел «${section.title}» и его статьи (${allItems.length}) в архив?`, {
                          confirmLabel: "В архив",
                        }).then((ok) => {
                          if (ok) void call({ action: "archive-section", id: section.id });
                        });
                      }}
                    >
                      В архив
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setEditor({
                          kind: "item",
                          id: null,
                          sectionId: section.id,
                          title: "",
                          body: "",
                          preview: false,
                        })
                      }
                    >
                      Добавить статью
                    </button>
                  </div>
                ) : null}
              </div>

              {section.items.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  В разделе пока нет статей.
                </p>
              ) : (
                section.items.map((item) => {
                  const itemIndex = allItems.findIndex((entry) => entry.id === item.id);
                  return (
                    <details key={item.id} className="faq-item" open={searching}>
                      <summary>{item.title}</summary>
                      <Markdown source={item.body} />
                      {canEdit && !searching ? (
                        <div className="row faq-controls">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            aria-label="Поднять статью"
                            disabled={pending || itemIndex === 0}
                            onClick={() =>
                              void call({
                                action: "reorder-items",
                                sectionId: section.id,
                                ids: move(allItems, itemIndex, -1).map((entry) => entry.id),
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            aria-label="Опустить статью"
                            disabled={pending || itemIndex === allItems.length - 1}
                            onClick={() =>
                              void call({
                                action: "reorder-items",
                                sectionId: section.id,
                                ids: move(allItems, itemIndex, 1).map((entry) => entry.id),
                              })
                            }
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              setEditor({
                                kind: "item",
                                id: item.id,
                                sectionId: section.id,
                                title: item.title,
                                body: item.body,
                                preview: false,
                              })
                            }
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={pending}
                            onClick={() => {
                              void confirmDialog(`Убрать статью «${item.title}» в архив?`, { confirmLabel: "В архив" }).then((ok) => {
                                if (ok) void call({ action: "archive-item", id: item.id });
                              });
                            }}
                          >
                            В архив
                          </button>
                        </div>
                      ) : null}
                    </details>
                  );
                })
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
