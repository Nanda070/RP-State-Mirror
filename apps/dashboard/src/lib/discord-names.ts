import { prisma } from "@mirror/db";

const SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * Labels for message authors: «Ник (Discord ID)», or the bare id when the person is not in the
 * server snapshot. The nickname is the freshest one known across connected servers.
 *
 * Older feedback replies stored the author's internal user id instead of the Discord id;
 * those are mapped back to the Discord account here.
 */
export async function resolveAuthorLabels(authorIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(authorIds.filter(Boolean))];
  const labels = new Map<string, string>();
  if (unique.length === 0) return labels;

  const internalIds = unique.filter((id) => !SNOWFLAKE_RE.test(id));
  const users =
    internalIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: internalIds } }, select: { id: true, discordId: true } })
      : [];
  const discordIdOf = new Map(users.map((user) => [user.id, user.discordId]));
  const toDiscordId = (id: string) => (SNOWFLAKE_RE.test(id) ? id : (discordIdOf.get(id) ?? null));

  const discordIds = [...new Set(unique.map(toDiscordId).filter((id): id is string => id !== null))];
  const members =
    discordIds.length > 0
      ? await prisma.guildMember.findMany({
          where: { userDiscordId: { in: discordIds } },
          select: { userDiscordId: true, nickname: true, globalName: true, username: true },
          orderBy: [{ isPresent: "desc" }, { updatedAt: "desc" }],
        })
      : [];
  const nameOf = new Map<string, string>();
  for (const member of members) {
    if (nameOf.has(member.userDiscordId)) continue;
    const name = member.nickname?.trim() || member.globalName?.trim() || member.username.trim();
    if (name) nameOf.set(member.userDiscordId, name);
  }

  for (const id of unique) {
    const discordId = toDiscordId(id);
    if (!discordId) {
      labels.set(id, id);
      continue;
    }
    const name = nameOf.get(discordId);
    labels.set(id, name ? `${name} (${discordId})` : discordId);
  }
  return labels;
}
