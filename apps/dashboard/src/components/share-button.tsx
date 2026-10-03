"use client";

import { confirmDialog } from "@/lib/confirm";
import { useState } from "react";

type ShareLink = { id: string; token: string };

/** «Поделиться» in a registry row: creates the public link, copies it, and lets an admin revoke it. */
export function ShareButton({
  entityType,
  entityId,
  initialLink,
}: {
  entityType: "wanted" | "ic_blacklist" | "fine" | "document" | "registration";
  entityId: string;
  initialLink: ShareLink | null;
}) {
  const [link, setLink] = useState(initialLink);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function copy(target: ShareLink) {
    const url = `${window.location.origin}/s/${target.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("Ссылка скопирована");
    } catch {
      // Clipboard access can be denied; show the link so it can be copied by hand.
      setNote(url);
    }
  }

  async function share() {
    setPending(true);
    setNote(null);
    try {
      let current = link;
      if (!current) {
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityId }),
        });
        const data = (await res.json()) as { error?: string; link?: ShareLink };
        if (!res.ok || !data.link) throw new Error(data.error ?? "Не удалось создать ссылку");
        current = data.link;
        setLink(current);
      }
      await copy(current);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Не удалось создать ссылку");
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    if (!link || !(await confirmDialog("Отозвать ссылку? По ней больше ничего не откроется.", { confirmLabel: "Отозвать" }))) return;
    setPending(true);
    setNote(null);
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: link.id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось отозвать ссылку");
      setLink(null);
      setNote("Ссылка отозвана");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Не удалось отозвать ссылку");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="share-cell">
      <div className="row share-actions">
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void share()}>
          {link ? "Скопировать ссылку" : "Поделиться"}
        </button>
        {link ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void revoke()}>
            Отозвать
          </button>
        ) : null}
      </div>
      {note ? (
        <span className="share-note" role="status">
          {note}
        </span>
      ) : null}
    </div>
  );
}
