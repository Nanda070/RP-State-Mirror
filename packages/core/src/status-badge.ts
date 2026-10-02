import { AdminLevel } from "@mirror/db";
import { ADMIN_LEVEL_LABELS_RU } from "./access.js";
import type { FactionIdentity, Identity } from "./identity.js";

export interface StatusBadge {
  primary: string;
  secondary: string | null;
  kind: "admin" | "faction" | "citizen";
  accentColor: string | null;
}

function formatFactionBadge(faction: FactionIdentity): string {
  const parts = [faction.code];
  if (faction.departments[0]) parts.push(faction.departments[0]);
  if (faction.rank !== null) parts.push(`Ранг ${faction.rank}`);
  return parts.join(" · ");
}

/**
 * Large status under the display name: admin position, faction line, or «Гражданин».
 */
export function buildStatusBadge(identity: Identity, adminPositionLabel?: string | null): StatusBadge {
  if (identity.adminLevel) {
    const primary =
      adminPositionLabel?.trim() ||
      ADMIN_LEVEL_LABELS_RU[identity.adminLevel] ||
      ADMIN_LEVEL_LABELS_RU[AdminLevel.ADMIN];
    const secondary = identity.factions[0] ? formatFactionBadge(identity.factions[0]) : null;
    return { primary, secondary, kind: "admin", accentColor: null };
  }

  const faction = identity.factions[0];
  if (faction) {
    return {
      primary: formatFactionBadge(faction),
      secondary: null,
      kind: "faction",
      accentColor: faction.color,
    };
  }

  return { primary: "Гражданин", secondary: null, kind: "citizen", accentColor: null };
}
