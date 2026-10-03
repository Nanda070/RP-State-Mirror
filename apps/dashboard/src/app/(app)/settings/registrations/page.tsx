import { getSetting } from "@mirror/core";
import Link from "next/link";
import { Stage4ModuleSettings } from "@/components/stage4-module-settings";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsRegistrationsPage() {
  await requireSystemSettingsPage();
  const [ttlDays, channelId, roles] = await Promise.all([
    getSetting("registrations.ttlDays"),
    getSetting("registrations.channelId"),
    getSetting("registrations.coordinatorRoleIds"),
  ]);

  return (
    <div className="stack">
      <p className="crumb-inline muted"><Link href="/settings">Настройки</Link> › Регистрации</p>
      <h1>Регистрации ТС и униформы</h1>
      <p className="muted">Срок действия, канал ЧП и роли координаторов.</p>
      <Stage4ModuleSettings
        initial={{
          "registrations.ttlDays": String(ttlDays),
          "registrations.channelId": channelId ?? "",
          "registrations.coordinatorRoleIds": JSON.stringify(roles),
        }}
        fields={[
          { key: "registrations.ttlDays", label: "Срок действия, дней", type: "number" },
          { key: "registrations.channelId", label: "ID канала ЧП" },
          { key: "registrations.coordinatorRoleIds", label: "ID ролей координаторов (JSON-массив)" },
        ]}
      />
    </div>
  );
}
