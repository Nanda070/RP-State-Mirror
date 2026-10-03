/**
 * Faction lookups for slash autocomplete and validation.
 * Always returns every ACTIVE faction — no membership filtering.
 */
import { RecordStatus, prisma } from "@mirror/db";

export interface FactionChoice {
  /** Discord choice label (shown to the user). */
  name: string;
  /** Stored option value (faction code). */
  value: string;
}

/**
 * List ACTIVE factions for Discord autocomplete.
 * Empty query → full list (up to Discord's 25-choice cap), sorted by sortOrder.
 * Non-empty query → case-insensitive filter on code/name, still capped at 25.
 */
export async function listActiveFactionsForAutocomplete(query = ""): Promise<FactionChoice[]> {
  const factions = await prisma.faction.findMany({
    where: { status: RecordStatus.ACTIVE },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { code: true, name: true },
  });

  const q = query.trim().toLowerCase();
  const filtered = q
    ? factions.filter(
        (f) => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
      )
    : factions;

  return filtered.slice(0, 25).map((f) => ({
    name: `${f.code} — ${f.name}`.slice(0, 100),
    value: f.code,
  }));
}

export async function getActiveFactionByCode(code: string) {
  return prisma.faction.findFirst({
    where: { code: code.toUpperCase(), status: RecordStatus.ACTIVE },
  });
}
