"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type SessionRow = {
  id: string;
  owner: string | null;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  active: boolean;
  current: boolean;
};

export function SessionsList({
  sessions,
  showOwner = false,
  allowRevokeOthers = false,
}: {
  sessions: SessionRow[];
  /** Admin view: sessions of all users. */
  showOwner?: boolean;
  /** Own profile: offer «end every other session». */
  allowRevokeOthers?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, string>, current: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      // Ending the session you are in is a sign-out.
      if (current) await signOut({ callbackUrl: "/" });
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  const live = sessions.filter((session) => session.active);
  if (sessions.length === 0) {
    return <p className="muted">Сессий пока нет.</p>;
  }

  return (
    <div className="stack">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {allowRevokeOthers && live.length > 1 ? (
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => void act({ action: "revoke-others" }, false)}
          >
            Завершить все сессии, кроме этой
          </button>
        </div>
      ) : null}
      <div className="registry-table-wrap">
        <table className="registry-table">
          <thead>
            <tr>
              {showOwner ? <th>Пользователь</th> : null}
              <th>Устройство</th>
              <th>IP</th>
              <th>Вход (МСК)</th>
              <th>Активность (МСК)</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                {showOwner ? <td>{session.owner ?? "—"}</td> : null}
                <td>
                  {session.device}
                  {session.current ? <span className="badge session-current">эта сессия</span> : null}
                </td>
                <td className="registry-mono">{session.ipAddress ?? "—"}</td>
                <td className="nowrap">{session.createdAt}</td>
                <td className="nowrap">{session.lastSeenAt}</td>
                <td>
                  <span className="registry-status" data-status={session.active ? "ok" : "muted"}>
                    {session.active ? "Активна" : "Завершена"}
                  </span>
                </td>
                <td>
                  {session.active ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={pending}
                      onClick={() => void act({ action: "revoke", id: session.id }, session.current)}
                    >
                      {session.current ? "Выйти" : "Завершить"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
