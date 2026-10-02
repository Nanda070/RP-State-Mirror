import { canManageSystemSettings, listActiveRoleMappings } from "@mirror/core";
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
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
  );
}
