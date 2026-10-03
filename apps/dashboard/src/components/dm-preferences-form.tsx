"use client";

import { useState } from "react";
import { ToggleRow } from "./toggle-row";

type Kind = { key: string; label: string };

/** Which direct messages the bot sends to this person. A switch that is on means «send». */
export function DmPreferencesForm({ kinds, initialMuted }: { kinds: Kind[]; initialMuted: string[] }) {
  const [muted, setMuted] = useState(initialMuted);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: string[]) {
    const previous = muted;
    setMuted(next);
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ muted: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; muted?: string[] };
      if (!res.ok || !data.muted) throw new Error(data.error ?? "Не удалось сохранить");
      setMuted(data.muted);
      setMessage({ ok: true, text: "Сохранено" });
    } catch (e) {
      setMuted(previous);
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Не удалось сохранить" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dm-prefs">
      {kinds.map((kind) => (
        <ToggleRow
          key={kind.key}
          id={`dm-${kind.key}`}
          label={kind.label}
          disabled={pending}
          checked={!muted.includes(kind.key)}
          onChange={(checked) => void save(checked ? muted.filter((key) => key !== kind.key) : [...muted, kind.key])}
        />
      ))}
      {message ? (
        <p className={message.ok ? "form-ok" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
