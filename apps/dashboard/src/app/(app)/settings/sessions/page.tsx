import { listRecentSessions } from "@mirror/core";
import { SessionsList } from "@/components/sessions-list";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { toSessionRows } from "@/lib/session-rows";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Сессии и входы" };

export default async function SessionsAdminPage() {
  const { session } = await requireSystemSettingsPage();
  const sessions = await listRecentSessions({ limit: 300 });
  const owners = await resolveAuthorLabels(sessions.map((entry) => entry.discordId));
  const rows = toSessionRows(sessions, session.sid, owners);
  const live = rows.filter((row) => row.active);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Сессии и входы</h1>
        <p className="muted">
          Кто сейчас вошёл в дашборд и журнал последних входов. Завершённая сессия перестаёт работать при
          следующем запросе. Активных сессий: {live.length}.
        </p>
      </div>
      <div className="panel">
        <h2 className="panel-title">Активные сессии</h2>
        <SessionsList sessions={live} showOwner />
      </div>
      <div className="panel">
        <h2 className="panel-title">Журнал входов</h2>
        <SessionsList sessions={rows} showOwner />
      </div>
    </div>
  );
}
