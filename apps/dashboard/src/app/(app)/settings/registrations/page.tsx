import { canManageSystemSettings } from "@mirror/core";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsModuleStub } from "@/components/settings-module-stub";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsRegistrationsPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  return (
    <SettingsModuleStub
      title="Регистрации"
      description="Настройки регистраций персонажей будут жить на /settings/registrations."
    />
  );
}
