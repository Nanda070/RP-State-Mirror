"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { confirmDialog } from "@/lib/confirm";
import type { TableTab } from "@/lib/tables";
import { EmptyState, MoreMenu } from "../ui";
import { AccessDialog, type AllowedUser } from "./access-dialog";
import { Modal, NameDialog, tablesApi } from "./shared";
import type { SheetEditorHandle, SheetSnapshot } from "./sheet-editor";

const loadEditor = () => import("./sheet-editor");
const SheetEditor = dynamic(() => loadEditor().then((mod) => mod.SheetEditor), {
  ssr: false,
  loading: () => <p className="muted sheet-loading">Загрузка таблицы…</p>,
});

const AUTOSAVE_MS = 2500;
const LOCK_PING_MS = 45_000;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type Revision = { id: string; version: number; reason: string; author: string; at: string };

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "Есть несохранённые правки",
  saving: "Сохраняется…",
  saved: "Сохранено",
  error: "Не сохранено",
};

const closeMenu = (event: MouseEvent<HTMLElement>) => event.currentTarget.closest("details")?.removeAttribute("open");

/**
 * One table on its own page. Everyone sees it read-only; «Админ» and above get «Редактировать»
 * and the table's settings (name, history, archive) in the same bar.
 */
export function TablesWorkspace({
  current,
  canEdit,
  otherEditor,
  allowed,
}: {
  current: TableTab;
  canEdit: boolean;
  /** Who is editing this table now, when it is someone else. */
  otherEditor: string | null;
  /** People the table is open to when its access is «по списку»; for admins. */
  allowed: AllowedUser[];
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SheetSnapshot | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [mountKey, setMountKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "history" | "access" | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);

  const handleRef = useRef<SheetEditorHandle | null>(null);
  const versionRef = useRef(current.version);
  const dirtyRef = useRef(false);
  /** The workbook as the server has it, serialized: a save that would change nothing is not sent. */
  const savedJsonRef = useRef<string | null>(null);
  /** Whether this editing session has stored anything: then «Готово» leaves a revision. */
  const storedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const currentId = current.id;
  const currentVersion = current.version;

  // The workbook. A versioned address is cached by the browser for good.
  useEffect(() => {
    let cancelled = false;
    void loadEditor();
    setSnapshot(null);
    setNotice(null);
    tablesApi<{ version: number; snapshot: SheetSnapshot }>(`/api/tables/${currentId}/snapshot?v=${currentVersion}`)
      .then((data) => {
        if (cancelled) return;
        versionRef.current = data.version;
        setSnapshot(data.snapshot);
        setMountKey((key) => key + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Не удалось загрузить таблицу.");
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, currentVersion]);

  const save = useCallback(
    async (checkpoint: boolean) => {
      // One save at a time: the next one starts from the version the previous one produced.
      while (savingRef.current) await savingRef.current.catch(() => undefined);
      const workbook = handleRef.current?.save();
      if (!workbook) return;
      const json = JSON.stringify(workbook);
      dirtyRef.current = false;
      if (json === savedJsonRef.current && !(checkpoint && storedRef.current)) {
        setSaveState(storedRef.current ? "saved" : "idle");
        return;
      }
      setSaveState("saving");
      const run = tablesApi<{ version: number }>(`/api/tables/${currentId}/snapshot`, {
        method: "PUT",
        body: JSON.stringify({ snapshot: workbook, baseVersion: versionRef.current, checkpoint }),
      }).then((data) => {
        versionRef.current = data.version;
        savedJsonRef.current = json;
        storedRef.current = true;
        setSaveState(dirtyRef.current ? "dirty" : "saved");
      });
      savingRef.current = run;
      try {
        await run;
        setNotice(null);
      } catch (error) {
        dirtyRef.current = true;
        setSaveState("error");
        setNotice(error instanceof Error ? error.message : "Не удалось сохранить таблицу.");
        throw error;
      } finally {
        savingRef.current = null;
      }
    },
    [currentId],
  );

  const onSettled = useCallback(() => {
    const workbook = handleRef.current?.save();
    if (workbook) savedJsonRef.current = JSON.stringify(workbook);
  }, []);

  const onDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState((state) => (state === "saving" ? state : "dirty"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(false).catch(() => undefined), AUTOSAVE_MS);
  }, [save]);

  // While the editor is open the lock is kept alive; losing it ends the session.
  useEffect(() => {
    if (mode !== "edit") return;
    const timer = setInterval(() => {
      tablesApi<{ ok: boolean; holder?: string }>(`/api/tables/${currentId}/lock`, {
        method: "POST",
        body: JSON.stringify({ action: "acquire" }),
      })
        .then((lock) => {
          if (!lock.ok) setNotice(`Редактирование перешло к: ${lock.holder ?? "другому администратору"}. Ваши правки больше не сохраняются.`);
        })
        .catch(() => undefined);
    }, LOCK_PING_MS);
    return () => clearInterval(timer);
  }, [mode, currentId]);

  // Leaving with unsaved edits: the browser asks first.
  useEffect(() => {
    if (mode !== "edit") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mode]);

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

  async function startEditing() {
    await act(async () => {
      const lock = await tablesApi<{ ok: boolean; holder?: string }>(`/api/tables/${currentId}/lock`, {
        method: "POST",
        body: JSON.stringify({ action: "acquire" }),
      });
      if (!lock.ok) throw new Error(`Сейчас редактирует: ${lock.holder ?? "другой администратор"}.`);
      // Always from the freshest workbook, not from what this page loaded earlier.
      const data = await tablesApi<{ version: number; snapshot: SheetSnapshot }>(`/api/tables/${currentId}/snapshot`);
      versionRef.current = data.version;
      dirtyRef.current = false;
      savedJsonRef.current = null;
      storedRef.current = false;
      setSnapshot(data.snapshot);
      setSaveState("idle");
      setMode("edit");
      setMountKey((key) => key + 1);
    });
  }

  async function finishEditing() {
    setBusy(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const workbook = handleRef.current?.save() ?? null;
      await save(true);
      await tablesApi(`/api/tables/${currentId}/lock`, { method: "POST", body: JSON.stringify({ action: "release" }) });
      if (workbook) setSnapshot(workbook);
      setMode("view");
      setSaveState("idle");
      setMountKey((key) => key + 1);
      router.refresh();
    } catch {
      // The reason is already on screen; the editor stays open so nothing is lost.
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!(await confirmDialog(`Убрать таблицу «${current.title}» в архив? Она исчезнет из списка; данные сохранятся.`, { confirmLabel: "В архив" }))) return;
    await act(async () => {
      await tablesApi(`/api/tables/${currentId}`, { method: "PATCH", body: JSON.stringify({ action: "archive" }) });
      router.push("/tables");
      router.refresh();
    });
  }

  async function openHistory() {
    setRevisions(null);
    setDialog("history");
    await act(async () => {
      const data = await tablesApi<{ revisions: Revision[] }>(`/api/tables/${currentId}/revisions`);
      setRevisions(data.revisions);
    });
  }

  async function restore(revision: Revision) {
    if (!(await confirmDialog(`Вернуть таблицу к версии от ${revision.at}? Нынешнее состояние останется в истории.`, { confirmLabel: "Вернуть", danger: false }))) return;
    await act(async () => {
      await tablesApi(`/api/tables/${currentId}/revisions`, { method: "POST", body: JSON.stringify({ revisionId: revision.id }) });
      setDialog(null);
      router.refresh();
    });
  }

  const editing = mode === "edit";

  return (
    <div className="tables-page" data-editing={editing ? "" : undefined}>
      <div className="tables-bar">
        <div className="tables-heading">
          {editing ? (
            <span className="tables-back" aria-disabled>
              ← Таблицы
            </span>
          ) : (
            <Link href="/tables" className="tables-back">
              ← Таблицы
            </Link>
          )}
          <h1 className="tables-title">{current.title}</h1>
          {canEdit && current.access !== "PUBLIC" ? (
            <span className="registry-status" data-status={current.access === "ADMINS" ? "bad" : "warn"}>
              {current.access === "ADMINS" ? "Закрытая" : "По списку"}
            </span>
          ) : null}
        </div>

        {canEdit ? (
          <div className="tables-actions">
            {editing ? (
              <span className="tables-save" data-state={saveState} role="status">
                {SAVE_LABEL[saveState]}
              </span>
            ) : otherEditor ? (
              <span className="tables-save" role="status">
                Редактирует: {otherEditor}
              </span>
            ) : null}
            {editing ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finishEditing()}>
                Готово
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={busy || !snapshot} onClick={() => void startEditing()}>
                  Редактировать
                </button>
                <MoreMenu label="Настройки таблицы">
                  <button
                    type="button"
                    onClick={(event) => {
                      closeMenu(event);
                      setDialog("rename");
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      closeMenu(event);
                      setDialog("access");
                    }}
                  >
                    Доступ
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      closeMenu(event);
                      void openHistory();
                    }}
                  >
                    История версий
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={(event) => {
                      closeMenu(event);
                      void archive();
                    }}
                  >
                    В архив
                  </button>
                </MoreMenu>
              </>
            )}
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="form-error tables-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="tables-stage">
        {snapshot ? (
          <SheetEditor
            key={`${currentId}:${mode}:${mountKey}`}
            documentId={currentId}
            snapshot={snapshot}
            mode={mode}
            onDirty={onDirty}
            onSettled={onSettled}
            handleRef={handleRef}
          />
        ) : notice ? null : (
          <p className="muted sheet-loading">Загрузка таблицы…</p>
        )}
      </div>

      {dialog === "rename" ? (
        <NameDialog
          heading="Переименовать таблицу"
          initialTitle={current.title}
          initialSlug={current.slug}
          submitLabel="Сохранить"
          onClose={() => setDialog(null)}
          onSubmit={async (title, slug) => {
            const renamed = await tablesApi<{ slug: string }>(`/api/tables/${currentId}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "rename", title, slug }),
            });
            setDialog(null);
            router.replace(`/tables/${renamed.slug}`);
            router.refresh();
          }}
        />
      ) : null}

      {dialog === "access" ? (
        <AccessDialog
          documentId={currentId}
          initialAccess={current.access}
          initialAllowed={allowed}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog === "history" ? (
        <Modal heading="История версий" onClose={() => setDialog(null)}>
          {revisions === null ? (
            <p className="muted u-m0">Загрузка…</p>
          ) : revisions.length === 0 ? (
            <EmptyState icon="inbox" title="Версий пока нет" />
          ) : (
            <ul className="revision-list">
              {revisions.map((revision, position) => (
                <li key={revision.id}>
                  <div>
                    <strong>{revision.at}</strong>
                    <span className="muted">
                      {revision.reason} · {revision.author}
                    </span>
                  </div>
                  {position === 0 ? (
                    <span className="registry-status" data-status="ok">
                      Текущая
                    </span>
                  ) : (
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void restore(revision)}>
                      Вернуть
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
