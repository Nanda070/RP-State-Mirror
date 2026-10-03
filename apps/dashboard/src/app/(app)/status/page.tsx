import { canViewModules, getLockdown, getSystemStatus, type ServiceState } from "@mirror/core";
import { redirect } from "next/navigation";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Статус системы" };
export const dynamic = "force-dynamic";

const STATE_RU: Record<ServiceState, { text: string; tone: string }> = {
  ok: { text: "Работает", tone: "ok" },
  down: { text: "Сбой", tone: "bad" },
  unknown: { text: "Нет данных", tone: "muted" },
};

export default async function StatusPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const [services, lockdown] = await Promise.all([getSystemStatus(), getLockdown()]);
  const broken = services.filter((service) => service.state === "down");

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Статус системы</h1>
        <p className="muted">Проверено: {formatMoscow(new Date())} МСК. Обновите страницу для новой проверки.</p>
      </div>

      <div className="panel status-summary" data-state={broken.length > 0 ? "down" : "ok"}>
        <strong>
          {broken.length > 0
            ? `Есть сбои: ${broken.map((service) => service.title.toLowerCase()).join(", ")}`
            : "Все службы работают"}
        </strong>
        {lockdown.enabled ? (
          <p className="form-error" style={{ marginBottom: 0 }}>
            Включена аварийная блокировка{lockdown.reason ? `: ${lockdown.reason}` : "."}
          </p>
        ) : null}
      </div>

      <div className="status-grid">
        {services.map((service) => (
          <div key={service.key} className="panel status-card" data-state={service.state}>
            <div className="row status-card-head">
              <h2 className="panel-title">{service.title}</h2>
              <span className="registry-status" data-status={STATE_RU[service.state].tone}>
                {STATE_RU[service.state].text}
              </span>
            </div>
            <p className="muted">{service.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
