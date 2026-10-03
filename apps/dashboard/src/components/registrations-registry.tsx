import { RegistryActions, type RegistryActionButton } from "./registry-actions";
import { Pager, RegistryToolbar } from "./registry-toolbar";
import { ShareButton } from "./share-button";
import { formatMoscowShort } from "@/lib/moscow";
import {
  REGISTRATION_DISPLAY_STATUS_RU,
  registrationStatusTone,
  type RegistrationListItem,
} from "@/lib/registrations";

type Props = {
  title: string;
  description: React.ReactNode;
  path: string;
  showPlate?: boolean;
  detailLabel: string;
  total: number;
  page: number;
  pages: number;
  query: { q?: string | undefined; status?: string | undefined };
  items: RegistrationListItem[];
  /** ACTIVE public links by registration id; null hides them (viewer cannot share). */
  shareLinks?: Map<string, { id: string; token: string }> | null;
  /** «Админ» and above: approve, refuse, withdraw. */
  canAct?: boolean;
  /** Registry key for «Скачать CSV». */
  exportRegistry: string;
};

function actionsFor(row: RegistrationListItem): RegistryActionButton[] {
  const what = `по статику ${row.staticId}`;
  if (row.displayStatus === "PENDING") {
    return [
      { action: "approve", label: "Одобрить", confirm: `Одобрить заявку ${what}? Заявитель получит сообщение.` },
      {
        action: "reject",
        label: "Отказать",
        tone: "danger",
        confirm: `Отказать в заявке ${what}? Заявитель получит причину в личные сообщения.`,
        input: { label: "Причина отказа", multiline: true },
      },
    ];
  }
  if (row.displayStatus === "APPROVED") {
    return [
      {
        action: "revoke",
        label: "Снять",
        tone: "danger",
        confirm: `Снять действующую регистрацию ${what} досрочно? Статик и госномер освободятся.`,
        input: { label: "Причина", multiline: true },
      },
    ];
  }
  return [];
}

export function RegistrationsRegistry({
  title,
  description,
  path,
  showPlate = false,
  detailLabel,
  total,
  page,
  pages,
  query,
  items,
  shareLinks = null,
  canAct = false,
  exportRegistry,
}: Props) {
  return (
    <div className="stack">
      <div className="section-head">
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>

      <RegistryToolbar
        path={path}
        query={query}
        statuses={REGISTRATION_DISPLAY_STATUS_RU}
        placeholder={showPlate ? "Статик, госномер, Discord ID заявителя" : "Статик, Discord ID заявителя"}
        exportRegistry={exportRegistry}
      />

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted registry-empty">Записей не найдено.</p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Статик</th>
                  <th>{detailLabel}</th>
                  {showPlate ? <th>Госномер</th> : null}
                  <th>Статус</th>
                  <th>Заявитель</th>
                  <th>Подана</th>
                  <th>Решение / до</th>
                  {canAct ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className="registry-mono">{row.staticId}</td>
                    <td>{row.modelOrDescription}</td>
                    {showPlate ? <td className="registry-mono nowrap">{row.plate ?? "—"}</td> : null}
                    <td>
                      <span className="registry-status" data-status={registrationStatusTone(row.displayStatus)}>
                        {REGISTRATION_DISPLAY_STATUS_RU[row.displayStatus]}
                      </span>
                      {row.rejectionReason?.trim() ? (
                        <span className="muted registry-note">{row.rejectionReason.trim()}</span>
                      ) : null}
                    </td>
                    <td>{row.applicantLabel}</td>
                    <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                    <td className="nowrap">
                      {formatMoscowShort(row.displayStatus === "APPROVED" || row.displayStatus === "EXPIRED" ? row.expiresAt : row.decidedAt)}
                    </td>
                    {canAct ? (
                      <td>
                        <div className="registry-actions">
                          {shareLinks ? (
                            <ShareButton entityType="registration" entityId={row.id} initialLink={shareLinks.get(row.id) ?? null} />
                          ) : null}
                          <RegistryActions entity="registration" id={row.id} actions={actionsFor(row)} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager path={path} params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
