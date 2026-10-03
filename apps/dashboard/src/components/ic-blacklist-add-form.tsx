"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** New IC blacklist record from the dashboard; unlike `/чс-гос`, an end date can be set. */
export function IcBlacklistAddForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [staticId, setStaticId] = useState("");
  const [reason, setReason] = useState("");
  const [forumLink, setForumLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/registry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          staticId,
          reason,
          forumLink,
          // The field holds a calendar day: the record ends at the end of that day in Moscow.
          ...(expiresAt ? { expiresAt: `${expiresAt}T23:59:59+03:00` } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({ ok: true, text: data.message ?? "Запись создана." });
      setFullName("");
      setStaticId("");
      setReason("");
      setForumLink("");
      setExpiresAt("");
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="panel registry-add">
      <summary>Добавить запись</summary>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="blFullName">ФИО</label>
            <input id="blFullName" required maxLength={128} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="blStatic">Паспорт (статик)</label>
            <input id="blStatic" required maxLength={32} value={staticId} onChange={(e) => setStaticId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="blExpires">Действует до (пусто — бессрочно)</label>
            <input id="blExpires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="blReason">Причина</label>
          <textarea id="blReason" required rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="blForum">Ссылка на форум</label>
          <input
            id="blForum"
            type="url"
            required
            maxLength={1000}
            placeholder="https://"
            value={forumLink}
            onChange={(e) => setForumLink(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : "Внести в чёрный список"}
        </button>
        {message ? (
          <p className={message.ok ? "form-ok" : "form-error"} role="status">
            {message.text}
          </p>
        ) : null}
      </form>
    </details>
  );
}
