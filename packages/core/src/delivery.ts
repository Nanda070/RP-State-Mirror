/**
 * Resolve Discord delivery targets for module messages.
 * Channels/webhooks come from settings — never hardcoded IDs.
 */
import { RecordStatus, RoleMappingKind, prisma } from "@mirror/db";
import { z } from "zod";
import { snowflakeSchema } from "./env.js";
import { getSetting } from "./settings.js";

export const factionDeliverySettingsSchema = z
  .object({
    documentsChannelId: snowflakeSchema.optional(),
    personnelChannelId: snowflakeSchema.optional(),
    documentsWebhookUrl: z.string().url().optional(),
    personnelWebhookUrl: z.string().url().optional(),
    /** Discord role on the faction guild pinged for documents / faction-bound notices («старший состав»). */
    seniorRoleId: snowflakeSchema.optional(),
  })
  .passthrough();

export type FactionDeliverySettings = z.infer<typeof factionDeliverySettingsSchema>;

/** Build Discord role mention string; empty if no ids. */
export function formatRoleMentions(roleIds: readonly string[]): string {
  return roleIds
    .filter((id) => /^\d{17,20}$/.test(id))
    .map((id) => `<@&${id}>`)
    .join(" ");
}

/**
 * Senior staff («старший состав») role for a faction, from faction.settings.seniorRoleId.
 * Used as a fallback ping when no faction-code / FACTION_MEMBER role is available.
 */
export async function resolveFactionSeniorRoleId(factionCode: string): Promise<string | null> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) return null;
  const settings = parseFactionSettings(faction.settings);
  return settings.seniorRoleId ?? null;
}

/**
 * Role to ping for faction-bound notices (/пост, /штраф).
 * Prefers a Discord role named like the faction code (FIB → @FIB) on the faction guild,
 * then seniorRoleId (legacy leader), then a FACTION_MEMBER mapping whose role name
 * matches the code, then any FACTION_MEMBER on the faction guild.
 * Avoids the shared generic «Фракция» ping used previously via fines.pingRoleIds on ЧП.
 */
export async function resolveFactionPingRoleId(factionCode: string): Promise<string | null> {
  const code = factionCode.toUpperCase();
  const faction = await prisma.faction.findFirst({
    where: { code, status: RecordStatus.ACTIVE },
    include: { guild: true },
  });
  if (!faction) return null;

  if (faction.guildId) {
    const byCodeName = await prisma.discordRole.findFirst({
      where: {
        guildId: faction.guildId,
        status: RecordStatus.ACTIVE,
        name: { equals: code, mode: "insensitive" },
      },
      select: { discordId: true },
    });
    if (byCodeName) return byCodeName.discordId;
  }

  const settings = parseFactionSettings(faction.settings);
  if (settings.seniorRoleId) return settings.seniorRoleId;

  const memberMappings = await prisma.roleMapping.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      kind: RoleMappingKind.FACTION_MEMBER,
      factionId: faction.id,
    },
    select: { roleDiscordId: true, guildId: true },
  });
  if (memberMappings.length > 0) {
    const roleIds = memberMappings.map((m) => m.roleDiscordId);
    const named = await prisma.discordRole.findFirst({
      where: {
        discordId: { in: roleIds },
        status: RecordStatus.ACTIVE,
        name: { equals: code, mode: "insensitive" },
      },
      select: { discordId: true },
    });
    if (named) return named.discordId;

    if (faction.guildId) {
      const onFaction = memberMappings.find((m) => m.guildId === faction.guildId);
      if (onFaction) return onFaction.roleDiscordId;
    }
    return memberMappings[0]?.roleDiscordId ?? null;
  }

  return null;
}

export type DeliveryTarget =
  | {
      kind: "channel";
      guildDiscordId: string;
      channelDiscordId: string;
    }
  | {
      kind: "webhook";
      webhookUrl: string;
      guildDiscordId: string | null;
      channelDiscordId: string | null;
    }
  | {
      kind: "unconfigured";
      reason: string;
    };

function parseFactionSettings(raw: unknown): FactionDeliverySettings {
  const result = factionDeliverySettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}

