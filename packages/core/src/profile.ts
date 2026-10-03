/**
 * Player profile data (§5.4): everything the project knows about one Discord account.
 * Read-only; fines, wanted and IC blacklist records are matched by the statics of the user's characters.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { listActiveIcBlacklistForStatics } from "./stage4.js";

const HISTORY_LIMIT = 50;

export async function getPlayerProfile(discordId: string) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: {
      id: true,
      characters: {
        where: { status: RecordStatus.ACTIVE },
        orderBy: { slot: "asc" },
        include: { tokens: { orderBy: { issuedAt: "desc" } } },
      },
    },
  });
  const characters = user?.characters ?? [];
  const statics = characters.map((character) => character.staticId);

  const [registrations, transfers, fines, wanted, blacklist] = await Promise.all([
    prisma.registration.findMany({
      where: { applicantDiscordId: discordId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    }),
    prisma.transfer.findMany({
      where: { createdByDiscordId: discordId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: { character: { select: { name: true, staticId: true } } },
    }),
    statics.length === 0
      ? []
      : prisma.fine.findMany({
          where: { staticId: { in: statics } },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
        }),
    statics.length === 0
      ? []
      : prisma.wanted.findMany({
          where: { staticId: { in: statics } },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
        }),
    listActiveIcBlacklistForStatics(statics),
  ]);

  return {
    characters: characters.map((character) => ({
      id: character.id,
      slot: character.slot,
      staticId: character.staticId,
      name: character.name,
      factionCode: character.factionCode,
      department: character.department,
      rank: character.rank,
      createdAt: character.createdAt,
      activeToken: character.tokens.find((token) => token.status === RecordStatus.ACTIVE) ?? null,
      tokens: character.tokens,
      blacklist: blacklist.get(character.staticId) ?? null,
    })),
    registrations,
    transfers,
    fines,
    wanted,
  };
}

export type PlayerProfile = Awaited<ReturnType<typeof getPlayerProfile>>;
