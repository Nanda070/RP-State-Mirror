"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Ban = { id: string; ipAddress: string; reason: string; createdAt: string };

export function FormIpBans({ bans, recentIps }: { bans: Ban[]; recentIps: string[] }) {
  const router = useRouter();
  const [ipAddress, setIpAddress] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(method: "POST" | "DELETE", body: Record<string, string>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/forms/bans", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Блокировка IP</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Заблокированный адрес не может отправлять ни одну публичную форму. Блокировка общая для всех форм.
      </p>
      <form
        className="form-grid-3"
        onSubmit={(event) => {
          event.preventDefault();
          void request("POST", { ipAddress, reason }).then((ok) => {
            if (ok) {
              setIpAddress("");
              setReason("");
            }
          });
        }}
      >
        <div className="field">
          <label htmlFor="banIp">IP-адрес</label>
          <input
            id="banIp"
            required
            maxLength={64}
            list="recentIps"
            value={ipAddress}
            onChange={(event) => setIpAddress(event.target.value.trim())}
          />
          <datalist id="recentIps">
            {recentIps.map((ip) => (
              <option key={ip} value={ip} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="banReason">Причина</label>
          <input
            id="banReason"
            required
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn-danger" disabled={pending}>
            Заблокировать
          </button>
        </div>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {bans.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Заблокированных адресов нет.
        </p>
      ) : (
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>IP</th>
                <th>Причина</th>
                <th>Заблокирован (МСК)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bans.map((ban) => (
                <tr key={ban.id}>
                  <td className="registry-mono">{ban.ipAddress}</td>
                  <td>{ban.reason}</td>
                  <td>{ban.createdAt}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={pending}
                      onClick={() => void request("DELETE", { id: ban.id })}
                    >
                      Разблокировать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