async function factionWithGuild(factionCode: string) {
  return prisma.faction.findFirst({
    where: { code: factionCode.toUpperCase(), status: RecordStatus.ACTIVE },
    include: { guild: true },
  });
}

export async function resolveFactionDocumentDelivery(factionCode: string): Promise<DeliveryTarget> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) {
    return { kind: "unconfigured", reason: `Фракция ${factionCode} не найдена` };
  }
  const settings = parseFactionSettings(faction.settings);
  const guildDiscordId = faction.guild?.discordId ?? null;

  if (settings.documentsChannelId && guildDiscordId) {
    return {
      kind: "channel",
      guildDiscordId,
      channelDiscordId: settings.documentsChannelId,
    };
  }
  if (settings.documentsWebhookUrl) {
    return {
      kind: "webhook",
      webhookUrl: settings.documentsWebhookUrl,
      guildDiscordId,
      channelDiscordId: null,
    };
  }
  return {
    kind: "unconfigured",
    reason: "Канал или вебхук документов для фракции ещё не настроен",
  };
}

/**
 * Legacy RESPONSE_WEBHOOK: `/ответ` is delivered to GOV's documents channel
 * (same destination as GOV faction `documentsChannelId` / webhook), not the
 * target faction of the original `/пост`.
 */
export async function resolveDocumentResponseDelivery(): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery("GOV");
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: "Канал или вебхук документов GOV ещё не настроен (сюда уходят ответы /ответ)",
    };
  }
  return target;
}

export async function resolveFactionPersonnelDelivery(factionCode: string): Promise<DeliveryTarget> {
  const faction = await factionWithGuild(factionCode);
  if (!faction) {
    return { kind: "unconfigured", reason: `Фракция ${factionCode} не найдена` };
  }
  const settings = parseFactionSettings(faction.settings);
  const guildDiscordId = faction.guild?.discordId ?? null;

  if (settings.personnelChannelId && guildDiscordId) {
    return {
      kind: "channel",
      guildDiscordId,
      channelDiscordId: settings.personnelChannelId,
    };
  }
  if (settings.personnelWebhookUrl) {
    return {
      kind: "webhook",
      webhookUrl: settings.personnelWebhookUrl,
      guildDiscordId,
      channelDiscordId: null,
    };
  }
  return {
    kind: "unconfigured",
    reason: "Канал или вебхук кадрового аудита для фракции ещё не настроен",
  };
}

export async function resolveWantedDelivery(): Promise<DeliveryTarget> {
  const [channelId, incidentGuildId] = await Promise.all([
    getSetting("wanted.channelId"),
    getSetting("core.incidentGuildId"),
  ]);
  if (!channelId || !incidentGuildId) {
    return {
      kind: "unconfigured",
      reason: "Канал розыска или сервер ЧП ещё не настроены",
    };
  }
  return {
    kind: "channel",
    guildDiscordId: incidentGuildId,
    channelDiscordId: channelId,
  };
}

/**
 * Primary `/штраф` publish: selected faction's documents channel (same as `/пост`).
 * Does **not** use `fines.channelId` on ЧП.
 */
export async function resolveFineDelivery(factionCode: string): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery(factionCode);
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: `Канал или вебхук документов для фракции ${factionCode.toUpperCase()} ещё не настроен (сюда уходят штрафы /штраф)`,
    };
  }
  return target;
}

/**
 * `/штраф-оплачено` notice: GOV documents channel (same destination as `/ответ`).
 */
export async function resolveFinePaidDelivery(): Promise<DeliveryTarget> {
  const target = await resolveFactionDocumentDelivery("GOV");
  if (target.kind === "unconfigured") {
    return {
      kind: "unconfigured",
      reason: "Канал или вебхук документов GOV ещё не настроен (сюда уходят уведомления об оплате штрафа)",
    };
  }
  return target;
}

export function deliveryConfigured(target: DeliveryTarget): boolean {
  return target.kind !== "unconfigured";
}

export function deliveryDeferredMessage(target: DeliveryTarget): string {
  if (target.kind === "unconfigured") {
    return `${target.reason}. Запись сохранена — сообщение отправится после настройки.`;
  }
  return "Сообщение поставлено в очередь на отправку.";
}
