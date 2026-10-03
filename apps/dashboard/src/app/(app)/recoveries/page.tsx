import { canManageModules, listAccountRecoveries, previewAccountRecovery } from "@mirror/core";
import { DecisionStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { RecoveryQueue, type RecoveryCard } from "@/components/recovery-queue";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Заявки на восстановление" };

export default async function RecoveriesPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageModules(identity)) redirect("/overview");

  const requests = await listAccountRecoveries({ limit: 100 });
  const pending = requests.filter((request) => request.decision === DecisionStatus.PENDING);
  const previews = await Promise.all(pending.map((request) => previewAccountRecovery(request.id)));

  const cards: RecoveryCard[] = previews.map((preview) => ({
    id: preview.request.id,
    createdAt: formatMoscow(preview.request.createdAt),
    newDiscordId: preview.request.newDiscordId,
    newLabel: preview.newLabel,
    oldDiscordId: preview.request.oldDiscordId,
    oldLabel: preview.oldLabel,
    characterName: preview.request.characterName,
    staticId: preview.request.staticId,
    reason: preview.request.reason,
    oldStillPresent: preview.oldStillPresent,
    nameMatches: preview.nameMatches,
    newCharacterCount: preview.newCharacterCount,
    oldCharacters: preview.oldCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      staticId: character.staticId,
    })),
    canApprove: preview.canApprove,
    blocker: preview.blocker,
    ownRequest:
      preview.request.newDiscordId === session.user.discordId ||
      preview.request.oldDiscordId === session.user.discordId,
  }));

  const decided = requests.filter((request) => request.decision !== DecisionStatus.PENDING);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Заявки на восстановление</h1>
        <p className="muted">
          Перенос персонажей, нашивок, регистраций и переводов со старого аккаунта на новый. Роли в Discord
          бот не меняет. На рассмотрении: {pending.length}.
        </p>
      </div>

      <RecoveryQueue cards={cards} />

      <div className="panel">
        <h2 className="panel-title">История</h2>
        {decided.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Обработанных заявок пока нет.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Подана (МСК)</th>
                  <th>Старый → новый</th>
                  <th>Персонаж</th>
                  <th>Решение</th>
                  <th>Решил</th>
                  <th>Перенесено / причина отказа</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((request) => (
                  <tr key={request.id}>
                    <td>{formatMoscow(request.createdAt)}</td>
                    <td className="registry-mono">
                      {request.oldDiscordId} → {request.newDiscordId}
                    </td>
                    <td>
                      {request.characterName} <span className="muted registry-mono">{request.staticId}</span>
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={request.decision === DecisionStatus.APPROVED ? "ok" : "muted"}
                      >
                        {request.decision === DecisionStatus.APPROVED ? "Одобрена" : "Отклонена"}
                      </span>
                    </td>
                    <td className="registry-mono">{request.decidedByDiscordId ?? "—"}</td>
                    <td>
                      {request.decision === DecisionStatus.APPROVED
                        ? `персонажей: ${request.movedCharacterIds.length}`
                        : request.rejectionReason?.trim() || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
