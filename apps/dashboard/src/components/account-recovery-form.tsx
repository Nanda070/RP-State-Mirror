"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountRecoveryForm({ newDiscordId }: { newDiscordId: string }) {
  const router = useRouter();
  const [oldDiscordId, setOldDiscordId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [staticId, setStaticId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldDiscordId, characterName, staticId, reason }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось подать заявку");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подать заявку");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <h2 className="panel-title">Новая заявка</h2>
      <div className="form-grid-3">
        <div className="field">
          <label htmlFor="recoveryNew">Новый аккаунт (текущий)</label>
          <input id="recoveryNew" value={newDiscordId} readOnly disabled />
        </div>
        <div className="field">
          <label htmlFor="recoveryOld">Старый Discord ID</label>
          <input
            id="recoveryOld"
            required
            inputMode="numeric"
            pattern="\d{17,20}"
            title="Число из 17–20 цифр"
            placeholder="Например, 123456789012345678"
            value={oldDiscordId}
            onChange={(event) => setOldDiscordId(event.target.value.trim())}
          />
          <span className="field-hint">
            Не ник, а числовой ID. Его можно найти в старых сообщениях: ПКМ по профилю → «Копировать ID
            пользователя».
          </span>
        </div>
        <div className="field">
          <label htmlFor="recoveryStatic">Статик персонажа</label>
          <input
            id="recoveryStatic"
            required
            maxLength={32}
            value={staticId}
            onChange={(event) => setStaticId(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="recoveryName">Ник персонажа</label>
        <input
          id="recoveryName"
          required
          maxLength={128}
          placeholder="Имя Фамилия"
          value={characterName}
          onChange={(event) => setCharacterName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="recoveryReason">Причина</label>
        <textarea
          id="recoveryReason"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          placeholder="Что случилось со старым аккаунтом и чем вы можете подтвердить, что он ваш"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginTop: "0.75rem" }}>
        {pending ? "Отправка…" : "Подать заявку"}
      </button>
    </form>
  );
}
