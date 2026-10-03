"use client";

import { confirmDialog } from "@/lib/confirm";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

export type CatalogModel = {
  id: string;
  name: string;
  brand: string | null;
  year: number | null;
  imageFileId: string | null;
};

type Draft = { id: string | null; name: string; brand: string; year: string; removeImage: boolean };

const EMPTY_DRAFT: Draft = { id: null, name: "", brand: "", year: "", removeImage: false };

export function VehicleCatalog({ models, canEdit }: { models: CatalogModel[]; canEdit: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const brands = useMemo(
    () =>
      [...new Set(models.map((model) => model.brand).filter((value): value is string => Boolean(value)))].sort(
        (a, b) => a.localeCompare(b, "ru"),
      ),
    [models],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (model) =>
        (!brand || model.brand === brand) &&
        (!q || model.name.toLowerCase().includes(q) || (model.brand ?? "").toLowerCase().includes(q)),
    );
  }, [models, query, brand]);

  async function copyName(model: CatalogModel) {
    try {
      await navigator.clipboard.writeText(model.name);
      setCopiedId(model.id);
      setTimeout(() => setCopiedId((current) => (current === model.id ? null : current)), 1500);
    } catch {
      setError("Не удалось скопировать: браузер запретил доступ к буферу обмена.");
    }
  }

  function startEdit(model: CatalogModel) {
    setError(null);
    setDraft({
      id: model.id,
      name: model.name,
      brand: model.brand ?? "",
      year: model.year ? String(model.year) : "",
      removeImage: false,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("name", draft.name);
      body.set("brand", draft.brand);
      body.set("year", draft.year);
      if (draft.removeImage) body.set("removeImage", "1");
      const file = fileRef.current?.files?.[0];
      if (file) body.set("image", file);
      const res = await fetch(draft.id ? `/api/catalog/${draft.id}` : "/api/catalog", {
        method: draft.id ? "PATCH" : "POST",
        body,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  }

  async function archive(model: CatalogModel) {
    if (!(await confirmDialog(`Убрать «${model.name}» из каталога? Запись уйдёт в архив.`, { confirmLabel: "В архив" }))) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/${model.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      if (draft?.id === model.id) setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  const editing = draft?.id ? models.find((model) => model.id === draft.id) : undefined;

  return (
    <div className="stack">
      <div className="panel catalog-toolbar">
        <div className="field catalog-search">
          <label htmlFor="catalogSearch">Поиск</label>
          <input
            id="catalogSearch"
            type="search"
            placeholder="Название или марка"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="catalogBrand">Марка</label>
          <select id="catalogBrand" value={brand} onChange={(event) => setBrand(event.target.value)}>
            <option value="">Все марки</option>
            {brands.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              setDraft(EMPTY_DRAFT);
            }}
          >
            Добавить модель
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {canEdit && draft ? (
        <form className="panel" onSubmit={(event) => void save(event)}>
          <h2 className="panel-title">{draft.id ? "Изменить модель" : "Новая модель"}</h2>
          <div className="form-grid-3">
            <div className="field">
              <label htmlFor="modelName">Название</label>
              <input
                id="modelName"
                required
                maxLength={128}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="modelBrand">Марка</label>
              <input
                id="modelBrand"
                maxLength={64}
                list="catalogBrands"
                value={draft.brand}
                onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
              />
              <datalist id="catalogBrands">
                {brands.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="modelYear">Год</label>
              <input
                id="modelYear"
                type="number"
                min={1900}
                max={new Date().getFullYear() + 1}
                value={draft.year}
                onChange={(event) => setDraft({ ...draft, year: event.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="modelImage">Фото (PNG, JPEG, WEBP или GIF, до 10 МБ)</label>
            <input
              id="modelImage"
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={() => setDraft({ ...draft, removeImage: false })}
            />
            {editing?.imageFileId ? (
              <label className="chip-check">
                <input
                  type="checkbox"
                  checked={draft.removeImage}
                  onChange={(event) => setDraft({ ...draft, removeImage: event.target.checked })}
                />
                Убрать текущее фото
              </label>
            ) : null}
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setDraft(null)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {models.length === 0 ? (
        <div className="panel empty-state">
          <h2 className="panel-title">Каталог пока пуст</h2>
          <p className="muted">
            {canEdit
              ? "Добавьте первую модель кнопкой выше."
              : "Администрация ещё не добавила модели. Загляните позже."}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="panel empty-state">
          <h2 className="panel-title">Ничего не найдено</h2>
          <p className="muted">Измените запрос или сбросьте фильтр по марке.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {visible.map((model) => (
            <article key={model.id} className="catalog-card">
              <div className="catalog-card-media">
                {model.imageFileId ? (
                  <img src={`/api/media/${model.imageFileId}`} alt={model.name} loading="lazy" />
                ) : (
                  <span className="muted">Нет фото</span>
                )}
              </div>
              <div className="catalog-card-body">
                <h3 className="catalog-card-title">{model.name}</h3>
                <p className="muted catalog-card-meta">
                  {[model.brand, model.year].filter(Boolean).join(" · ") || "Марка не указана"}
                </p>
                <div className="row catalog-card-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => void copyName(model)}>
                    {copiedId === model.id ? "Скопировано" : "Скопировать"}
                  </button>
                  {canEdit ? (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={() => startEdit(model)}>
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => void archive(model)}
                      >
                        В архив
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
