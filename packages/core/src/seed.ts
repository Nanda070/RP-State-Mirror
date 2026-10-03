import { AuditActorType, prisma } from "@mirror/db";
import { writeAuditEvent, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import { SETTING_KEYS, migrateLegacyRegistrationChannels, settingDefinitions } from "./settings.js";

export interface FactionSeed {
  code: string;
  name: string;
  color: string;
}

export const DEFAULT_FACTIONS: readonly FactionSeed[] = [
  { code: "GOV", name: "Правительство", color: "#A855F7" },
  { code: "FIB", name: "FIB", color: "#64748B" },
  { code: "LSPD", name: "LSPD", color: "#3B82F6" },
  { code: "LSSD", name: "LSSD", color: "#B45309" },
  { code: "SASPA", name: "SASPA", color: "#F59E0B" },
  { code: "ARMY", name: "Армия", color: "#22C55E" },
  { code: "EMS", name: "EMS", color: "#EF4444" },
  { code: "WN", name: "Weazel News", color: "#EC4899" },
];

const SEED_CONTEXT: AuditContext = { actorType: AuditActorType.SYSTEM, source: "seed" };

export interface SeedResult {
  factionsCreated: number;
  settingsCreated: number;
  usersCreated: number;
}

/**
 * Idempotent: creates only what is missing and never overwrites values
 * that may have been changed in the dashboard.
 */
export async function seedFoundation(options: { superAdminUserIds: readonly string[] }): Promise<SeedResult> {
  const result: SeedResult = { factionsCreated: 0, settingsCreated: 0, usersCreated: 0 };

  for (const [index, seed] of DEFAULT_FACTIONS.entries()) {
    await prisma.$transaction(async (tx) => {
      if (await tx.faction.findUnique({ where: { code: seed.code } })) return;
      const faction = await tx.faction.create({ data: { ...seed, sortOrder: index } });
      await writeAuditEvent(
        { ...SEED_CONTEXT, action: "faction.created", entityType: "faction", entityId: faction.id, after: seed },
        tx,
      );
      result.factionsCreated += 1;
    });
  }

  for (const key of SETTING_KEYS) {
    await prisma.$transaction(async (tx) => {
      if (await tx.systemSetting.findUnique({ where: { key } })) return;
      const value = settingDefinitions[key].defaultValue;
      await tx.systemSetting.create({ data: { key, value: toJsonValue(value) } });
      await writeAuditEvent(
        { ...SEED_CONTEXT, action: "setting.initialized", entityType: "system_setting", entityId: key, after: value },
        tx,
      );
      result.settingsCreated += 1;
    });
  }

  // Prefer copying the legacy shared channel to both new keys so nothing breaks
  // until an admin sets vehicle vs uniform channels apart in the dashboard.
  await migrateLegacyRegistrationChannels();

  for (const discordId of options.superAdminUserIds) {
    await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { discordId } })) return;
      const user = await tx.user.create({ data: { discordId } });
      await writeAuditEvent(
        {
          ...SEED_CONTEXT,
          action: "user.created",
          entityType: "user",
          entityId: user.id,
          after: { discordId },
          metadata: { reason: "bootstrap super admin" },
        },
        tx,
      );
      result.usersCreated += 1;
    });
  }

  return result;
}
