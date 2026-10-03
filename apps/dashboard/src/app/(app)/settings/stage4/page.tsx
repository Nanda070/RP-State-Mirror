import Link from "next/link";
import { requireSystemSettingsPage } from "@/lib/session";
import { Stage4SettingsManager } from "@/components/stage4-settings-manager";

export default async function Stage4SettingsPage() {
  await requireSystemSettingsPage();

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Этап 4</span>
        </p>
        <h1>Модули этапа 4</h1>
        <p className="muted">
          Конфигурация регистраций, переводов, IC-модулей, role panels, форм и обратной связи.
        </p>
      </div>
      <Stage4SettingsManager />
    </div>
  );
}
