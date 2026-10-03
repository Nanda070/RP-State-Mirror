import { canViewModules, listPersonnelEvents, PERSONNEL_EVENT_LABELS_RU } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

const STATUS_RU: Record<string, string> = {
  ACTIVE: "Активен",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

export default async function PersonnelRegistryPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listPersonnelEvents({ limit: 100 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Персонал</h1>
        <p className="muted">
          Реестр кадрового аудита. Всего записей: {total.toLocaleString("ru-RU")}.
        </p>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Пока нет событий. Создайте через команду <code>/кадровый-аудит</code> в Discord.
          </p>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Фракция</th>
                  <th>Сотрудник</th>
                  <th>Статус</th>
                  <th>Создан (МСК)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      {PERSONNEL_EVENT_LABELS_RU[
                        ev.type as keyof typeof PERSONNEL_EVENT_LABELS_RU
                      ] ?? ev.type}
                    </td>
                    <td>{ev.factionCode}</td>
                    <td>
                      {ev.subjectName}{" "}
                      <span className="muted registry-mono">({ev.subjectDiscordId})</span>
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={ev.status === RecordStatus.ACTIVE ? "ok" : "muted"}
                      >
                        {STATUS_RU[ev.status] ?? ev.status}
                      </span>
                    </td>
                    <td>{formatMoscow(ev.createdAt)}</td>
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
