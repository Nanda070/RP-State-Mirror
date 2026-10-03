import { listAccountRecoveriesFor } from "@mirror/core";
import { DecisionStatus } from "@mirror/db";
import { AccountRecoveryForm } from "@/components/account-recovery-form";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn } from "@/lib/session";

export const metadata = { title: "Восстановление аккаунта" };

const DECISION_RU: Record<DecisionStatus, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
};

export default async function RecoveryPage() {
  const session = await requireSignedIn();
  const requests = await listAccountRecoveriesFor(session.user.discordId);
  const hasPending = requests.some((request) => request.decision === DecisionStatus.PENDING);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Восстановление аккаунта</h1>
        <p className="muted">
          Если вы потеряли доступ к старому Discord-аккаунту, подайте заявку с нового. После одобрения
          администратором персонажи, нашивки, регистрации и переводы перейдут на этот аккаунт.
        </p>
      </div>

      <div className="panel">
        <h2 className="panel-title">Как это работает</h2>
        <ol className="recovery-steps">
          <li>Войдите на сайт с нового аккаунта — заявка подаётся от него.</li>
          <li>Укажите ник и статик любого персонажа старого аккаунта и его Discord ID.</li>
          <li>Администратор проверит данные. Решение придёт в личные сообщения от бота.</li>
          <li>
            Роли на серверах фракций бот не переносит — после одобрения обратитесь к лидеру фракции.
          </li>
        </ol>
      </div>

      {hasPending ? (
        <p className="form-ok">Заявка на рассмотрении. Новую можно подать после решения по текущей.</p>
      ) : (
        <AccountRecoveryForm newDiscordId={session.user.discordId} />
      )}

      {requests.length > 0 ? (
        <div className="panel">
          <h2 className="panel-title">Ваши заявки</h2>
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Подана (МСК)</th>
                  <th>Старый Discord ID</th>
                  <th>Персонаж</th>
                  <th>Статус</th>
                  <th>Причина отказа</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{formatMoscow(request.createdAt)}</td>
                    <td className="registry-mono">{request.oldDiscordId}</td>
                    <td>
                      {request.characterName} <span className="muted registry-mono">{request.staticId}</span>
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={
                          request.decision === DecisionStatus.APPROVED
                            ? "ok"
                            : request.decision === DecisionStatus.PENDING
                              ? "warn"
                              : "muted"
                        }
                      >
                        {DECISION_RU[request.decision]}
                      </span>
                    </td>
                    <td>{request.rejectionReason?.trim() || "—"}</td>
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
