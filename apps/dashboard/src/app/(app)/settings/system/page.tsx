import { canManageSystemSettings, getSetting } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsSystemPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [guilds, mainGuildId, incidentGuildId] = await Promise.all([
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true, iconUrl: true, lastSyncedAt: true },
    }),
    getSetting("core.mainGuildId"),
    getSetting("core.incidentGuildId"),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Система</span>
        </p>
        <h1>Система</h1>
        <p className="muted">
          Главный сервер и сервер ЧП. Изменения пишутся в журнал аудита. Привязка ролей — на отдельной
          странице.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/settings/roles" className="btn btn-secondary">
            К привязке ролей
          </Link>
        </div>
      </div>
      <SettingsGuildForm
        guilds={guilds.map((g) => ({
          ...g,
          lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
        }))}
        initialMain={mainGuildId}
        initialIncident={incidentGuildId}
      />
    </div>
  );
}
