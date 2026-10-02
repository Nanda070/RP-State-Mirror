import { canManageSystemSettings } from "@mirror/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsIndexPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  return (
    <div className="stack">
      <div className="panel">
        <h1 style={{ marginTop: 0 }}>Настройки</h1>
        <p className="muted">
          Системные параметры доступны главному и старшему администратору. Все изменения пишутся в
          журнал аудита.
        </p>
        <div className="row">
          <Link href="/settings/guilds" className="btn btn-primary">
            Главный сервер и ЧП
          </Link>
          <Link href="/settings/roles" className="btn btn-secondary">
            Привязка ролей
          </Link>
        </div>
      </div>
    </div>
  );
}
