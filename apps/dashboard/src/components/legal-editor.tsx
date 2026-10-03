"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type LegalDocState = {
  kind: string;
  title: string;
  /** Published text, or empty when the built-in one is shown. */
  body: string;
  version: string | null;
  history: { version: string; createdAt: string; author: string; active: boolean }[];
};

/** Editor of the three legal texts: publish a new edition, see the history, return to the built-in text. */
export function LegalEditor({ documents }: { documents: LegalDocState[] }) {
  const router = useRouter();
  const [kind, setKind] = useState(documents[0]?.kind ?? "terms");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(documents.map((document) => [document.kind, document.body])),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const current = documents.find((document) => document.kind === kind);
  if (!current) return null;

  async function send(method: "POST" | "DELETE") {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/legal", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "POST" ? { kind, body: drafts[kind] ?? "" } : { kind }),
      });
      const data = (await res.json()) as { error?: string; version?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({
        ok: true,
        text: method === "POST" ? `Опубликована редакция ${data.version}.` : "Страница снова показывает встроенный текст.",
      });
      if (method === "DELETE") setDrafts((prev) => ({ ...prev, [kind]: "" }));
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Юридические тексты</h2>
      <div className="field">
        <label htmlFor="legalKind">Страница</label>
        <select
          id="legalKind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setMessage(null);
          }}
        >
          {documents.map((document) => (
            <option key={document.kind} value={document.kind}>
              {document.title} — {document.version ? `редакция ${document.version}` : "встроенный текст"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="legalBody">Текст (Markdown)</label>
        <textarea
          id="legalBody"
          rows={16}
          maxLength={60000}
          placeholder="Пока поле пустое, страница показывает встроенный текст."
          value={drafts[kind] ?? ""}
          onChange={(event) => setDrafts((prev) => ({ ...prev, [kind]: event.target.value }))}
        />
        <span className="field-hint">
          После публикации пользователи увидят просьбу принять новую редакцию, а уведомление о cookie появится снова.
        </span>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void send("POST")}>
          {pending ? "Отправка…" : "Опубликовать редакцию"}
        </button>
        {current.version ? (
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => void send("DELETE")}>
            Вернуть встроенный текст
          </button>
        ) : null}
        <a className="btn btn-ghost" href={`/${kind}`} target="_blank" rel="noreferrer">
          Открыть страницу
        </a>
      </div>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
      {current.history.length > 0 ? (
        <div className="registry-table-wrap" style={{ marginTop: "1rem" }}>
          <table className="registry-table">
            <thead>
              <tr>
                <th>Редакция</th>
                <th>Опубликована</th>
                <th>Кем</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {current.history.map((row) => (
                <tr key={row.version}>
                  <td className="registry-mono">{row.version}</td>
                  <td className="nowrap">{row.createdAt}</td>
                  <td>{row.author}</td>
                  <td>
                    <span className="registry-status" data-status={row.active ? "ok" : "muted"}>
                      {row.active ? "Действует" : "В истории"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Data-erasure request: replaces the person's Discord id everywhere and removes their files. */
export function AnonymizeForm() {
  const [discordId, setDiscordId] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId: discordId.trim() }),
      });
      const data = (await res.json()) as { error?: string; pseudonym?: string; rows?: number; filesErased?: number };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({
        ok: true,
        text: `Готово: записи переписаны на «${data.pseudonym}» (изменено строк: ${data.rows}), файлов удалено: ${data.filesErased}.`,
      });
      setDiscordId("");
      setConfirm("");
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <h2 className="panel-title">Обезличивание по запросу</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Discord ID человека заменяется случайным псевдонимом во всех записях, ник, аватар, IP и устройство
        стираются, приложенные файлы удаляются из хранилища. Записи реестров, имена персонажей и статики остаются.
        Отменить нельзя. Человек не должен состоять на серверах проекта.
      </p>
      <div className="form-grid-3">
        <div className="field">
          <label htmlFor="anonId">Discord ID</label>
          <input
            id="anonId"
            required
            inputMode="numeric"
            pattern="\d{17,20}"
            placeholder="17–20 цифр"
            value={discordId}
            onChange={(event) => setDiscordId(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="anonConfirm">Введите ID ещё раз</label>
          <input id="anonConfirm" required inputMode="numeric" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </div>
      </div>
      <button type="submit" className="btn btn-danger" disabled={pending || !discordId.trim() || discordId.trim() !== confirm.trim()}>
        {pending ? "Выполняется…" : "Обезличить"}
      </button>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

/** Titles shown in profiles instead of the access level name. */
export function AdminPositionsForm({ initial }: { initial: { discordId: string; title: string; label: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.map((row) => ({ discordId: row.discordId, title: row.title, label: row.label })));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "admins.positions": rows
            .map((row) => ({ discordId: row.discordId.trim(), title: row.title.trim() }))
            .filter((row) => row.discordId && row.title),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setMessage({ ok: true, text: "Сохранено" });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Должности</h2>
      {rows.map((row, index) => (
        <div key={index} className="position-row">
          <div className="field">
            <label htmlFor={`posId${index}`}>Discord ID{row.label ? ` · ${row.label}` : ""}</label>
            <input
              id={`posId${index}`}
              inputMode="numeric"
              placeholder="17–20 цифр"
              value={row.discordId}
              onChange={(event) =>
                setRows((prev) => prev.map((entry, i) => (i === index ? { ...entry, discordId: event.target.value, label: "" } : entry)))
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`posTitle${index}`}>Должность</label>
            <input
              id={`posTitle${index}`}
              maxLength={64}
              placeholder="Например, Куратор фракций"
              value={row.title}
              onChange={(event) =>
                setRows((prev) => prev.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)))
              }
            />
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}>
            Убрать
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={() => setRows((prev) => [...prev, { discordId: "", title: "", label: "" }])}>
          Добавить должность
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
