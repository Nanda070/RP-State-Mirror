import { SettingsModuleStub } from "@/components/settings-module-stub";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsTokensPage() {
  await requireSystemSettingsPage();

  return (
    <SettingsModuleStub
      title="Токены"
      description="Служебные токены и интеграции — настройки только на этой странице модуля."
    />
  );
}
