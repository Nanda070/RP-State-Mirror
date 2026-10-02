import { buildStatusBadge } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Image from "next/image";
import { redirect } from "next/navigation";
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
        className="profile-banner"
        style={
          badge.accentColor
            ? {
                background: `linear-gradient(120deg, ${badge.accentColor}, transparent 60%), linear-gradient(210deg, color-mix(in srgb, var(--accent-2) 40%, transparent), var(--bg-2))`,
              }
            : undefined
        }
      />
      <div className="profile-row">
        {avatar ? (
          <Image className="avatar" src={avatar} alt="" width={96} height={96} unoptimized />
        ) : (
          <div className="avatar" aria-hidden />
        )}
        <div>
          <h1 style={{ margin: 0 }}>{session.user.name ?? session.user.username}</h1>
          <p className="muted" style={{ margin: "0.25rem 0 0.55rem" }}>
            @{session.user.username ?? "discord"} · {session.user.discordId}
          </p>
          <div className="row">
            <span className="badge" data-kind={badge.kind} style={badge.accentColor ? { borderColor: badge.accentColor } : undefined}>
              {badge.primary}
            </span>
            {badge.secondary ? <span className="badge">{badge.secondary}</span> : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Серверы</h2>
        {memberships.length === 0 ? (
          <p className="muted">Нет данных снимка. Запустите бота на серверах, где вы состоите.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Сервер</th>
                <th>Ник</th>
                <th>Вход</th>
                <th>Ролей</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((member) => (
                <tr key={member.id}>
                  <td>{member.guild.name}</td>
                  <td>{member.nickname ?? member.globalName ?? member.username}</td>
                  <td>{formatMoscow(member.joinedAt)}</td>
                  <td>{member.roleIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
