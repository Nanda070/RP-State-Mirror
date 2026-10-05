/**
 * The card of one person as the bot shows it in Discord: `/профиль` (one's own) and «Досье»
 * (somebody else's, for the roles that may look people up). Built from the same data as the
 * profile page of the dashboard, so the two never disagree.
 */
import { DecisionStatus, RecordStatus, RegistrationKind } from "@mirror/db";
import { canFindTokens, canSearchIcBlacklist } from "./access.js";
import type { Identity } from "./identity.js";
import { getPlayerProfile } from "./profile.js";
import { getSetting } from "./settings.js";
import { formatMoney } from "./text.js";

export type PlayerCardField = { name: string; value: string };

export type PlayerCard = {
  discordId: string;
  /** Faction, role in it, department and rank as the Discord roles say; one line. */
  faction: string;
  fields: PlayerCardField[];
  /** Fines that still wait for payment, for the buttons under the card. */
  unpaidFines: Array<{ id: string; number: string; amount: number }>;
};

/** Discord allows 1024 characters in a field; long lists are cut with a count of the rest. */
const MAX_LINES = 8;
const MAX_TEXT = 120;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

function listOf(lines: string[], empty: string, footer?: string): string {
  if (lines.length === 0) return empty;
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`…и ещё ${lines.length - MAX_LINES}`);
  if (footer) shown.push(footer);
  return shown.join("\n").slice(0, 1024);
}

function moscowDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

function factionLine(identity: Pick<Identity, "factions">): string {
  if (identity.factions.length === 0) return "Во фракциях не состоит";
  return identity.factions
    .map((faction) =>
      [
        faction.code,
        faction.isLeader ? "лидер" : faction.isDeputy ? "заместитель" : null,
        faction.departments[0] ?? null,
        faction.rank !== null ? `ранг ${faction.rank}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("; ");
}

export async function buildPlayerCard(
  identity: Pick<Identity, "discordUserId" | "factions">,
  options: { showBlacklist: boolean },
): Promise<PlayerCard> {
  const profile = await getPlayerProfile(identity.discordUserId);

  const characters = profile.characters.map(
    (character) =>
      `**${character.name}** · статик \`${character.staticId}\` · ${
        character.activeToken ? `нашивка **${character.activeToken.number}**` : "нашивки нет"
      }`,
  );

  const unpaid = profile.fines.filter((fine) => fine.status === RecordStatus.ACTIVE);
  const fines = unpaid.map(
    (fine) =>
      `**${fine.number}** · ${formatMoney(fine.amount)} · ${fine.dueAt ? `до ${moscowDate(fine.dueAt)}` : fine.paymentDeadlineText}`,
  );

  const wanted = profile.wanted
    .filter((row) => row.status === RecordStatus.ACTIVE)
    .map((row) => `**${row.number}** · ${clip(row.reason)} · срок: ${clip(row.termText)}`);

  const registrations = profile.registrations
    .filter((row) => row.status === RecordStatus.ACTIVE)
    .sort((a, b) =>
      a.kind === b.kind ? b.createdAt.getTime() - a.createdAt.getTime() : a.kind === RegistrationKind.VEHICLE ? -1 : 1,
    )
    .map((row) => {
      const what = row.kind === RegistrationKind.VEHICLE ? `ТС${row.plate ? ` \`${row.plate}\`` : ""}` : "Униформа";
      const state =
        row.decision === DecisionStatus.APPROVED && row.expiresAt ? `до ${moscowDate(row.expiresAt)}` : "на рассмотрении";
      return `${what} · статик \`${row.staticId}\` · ${state}`;
    });

  const blacklist = options.showBlacklist
    ? profile.characters.flatMap((character) =>
        character.blacklist
          ? [`**${character.blacklist.number}** · ${character.blacklist.fullName} · ${clip(character.blacklist.reason)}`]
          : [],
      )
    : [];

  return {
    discordId: identity.discordUserId,
    faction: factionLine(identity),
    fields: [
      { name: "Персонажи", value: listOf(characters, "Персонажей нет.") },
      {
        name: "Неоплаченные штрафы",
        value: listOf(
          fines,
          "Нет.",
          unpaid.length > 1 ? `Всего: ${formatMoney(unpaid.reduce((sum, fine) => sum + fine.amount, 0))}` : undefined,
        ),
      },
      { name: "Розыск", value: listOf(wanted, "Не в розыске.") },
      { name: "Регистрации", value: listOf(registrations, "Нет.") },
      ...(blacklist.length > 0 ? [{ name: "IC чёрный список", value: listOf(blacklist, "") }] : []),
    ],
    unpaidFines: unpaid.map((fine) => ({ id: fine.id, number: fine.number, amount: fine.amount })),
  };
}

/**
 * Who may open somebody's dossier: administrators and the roles that may look tokens up
 * (`tokens.finderRoleIds`). The IC blacklist block needs the right to search that list as well.
 * `currentRoleIds` are the viewer's roles on the server the command came from.
 */
export async function getDossierAccess(
  viewer: Pick<Identity, "adminLevel" | "isSuperAdmin" | "heldRoleIds">,
  currentRoleIds: readonly string[],
): Promise<{ allowed: boolean; showBlacklist: boolean }> {
  const roleIds = [...new Set([...viewer.heldRoleIds, ...currentRoleIds])];
  const [finderRoleIds, managerRoleIds, searchRoleIds] = await Promise.all([
    getSetting("tokens.finderRoleIds"),
    getSetting("icBlacklist.managerRoleIds"),
    getSetting("icBlacklist.searchRoleIds"),
  ]);
  const allowed = canFindTokens(viewer, roleIds, finderRoleIds);
  return {
    allowed,
    showBlacklist: allowed && canSearchIcBlacklist(viewer, roleIds, managerRoleIds, searchRoleIds),
  };
}
