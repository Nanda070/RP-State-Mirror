import { canManageSystemSettings, getSetting } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsGuildForm } from "@/components/settings-guild-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsGuildsPage() {
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
    <SettingsGuildForm
      guilds={guilds.map((g) => ({
        ...g,
        lastSyncedAt: g.lastSyncedAt?.toISOString() ?? null,
      }))}
      initialMain={mainGuildId}
      initialIncident={incidentGuildId}
    />
  );
}
