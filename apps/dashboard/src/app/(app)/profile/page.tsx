import { buildStatusBadge } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { auth } from "@/auth";
import { formatMoscow } from "@/lib/moscow";
import { resolveFreshIdentity } from "@/lib/session";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");

  const identity = await resolveFreshIdentity(session.user.discordId);
  const badge = buildStatusBadge(identity);
  const memberships = await prisma.guildMember.findMany({
    where: {
      userDiscordId: session.user.discordId,
      isPresent: true,
      guild: { status: RecordStatus.ACTIVE },
    },
    include: { guild: true },
    orderBy: { guild: { name: "asc" } },
  });

  const avatar =
    session.user.image ??
    memberships.find((m) => m.avatarUrl)?.avatarUrl ??
    memberships.find((m) => m.guildAvatarUrl)?.guildAvatarUrl ??
    null;

  return (
    <div className="stack">
      <div
        className="profile-hero"
        style={
          badge.accentColor
            ? ({
                ["--profile-accent" as string]: badge.accentColor,
              } as CSSProperties)
            : undefined
        }
      >
        <div className="profile-identity">
          {avatar ? (
            <Image className="avatar" src={avatar} alt="" width={88} height={88} unoptimized />
          ) : (
            <div className="avatar" aria-hidden />
          )}
          <div className="profile-meta">
            <h1>{session.user.name ?? session.user.username}</h1>
            <p className="muted handle">
              @{session.user.username ?? "discord"} · {session.user.discordId}
            </p>
            <div className="row">
              <span
                className="badge"
                data-kind={badge.kind}
                style={badge.accentColor ? { borderColor: badge.accentColor } : undefined}
              >
                {badge.primary}
              </span>
              {badge.secondary ? <span className="badge">{badge.secondary}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Серверы</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Активные членства по снимку Discord. Роли считаются на момент последней синхронизации.
        </p>
        {memberships.length === 0 ? (
          <p className="muted">Нет данных снимка. Запустите бота на серверах, где вы состоите.</p>
        ) : (
          <div className="server-grid">
            {memberships.map((member) => (
              <div className="server-card" key={member.id}>
                <div>
                  <span className="label">Сервер</span>
                  <strong>{member.guild.name}</strong>
                </div>
                <div>
                  <span className="label">Ник</span>
                  <span>{member.nickname ?? member.globalName ?? member.username}</span>
                </div>
                <div>
                  <span className="label">Вход</span>
                  <span>{formatMoscow(member.joinedAt)}</span>
                </div>
                <div>
                  <span className="label">Ролей</span>
                  <strong>{member.roleIds.length}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
