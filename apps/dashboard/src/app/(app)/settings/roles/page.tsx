import { canManageSystemSettings, listActiveRoleMappings } from "@mirror/core";
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsRolesForm } from "@/components/settings-roles-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsRolesPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [mappings, guilds, factions, roles] = await Promise.all([
    listActiveRoleMappings(),
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true },
    }),
    prisma.faction.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true, color: true },
    }),
    prisma.discordRole.findMany({
      where: { status: RecordStatus.ACTIVE, guild: { status: RecordStatus.ACTIVE } },
      orderBy: [{ position: "desc" }, { name: "asc" }],
      select: {
        discordId: true,
        name: true,
        color: true,
        guild: { select: { discordId: true, name: true } },
      },
    }),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Роли</span>
        </p>
        <h1>Роли</h1>
        <p className="muted">
          Привязка Discord-ролей к уровням доступа и фракциям. Системные серверы настраиваются
          отдельно.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Link href="/settings/system" className="btn btn-secondary">
            К системным серверам
          </Link>
        </div>
      </div>
      <SettingsRolesForm
        initialMappings={mappings.map((m) => ({
          id: m.id,
          roleDiscordId: m.roleDiscordId,
          kind: m.kind,
          value: m.value,
          guild: m.guild,
          faction: m.faction,
        }))}
        guilds={guilds}
        factions={factions}
        roles={roles}
        kinds={Object.values(RoleMappingKind)}
      />
    </div>
  );
}
