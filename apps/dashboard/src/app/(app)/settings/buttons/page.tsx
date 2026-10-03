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
import { ButtonManager } from "@/components/button-manager";
import { resolveFreshIdentity } from "@/lib/session";
import type { EmbedSpec } from "@mirror/core";

export default async function SettingsButtonsPage() {
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

  const buttonDesigns = designs.filter((d) => isButtonPanelSpec(d.spec as EmbedSpec));
  const buttonDesignIds = new Set(buttonDesigns.map((d) => d.id));
  const buttonSent = sent.filter(
    (s) =>
      (s.designId && buttonDesignIds.has(s.designId)) ||
      isButtonPanelSpec(s.spec as EmbedSpec),
  );

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Кнопки</span>
        </p>
        <h1>Кнопки</h1>
        <p className="muted">
          Панели role.toggle и callback: настройка кнопок, превью, сохранение и отправка ботом.
          Действия пишутся в button_actions при материализации.
        </p>
        <div className="row" style={{ marginTop: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/embeds" className="btn btn-secondary">
            К эмбедам
          </Link>
        </div>
      </div>

      <ButtonManager
        initialDesigns={buttonDesigns.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          spec: d.spec as EmbedSpec,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        initialSent={buttonSent.map((s) => ({
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
