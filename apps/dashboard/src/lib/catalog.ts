import { listActiveChannels } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { cache } from "react";

/** Request-deduped Discord catalog reads shared across settings pages. */

export const getActiveGuildOptions = cache(async () =>
  prisma.guild.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: { name: "asc" },
    select: { discordId: true, name: true, iconUrl: true, lastSyncedAt: true },
  }),
);

export const getActiveChannelOptions = cache(async () => listActiveChannels());

export const getActiveRoleOptions = cache(async () =>
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
);

export const getRolesForGuild = cache(async (guildDiscordId: string) =>
  prisma.discordRole.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      guild: { discordId: guildDiscordId, status: RecordStatus.ACTIVE },
    },
    orderBy: { name: "asc" },
    select: { discordId: true, name: true },
  }),
);

/** Colour of a faction by its code, for badges and row stripes; null — no colour set or no such faction. */
export const getFactionColors = cache(async () => {
  const colors = new Map((await getActiveFactionOptions()).map((faction) => [faction.code, faction.color]));
  return (code: string | null | undefined): string | null => (code ? (colors.get(code) ?? null) : null);
});

export const getActiveFactionOptions = cache(async () =>
  prisma.faction.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { code: true, name: true, color: true },
  }),
);
