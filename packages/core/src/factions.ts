/**
 * Faction lookups for slash autocomplete and validation.
 * Always returns every ACTIVE faction — no membership filtering.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import {
  factionDeliverySettingsSchema,
  type FactionDeliverySettings,
} from "./delivery.js";
import { UserError } from "./errors.js";
import { discordWebhookUrlSchema } from "./text.js";

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

export async function listActiveFactions() {
  return prisma.faction.findMany({
    where: { status: RecordStatus.ACTIVE },
    include: { guild: { select: { discordId: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

export const updateFactionDeliverySchema = z.object({
  factionCode: z.string().min(1).max(32),
  documentsChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  personnelChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  documentsWebhookUrl: discordWebhookUrlSchema.nullable().optional(),
  personnelWebhookUrl: discordWebhookUrlSchema.nullable().optional(),
  seniorRoleId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  guildDiscordId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
});
export type UpdateFactionDeliveryInput = z.infer<typeof updateFactionDeliverySchema>;

function mergeDeliverySettings(
  raw: unknown,
  patch: UpdateFactionDeliveryInput,
): FactionDeliverySettings {
  const current = factionDeliverySettingsSchema.safeParse(raw ?? {});
  const base: Record<string, unknown> = current.success ? { ...current.data } : {};

  const apply = (key: keyof FactionDeliverySettings, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null || value === "") delete base[key];
    else base[key] = value;
  };

  apply("documentsChannelId", patch.documentsChannelId);
  apply("personnelChannelId", patch.personnelChannelId);
  apply("documentsWebhookUrl", patch.documentsWebhookUrl);
  apply("personnelWebhookUrl", patch.personnelWebhookUrl);
  apply("seniorRoleId", patch.seniorRoleId);

  return factionDeliverySettingsSchema.parse(base);
}

export async function updateFactionDeliverySettings(
  input: UpdateFactionDeliveryInput,
  context: AuditContext,
) {
  const data = updateFactionDeliverySchema.parse(input);
  return auditedMutation(context, "faction.delivery_updated", "faction", async (tx) => {
    const faction = await tx.faction.findFirst({
      where: { code: data.factionCode.toUpperCase(), status: RecordStatus.ACTIVE },
    });
    if (!faction) throw new UserError("Фракция не найдена");

    let guildId = faction.guildId;
    if (data.guildDiscordId !== undefined) {
      if (data.guildDiscordId === null) {
        guildId = null;
      } else {
        const guild = await tx.guild.findFirst({
          where: { discordId: data.guildDiscordId, status: RecordStatus.ACTIVE },
        });
        if (!guild) throw new UserError("Сервер фракции не найден");
        guildId = guild.id;
      }
    }

    const beforeSettings = faction.settings;
    const nextSettings = mergeDeliverySettings(faction.settings, data);
    const updated = await tx.faction.update({
      where: { id: faction.id },
      data: {
        guildId,
        settings: toJsonValue(nextSettings),
      },
      include: { guild: { select: { discordId: true, name: true } } },
    });
    return {
      entityId: faction.id,
      before: { settings: beforeSettings, guildId: faction.guildId },
      after: { settings: nextSettings, guildId },
      result: updated,
    };
  });
}
