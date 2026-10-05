import {
  canManageModules,
  canViewModules,
  formatMoney,
  listFinesPage,
  listPendingFineClaims,
  listShareLinksFor,
} from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistryActions } from "@/components/registry-actions";
import { Pager, RegistryToolbar, registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { ShareButton } from "@/components/share-button";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";
import { getFactionColors } from "@/lib/catalog";
import { EmptyState, FactionBadge, Money, factionStyle } from "@/components/ui";

export const metadata = { title: "Штрафы" };

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Не оплачен",
  OVERDUE: "Просрочен",
  CLOSED: "Оплачен",
  REVOKED: "Отменён",
};

export default async function FinesRegistryPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const factionColor = await getFactionColors();
  const { items, total, page, pages } = await listFinesPage(query);
  const canAct = canManageModules(identity);
  const shareLinks = canAct ? await listShareLinksFor("fine", items.map((item) => item.id)) : null;
  // «Я оплатил»: the report that waits for the staff, with the person who sent it.
  const claims = await listPendingFineClaims(items.map((item) => item.id));
  const claimants = await resolveAuthorLabels([...claims.values()].map((claim) => claim.claimantDiscordId));
  const now = Date.now();

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Штрафы</h1>
        <p className="muted">Реестр штрафов: выписываются командой <code>/штраф</code>.</p>
      </div>

      <RegistryToolbar
        path="/fines"
        query={query}
        statuses={STATUS_RU}
        placeholder="Номер, статик, ФИО, фракция, статья"
        exportRegistry="fines"
      />

      <div className="panel">
        {items.length === 0 ? (
          <EmptyState title="Записей не найдено" />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>ФИО</th>
                  <th>Сумма</th>
                  <th>Фракция</th>
                  <th>Статус</th>
                  <th>Оплатить до</th>
                  <th>Выписан</th>
                  {canAct ? <th className="cell-actions">Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const active = row.status === RecordStatus.ACTIVE;
                  const overdue = active && row.dueAt !== null && row.dueAt.getTime() <= now;
                  const claim = claims.get(row.id);
                  return (
                    <tr key={row.id} data-faction="" style={factionStyle(factionColor(row.factionCode))}>
                      <td className="registry-mono nowrap">{row.number}</td>
                      <td className="registry-mono">{row.staticId}</td>
                      <td>{row.characterName}</td>
                      <td>
                        <Money state={active ? "due" : row.status === RecordStatus.CLOSED ? "paid" : "void"}>{formatMoney(row.amount)}</Money>
                      </td>
                      <td>
                        <FactionBadge code={row.factionCode} color={factionColor(row.factionCode)} />
                      </td>
                      <td>
                        <span
                          className="registry-status"
                          data-status={overdue ? "bad" : active ? "warn" : row.status === RecordStatus.CLOSED ? "ok" : "muted"}
                        >
                          {overdue ? "Просрочен" : (STATUS_RU[row.status] ?? row.status)}
                        </span>
                        {claim ? (
                          <div className="muted">
                            Ждёт подтверждения · {claimants.get(claim.claimantDiscordId) ?? claim.claimantDiscordId}
                            {claim.evidenceFileIds.map((fileId, index) => (
                              <span key={fileId}>
                                {" · "}
                                <a href={`/api/media/${fileId}`} target="_blank" rel="noreferrer">
                                  скриншот{claim.evidenceFileIds.length > 1 ? ` ${index + 1}` : ""}
                                </a>
                              </span>
                            ))}
                            {claim.comment ? <div>{claim.comment}</div> : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="nowrap">{formatMoscowShort(row.dueAt)}</td>
                      <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                      {canAct ? (
                        <td className="cell-actions">
                          <div className="registry-actions">
                            {shareLinks ? (
                              <ShareButton entityType="fine" entityId={row.id} initialLink={shareLinks.get(row.id) ?? null} />
                            ) : null}
                            {claim ? (
                              <RegistryActions
                                entity="fine_claim"
                                id={claim.id}
                                actions={[
                                  {
                                    action: "approve",
                                    label: "Подтвердить оплату",
                                    confirm: `Подтвердить оплату штрафа ${row.number}? Штраф закроется, игрок получит сообщение.`,
                                  },
                                  {
                                    action: "reject",
                                    label: "Отклонить",
                                    tone: "danger",
                                    confirm: `Отклонить сообщение об оплате штрафа ${row.number}? Игрок получит причину и сможет отправить его заново.`,
                                    input: { label: "Причина", multiline: true },
                                  },
                                ]}
                              />
                            ) : null}
                            <RegistryActions
                              entity="fine"
                              id={row.id}
                              actions={
                                active
                                  ? [
                                      {
                                        action: "paid",
                                        label: "Оплачен",
                                        confirm: `Отметить штраф ${row.number} на ${formatMoney(row.amount)} оплаченным? Карточка в Discord обновится.`,
                                      },
                                      {
                                        action: "set_amount",
                                        label: "Сумма",
                                        confirm: `Изменить сумму штрафа ${row.number} (сейчас ${formatMoney(row.amount)})? Карточка в Discord обновится.`,
                                        input: { label: "Новая сумма", placeholder: "Например, 15000" },
                                      },
                                      {
                                        action: "cancel",
                                        label: "Отменить",
                                        tone: "danger",
                                        confirm: `Отменить штраф ${row.number}? Используйте, если он выписан по ошибке.`,
                                      },
                                    ]
                                  : []
                              }
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager path="/fines" params={{ q: query.q, status: query.status }} page={page} pages={pages} total={total} />
      </div>
    </div>
  );
}
