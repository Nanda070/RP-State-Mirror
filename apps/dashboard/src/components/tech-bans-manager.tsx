"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type TechBanRow = {
  id: string;
  kind: "DISCORD" | "STATIC";
  value: string;
  subjectLabel: string;
  reason: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
};

export function TechBansManager({ bans }: { bans: TechBanRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"DISCORD" | "STATIC">("DISCORD");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function request(method: "POST" | "DELETE", body: Record<string, string>, okText: string) {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bans", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setMessage({ ok: true, text: okText });
      router.refresh();
      return true;
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
      return false;
    } finally {
      setPending(false);
    }
  }

  const active = bans.filter((ban) => ban.active);
  const history = bans.filter((ban) => !ban.active);

  return (
    <div className="stack">
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          void request("POST", { kind, value: value.trim(), reason }, "Бан выдан.").then((ok) => {
            if (ok) {
              setValue("");
              setReason("");
            }
          });
        }}
      >
        <h2 className="panel-title">Выдать бан</h2>
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="banKind">Что блокируем</label>
            <select id="banKind" value={kind} onChange={(event) => setKind(event.target.value as "DISCORD" | "STATIC")}>
              <option value="DISCORD">Discord-аккаунт</option>
              <option value="STATIC">Статик персонажа</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="banValue">{kind === "DISCORD" ? "Discord ID" : "Статик"}</label>
            <input
              id="banValue"
              required
              maxLength={64}
              inputMode={kind === "DISCORD" ? "numeric" : "text"}
              placeholder={kind === "DISCORD" ? "17–20 цифр" : "Например, 391200"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="banReason">Причина</label>
            <input
              id="banReason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
        <p className="field-hint">
          {kind === "DISCORD"
            ? "Аккаунт не сможет пользоваться командами и кнопками бота и входить на сайт; открытые сессии завершатся сразу."
            : "Заявки с этим статиком (нашивка, регистрации, перевод) будут отклоняться."}
        </p>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? "Отправка…" : "Забанить"}
        </button>
        {message ? (
          <p className={message.ok ? "form-ok" : "form-error"} role="status">
            {message.text}
          </p>
        ) : null}
      </form>

      <div className="panel">
        <h2 className="panel-title">Действующие баны ({active.length})</h2>
        {active.length === 0 ? (
          <p className="muted">Действующих банов нет.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Кого</th>
                  <th>Причина</th>
                  <th>Выдал</th>
                  <th>Когда (МСК)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((ban) => (
                  <tr key={ban.id}>
                    <td>
                      <span className="badge">{ban.kind === "DISCORD" ? "Discord" : "Статик"}</span> {ban.subjectLabel}
                    </td>
                    <td>{ban.reason}</td>
                    <td>{ban.createdBy}</td>
                    <td className="nowrap">{ban.createdAt}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => void request("DELETE", { id: ban.id }, "Бан снят.")}
                      >
                        Снять
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {history.length > 0 ? (
        <div className="panel">
          <h2 className="panel-title">Снятые баны</h2>
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Кого</th>
                  <th>Причина</th>
                  <th>Выдан (МСК)</th>
                  <th>Снят (МСК)</th>
                </tr>
              </thead>
              <tbody>
                {history.map((ban) => (
                  <tr key={ban.id}>
                    <td>
                      <span className="badge">{ban.kind === "DISCORD" ? "Discord" : "Статик"}</span> {ban.subjectLabel}
                    </td>
                    <td>{ban.reason}</td>
                    <td className="nowrap">{ban.createdAt}</td>
                    <td className="nowrap">{ban.revokedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
