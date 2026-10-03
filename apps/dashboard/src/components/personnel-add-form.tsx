"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = [
  { value: "promotion", label: "Повышение" },
  { value: "dismissal", label: "Увольнение" },
  { value: "transfer", label: "Перевод по отделу" },
  { value: "reinstatement", label: "Восстановление" },
  { value: "appointment", label: "Назначение" },
] as const;
type EventType = (typeof TYPES)[number]["value"];

/** New personnel event from the dashboard — the same record and the same notice as `/кадровый-аудит`. */
export function PersonnelAddForm({ factions }: { factions: { code: string; name: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<EventType>("promotion");
  const [factionCode, setFactionCode] = useState(factions[0]?.code ?? "");
  const [subjectDiscordId, setSubjectDiscordId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [fromRank, setFromRank] = useState("");
  const [toRank, setToRank] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const textLabel: Record<EventType, string> = {
    promotion: "Комментарий (необязательно)",
    dismissal: "Причина увольнения",
    transfer: "Отдел назначения",
    reinstatement: "Комментарий (необязательно)",
    appointment: "Должность",
  };
  const textRequired = type === "dismissal" || type === "transfer" || type === "appointment";

  function details(): Record<string, unknown> {
    const value = text.trim();
    switch (type) {
      case "promotion":
        return {
          ...(fromRank ? { fromRank: Number(fromRank) } : {}),
          toRank: Number(toRank),
          ...(value ? { comment: value } : {}),
        };
      case "dismissal":
        return { reason: value };
      case "transfer":
        return { toDepartment: value };
      case "reinstatement":
        return value ? { comment: value } : {};
      case "appointment":
        return { position: value };
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, factionCode, subjectDiscordId: subjectDiscordId.trim(), subjectName, details: details() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({ ok: true, text: data.message ?? "Событие создано." });
      setSubjectDiscordId("");
      setSubjectName("");
      setFromRank("");
      setToRank("");
      setText("");
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="panel registry-add">
      <summary>Добавить событие</summary>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="peType">Событие</label>
            <select id="peType" value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="peFaction">Фракция</label>
            <select id="peFaction" required value={factionCode} onChange={(e) => setFactionCode(e.target.value)}>
              {factions.map((faction) => (
                <option key={faction.code} value={faction.code}>
                  {faction.code} — {faction.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="peName">Имя сотрудника</label>
            <input id="peName" required maxLength={128} value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="peDiscord">Discord ID сотрудника</label>
            <input
              id="peDiscord"
              required
              inputMode="numeric"
              pattern="\d{17,20}"
              placeholder="17–20 цифр"
              value={subjectDiscordId}
              onChange={(e) => setSubjectDiscordId(e.target.value)}
            />
          </div>
          {type === "promotion" ? (
            <>
              <div className="field">
                <label htmlFor="peFrom">С ранга</label>
                <input id="peFrom" type="number" min={1} value={fromRank} onChange={(e) => setFromRank(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="peTo">На ранг</label>
                <input id="peTo" type="number" min={1} required value={toRank} onChange={(e) => setToRank(e.target.value)} />
              </div>
            </>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="peText">{textLabel[type]}</label>
          <input id="peText" required={textRequired} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending || factions.length === 0}>
          {pending ? "Сохранение…" : "Создать и опубликовать"}
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
