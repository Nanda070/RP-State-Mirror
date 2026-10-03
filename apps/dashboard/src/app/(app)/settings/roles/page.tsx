import { listActiveRoleMappings } from "@mirror/core";
import Link from "next/link";
import { SettingsRolesForm } from "@/components/settings-roles-form";
import {
  getActiveFactionOptions,
  getActiveGuildOptions,
  getActiveRoleOptions,
} from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsRolesPage() {
  await requireSystemSettingsPage();

  const [mappings, guilds, factions, roles] = await Promise.all([
    listActiveRoleMappings(),
    getActiveGuildOptions(),
    getActiveFactionOptions(),
    getActiveRoleOptions(),
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
        <p className="muted">Привязка Discord-ролей к уровням доступа и фракциям.</p>
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
        guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
        factions={factions}
        roles={roles}
      />
    </div>
  );
}
