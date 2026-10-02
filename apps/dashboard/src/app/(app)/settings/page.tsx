import {
  canManageSystemSettings,
  getSetting,
  listActiveRoleMappings,
} from "@mirror/core";
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import { SettingsRolesForm } from "@/components/settings-roles-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsIndexPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [guilds, mainGuildId, incidentGuildId, mappings, factions, roles] = await Promise.all([
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true, iconUrl: true, lastSyncedAt: true },
    }),
    getSetting("core.mainGuildId"),
    getSetting("core.incidentGuildId"),
    listActiveRoleMappings(),
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
        <h1>Настройки</h1>
        <p className="muted">
          Системные параметры доступны главному и старшему администратору. Все изменения пишутся в
          журнал аудита.
        </p>
        <div className="row" style={{ marginTop: "0.85rem" }}>
          <a href="#guilds" className="btn btn-secondary">
            Главный сервер и ЧП
          </a>
          <a href="#roles" className="btn btn-secondary">
            Привязка ролей
          </a>
          <Link href="/settings/guilds" className="muted" style={{ fontSize: "0.88rem" }}>
            Отдельная страница серверов →
          </Link>
          <Link href="/settings/roles" className="muted" style={{ fontSize: "0.88rem" }}>
            Отдельная страница ролей →
          </Link>
        </div>
      </div>

      <section id="guilds" className="settings-anchor">
        <SettingsGuildForm
          guilds={guilds.map((g) => ({
            ...g,
            lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
          }))}
          initialMain={mainGuildId}
          initialIncident={incidentGuildId}
        />
      </section>

      <section id="roles" className="settings-anchor">
        <SettingsRolesForm
          initialMappings={mappings.map((m) => ({
            id: m.id,
            roleDiscordId: m.roleDiscordId,
            kind: m.kind,
            value: m.value,
            guild: m.guild,
            faction: m.faction,
          }))}
          guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
          factions={factions}
          roles={roles}
          kinds={Object.values(RoleMappingKind)}
        />
      </section>
    </div>
  );
}
