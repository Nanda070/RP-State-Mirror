"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type RecoveryCard = {
  id: string;
  createdAt: string;
  newDiscordId: string;
  newLabel: string | null;
  oldDiscordId: string;
  oldLabel: string | null;
  characterName: string;
  staticId: string;
  reason: string;
  oldStillPresent: boolean;
  nameMatches: boolean;
  newCharacterCount: number;
  oldCharacters: { id: string; name: string; staticId: string }[];
  canApprove: boolean;
  blocker: string | null;
  ownRequest: boolean;
};

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="recovery-check" data-ok={ok ? "" : undefined}>
      <span aria-hidden>{ok ? "✓" : "!"}</span>
      <span>{children}</span>
    </li>
  );
}

export function RecoveryQueue({ cards }: { cards: RecoveryCard[] }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function decide(id: string, decision: "APPROVED" | "REJECTED", rejectionReason?: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/recovery/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: rejectionReason ?? null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError({ id, message: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setPendingId(null);
    }
  }

  if (cards.length === 0) {
    return (
      <div className="panel empty-state">
        <h2 className="panel-title">Новых заявок нет</h2>
        <p className="muted">Когда игрок подаст заявку, она появится здесь.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {cards.map((card) => {
        const busy = pendingId === card.id;
        return (
          <article key={card.id} className="panel recovery-card">
            <div className="row recovery-card-head">
              <h2 className="panel-title">
                {card.characterName} <span className="muted registry-mono">{card.staticId}</span>
              </h2>
              <span className="muted">{card.createdAt}</span>
            </div>

            <dl className="profile-facts recovery-facts">
              <div>
                <dt>Старый аккаунт</dt>
                <dd>
                  <span className="registry-mono">{card.oldDiscordId}</span>
                  {card.oldLabel ? ` · ${card.oldLabel}` : " · нет в снимке серверов"}
                </dd>
              </div>
              <div>
                <dt>Новый аккаунт</dt>
                <dd>
                  <span className="registry-mono">{card.newDiscordId}</span>
                  {card.newLabel ? ` · ${card.newLabel}` : " · нет в снимке серверов"}
                </dd>
              </div>
              <div>
                <dt>Причина</dt>
                <dd className="recovery-reason">{card.reason}</dd>
              </div>
            </dl>

            <ul className="recovery-checks">
              <Check ok={card.oldCharacters.some((character) => character.staticId === card.staticId)}>
                Статик {card.staticId} принадлежит старому аккаунту
              </Check>
              <Check ok={card.nameMatches}>Ник в заявке совпадает с персонажем</Check>
              <Check ok={!card.oldStillPresent}>
                {card.oldStillPresent
                  ? "Старый аккаунт всё ещё состоит на серверах — уточните, действительно ли он потерян"
                  : "Старого аккаунта нет на подключённых серверах"}
              </Check>
              <Check ok={card.newCharacterCount + card.oldCharacters.length <= 3}>
                Слоты: у нового аккаунта {card.newCharacterCount}, переносится {card.oldCharacters.length} (предел 3)
              </Check>
            </ul>

            {card.oldCharacters.length > 0 ? (
              <p className="muted recovery-moved">
                Будут перенесены:{" "}
                {card.oldCharacters.map((character) => `${character.name} (${character.staticId})`).join(", ")}
              </p>
            ) : null}

            {card.blocker ? <p className="form-error">Одобрить нельзя: {card.blocker}</p> : null}
            {card.ownRequest ? (
              <p className="form-error">Это ваша заявка — решение должен принять другой администратор.</p>
            ) : null}
            {error?.id === card.id ? (
              <p className="form-error" role="alert">
                {error.message}
              </p>
            ) : null}

            {rejecting === card.id ? (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide(card.id, "REJECTED", reason);
                }}
              >
                <div className="field">
                  <label htmlFor={`reject-${card.id}`}>Причина отказа (её увидит заявитель)</label>
                  <textarea
                    id={`reject-${card.id}`}
                    required
                    maxLength={1000}
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <div className="row">
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    {busy ? "Отправка…" : "Отклонить заявку"}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRejecting(null)}>
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !card.canApprove || card.ownRequest}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Перенести персонажей (${card.oldCharacters.length}) на аккаунт ${card.newDiscordId}? Действие нельзя отменить одной кнопкой.`,
                      )
                    ) {
                      void decide(card.id, "APPROVED");
                    }
                  }}
                >
                  {busy ? "Перенос…" : "Одобрить и перенести"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || card.ownRequest}
                  onClick={() => {
                    setReason("");
                    setRejecting(card.id);
                  }}
                >
                  Отклонить
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
