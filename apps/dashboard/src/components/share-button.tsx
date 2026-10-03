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
      <button
        type="button"
        className="icon-action"
        data-on={link ? "" : undefined}
        disabled={pending}
        title={link ? "Скопировать публичную ссылку" : "Поделиться: создать публичную ссылку"}
        aria-label={link ? "Скопировать публичную ссылку" : "Поделиться"}
        onClick={() => void share()}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
          <path
            d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {link ? (
        <button
          type="button"
          className="icon-action"
          disabled={pending}
          title="Отозвать ссылку"
          aria-label="Отозвать ссылку"
          onClick={() => void revoke()}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
            <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
      {note ? (
        <span className="share-note" role="status">
          {note}
        </span>
      ) : null}
    </div>
  );
}
