import { buildStatusBadge } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Image from "next/image";
import type { CSSProperties } from "react";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export default async function ProfilePage() {
  const session = await requireSignedIn();

  const [identity, memberships] = await Promise.all([
    resolveFreshIdentity(session.user.discordId),
    prisma.guildMember.findMany({
      where: {
        userDiscordId: session.user.discordId,
        isPresent: true,
        guild: { status: RecordStatus.ACTIVE },
      },
      include: { guild: true },
      orderBy: { guild: { name: "asc" } },
    }),
  ]);
  const badge = buildStatusBadge(identity);

  const avatar =
    session.user.image ??
    memberships.find((m) => m.avatarUrl)?.avatarUrl ??
    memberships.find((m) => m.guildAvatarUrl)?.guildAvatarUrl ??
    null;

  const bannerUrl = session.user.bannerUrl ?? null;
  const accent = session.user.accentColor ?? badge.accentColor ?? null;
  const displayName = session.user.name ?? session.user.username ?? "Discord";

  return (
    <div className="stack">
      <div
        className="profile-hero"
        data-has-banner={Boolean(bannerUrl)}
        style={
          {
            ...(accent ? ({ ["--profile-accent" as string]: accent } as CSSProperties) : null),
            ...(bannerUrl
              ? ({ ["--profile-banner" as string]: `url(${bannerUrl})` } as CSSProperties)
              : null),
          } as CSSProperties
        }
      >
        <div className="profile-banner" aria-hidden />
        <div className="profile-identity">
          {avatar ? (
            <Image className="avatar" src={avatar} alt="" width={72} height={72} unoptimized />
          ) : (
            <div className="avatar avatar-fallback" aria-hidden>
              {(displayName.trim().charAt(0) || "?").toUpperCase()}
            </div>
          )}
          <div className="profile-meta">
            <h1 className="truncate" title={displayName}>
              {displayName}
            </h1>
            <p className="muted handle truncate" title={`@${session.user.username ?? "discord"}`}>
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
            {memberships.map((member) => {
              const nick = member.nickname ?? member.globalName ?? member.username;
              return (
                <div className="server-card" key={member.id}>
                  <div className="min-w-0">
                    <span className="label">Сервер</span>
                    <strong className="truncate" title={member.guild.name}>
                      {member.guild.name}
                    </strong>
                  </div>
                  <div className="min-w-0">
                    <span className="label">Ник</span>
                    <span className="truncate" title={nick}>
                      {nick}
                    </span>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
