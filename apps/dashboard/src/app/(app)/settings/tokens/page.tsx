import { getSetting } from "@mirror/core";
import Link from "next/link";
import { Stage4ModuleSettings } from "@/components/stage4-module-settings";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsTokensPage() {
  await requireSystemSettingsPage();
  const [threshold, finderRoles] = await Promise.all([
    getSetting("tokens.expandThresholdPercent"),
    getSetting("tokens.finderRoleIds"),
  ]);

  return (
    <div className="stack">
      <p className="crumb-inline muted"><Link href="/settings">Настройки</Link> › Токены</p>
      <h1>Токены и нашивки</h1>
      <p className="muted">Порог расширения номеров и роли, которым разрешён поиск нашивок.</p>
      <Stage4ModuleSettings
        initial={{
          "tokens.expandThresholdPercent": String(threshold),
          "tokens.finderRoleIds": JSON.stringify(finderRoles),
        }}
        fields={[
          { key: "tokens.expandThresholdPercent", label: "Порог свободных номеров, %", type: "number" },
          { key: "tokens.finderRoleIds", label: "ID ролей поиска (JSON-массив)" },
        ]}
      />
    </div>
  );
}
