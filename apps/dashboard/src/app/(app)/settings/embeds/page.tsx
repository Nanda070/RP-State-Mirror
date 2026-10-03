import {
  canManageSystemSettings,
  isButtonPanelSpec,
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

  const [designs, sent, guilds, channels] = await Promise.all([
    listMessageDesigns(false),
    listSentMessages(40),
    prisma.guild.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { discordId: true, name: true },
    }),
    listActiveChannels(),
  ]);

  const embedDesigns = designs.filter((d) => !isButtonPanelSpec(d.spec as EmbedSpec));
  const embedDesignIds = new Set(embedDesigns.map((d) => d.id));
  const embedSent = sent.filter(
    (s) =>
      (s.designId && embedDesignIds.has(s.designId)) ||
      (!s.designId && !isButtonPanelSpec(s.spec as EmbedSpec)),
  );

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
          Конструктор Classic / Components V2: превью, сохранение, архив и отправка ботом в канал
          выбранного сервера. Панели кнопок — отдельно в разделе «Кнопки».
        </p>
        <div className="row" style={{ marginTop: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/buttons" className="btn btn-secondary">
            К кнопкам
          </Link>
        </div>
      </div>

      <EmbedManager
        initialDesigns={embedDesigns.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          spec: d.spec as EmbedSpec,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        initialSent={embedSent.map((s) => ({
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
      />
    </div>
  );
}
