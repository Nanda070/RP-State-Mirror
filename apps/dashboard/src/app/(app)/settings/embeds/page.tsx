import {
  canManageSystemSettings,
  listActiveChannels,
  listMessageDesigns,
  listSentMessages,
} from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EmbedManager } from "@/components/embed-manager";
import { resolveFreshIdentity } from "@/lib/session";
import type { EmbedSpec } from "@mirror/core";

export default async function SettingsEmbedsPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [designs, sent, guilds, channels, roles] = await Promise.all([
    listMessageDesigns(false),
    listSentMessages(40),
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true },
    }),
    listActiveChannels(),
    prisma.discordRole.findMany({
      where: { status: RecordStatus.ACTIVE, guild: { status: RecordStatus.ACTIVE } },
      include: { guild: { select: { discordId: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Эмбеды</span>
        </p>
        <h1>Эмбеды</h1>
        <p className="muted">
          Конструктор Classic / Components V2, превью, сохранение, архив и отправка ботом в канал
          выбранного сервера. Кнопки role.toggle живут в button_actions.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
        </div>
      </div>

      <EmbedManager
        initialDesigns={designs.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          spec: d.spec as EmbedSpec,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        initialSent={sent.map((s) => ({
          id: s.id,
          guildDiscordId: s.guildDiscordId,
          channelDiscordId: s.channelDiscordId,
          messageDiscordId: s.messageDiscordId,
          design: s.design,
          createdAt: s.createdAt.toISOString(),
        }))}
        guilds={guilds}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
        }))}
        roles={roles.map((r) => ({
          discordId: r.discordId,
          name: r.name,
          guildDiscordId: r.guild.discordId,
        }))}
      />
    </div>
  );
}
