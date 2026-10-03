import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoscow } from "@/lib/moscow";
import {
  REGISTRATION_DISPLAY_STATUS_RU,
  registrationStatusTone,
  type RegistrationListItem,
} from "@/lib/registrations";

type Props = {
  title: string;
  description: string;
  emptyHint: ReactNode;
  showPlate?: boolean;
  detailLabel: string;
  total: number;
  items: RegistrationListItem[];
};

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function RegistrationsRegistry({
  title,
  description,
  emptyHint,
  showPlate = false,
  detailLabel,
  total,
  items,
}: Props) {
  return (
    <div className="stack">
      <div className="section-head">
        <h1>{title}</h1>
        <p className="muted">
          {description} Всего записей: {total.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {emptyHint}
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Статик</th>
                  <th>{detailLabel}</th>
                  {showPlate ? <th>Госномер</th> : null}
                  <th>Статус</th>
                  <th>Заявитель</th>
                  <th>Подана (МСК)</th>
                  <th>Решение / до (МСК)</th>
                  <th>Причина отказа</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="registry-mono" title={row.id}>
                        {shortId(row.id)}
                      </span>
                    </td>
                    <td>
                      <span className="registry-mono">{row.staticId}</span>
                    </td>
                    <td>{row.modelOrDescription}</td>
                    {showPlate ? (
                      <td>
                        <span className="registry-mono">{row.plate ?? "—"}</span>
                      </td>
                    ) : null}
                    <td>
                      <span
                        className="registry-status"
                        data-status={registrationStatusTone(row.displayStatus)}
                      >
                        {REGISTRATION_DISPLAY_STATUS_RU[row.displayStatus]}
                      </span>
                    </td>
                    <td>{row.applicantLabel}</td>
                    <td>{formatMoscow(row.createdAt)}</td>
                    <td>
                      {row.displayStatus === "APPROVED" || row.displayStatus === "EXPIRED"
                        ? formatMoscow(row.expiresAt)
                        : formatMoscow(row.decidedAt)}
                    </td>
                    <td>{row.rejectionReason?.trim() || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Решения принимаются в Discord. Настройки каналов — в{" "}
        <Link href="/settings/stage4?tab=registrations">конфигурации модулей</Link> (главный
        администратор).
      </p>
    </div>
  );
}
