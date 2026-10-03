import { canManageSystemSettings, listActiveChannels, listActiveFactions } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsFactionsForm } from "@/components/settings-factions-form";
import { resolveFreshIdentity } from "@/lib/session";

export default async function SettingsFactionsPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [factions, guilds, channels] = await Promise.all([
    listActiveFactions(),
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true },
    }),
    listActiveChannels(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Фракции</span>
        </p>
        <h1>Каналы фракций</h1>
        <p className="muted">
          Каналы и вебхуки документов / кадрового аудита. Доставка slash-команд читает эти
          настройки — без хардкода ID в коде.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
        </div>
      </div>

      <SettingsFactionsForm
        initialFactions={factions.map((f) => ({
          code: f.code,
          name: f.name,
          color: f.color,
          guildDiscordId: f.guild?.discordId ?? null,
          guildName: f.guild?.name ?? null,
          settings: f.settings,
        }))}
        guilds={guilds}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
      />
    </div>
  );
}
