import { canManageSystemSettings } from "@mirror/core";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsModuleStub } from "@/components/settings-module-stub";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsFinesPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  return (
    <SettingsModuleStub
      title="Штрафы"
      description="Тарифы и журнал штрафов появятся здесь как отдельный модуль настроек."
    />
  );
}
