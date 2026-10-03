import { SettingsModuleStub } from "@/components/settings-module-stub";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsRegistrationsPage() {
  await requireSystemSettingsPage();

  return (
    <SettingsModuleStub
      title="Регистрации"
      description="Настройки регистраций персонажей будут жить на /settings/registrations."
    />
  );
}
