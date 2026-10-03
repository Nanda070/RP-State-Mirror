"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { TableTab } from "@/lib/tables";
import { EmptyState } from "../ui";
import { NameDialog, tablesApi } from "./shared";

/**
 * The «Таблицы» page: the list of tables, no previews. A table opens on its own page.
 * «Админ» and above also create tables, load them from files and set their order here.
 */
export function TablesList({
  tables,
  canEdit,
  editors,
}: {
  tables: TableTab[];
  canEdit: boolean;
  /** Table id → who is editing it now. */
  editors: Record<string, string>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await run();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  }

  /** A new table from a file: it is named after the file. */
  async function importFile(file: File) {
    await act(async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/tables/import", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!res.ok || !data.slug) throw new Error(data.error ?? "Не удалось загрузить файл.");
      router.push(`/tables/${data.slug}`);
      router.refresh();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = tables.map((table) => table.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    ids.splice(target, 0, ...ids.splice(index, 1));
    void act(async () => {
      await tablesApi("/api/tables/order", { method: "POST", body: JSON.stringify({ ids }) });
      router.refresh();
    });
  }

  return (
    <div className="stack tables-index">
      <div className="section-head tables-index-head">
        <h1>Таблицы</h1>
        {canEdit ? (
          <div className="row u-gap2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setCreating(true)}>
              Новая таблица
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              Загрузить .xlsx
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="form-error" role="alert">
          {notice}
        </p>
      ) : null}

      {tables.length === 0 ? (
        <div className="panel">
          <EmptyState icon="form" title="Таблиц пока нет" />
        </div>
      ) : (
        <ul className="tables-list">
          {tables.map((table, index) => (
            <li key={table.id} className="tables-list-item">
              <Link href={`/tables/${table.slug}`} className="tables-list-link">
                <span className="tables-list-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M4 10h16M4 14.5h16M10 5v14" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </span>
                <span className="tables-list-title">{table.title}</span>
                <span className="tables-list-meta">
                  {editors[table.id] ? `Редактирует: ${editors[table.id]}` : `Изменена ${table.updatedAt}`}
                </span>
              </Link>
              {canEdit && tables.length > 1 ? (
                <span className="tables-list-order">
                  <button
                    type="button"
                    className="icon-action"
                    title="Выше"
                    aria-label={`Поднять «${table.title}»`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                      <path d="m6 14 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    title="Ниже"
                    aria-label={`Опустить «${table.title}»`}
                    disabled={busy || index === tables.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                      <path d="m6 10 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NameDialog
          heading="Новая таблица"
          initialTitle=""
          initialSlug={null}
          submitLabel="Создать"
          onClose={() => setCreating(false)}
          onSubmit={async (title) => {
            const created = await tablesApi<{ slug: string }>("/api/tables", { method: "POST", body: JSON.stringify({ title }) });
            setCreating(false);
            router.push(`/tables/${created.slug}`);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
