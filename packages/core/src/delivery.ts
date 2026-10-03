/**
 * Resolve Discord delivery targets for module messages.
 * Channels/webhooks come from settings — never hardcoded IDs.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { snowflakeSchema } from "./env.js";
import { getSetting } from "./settings.js";

export const factionDeliverySettingsSchema = z
  .object({
    documentsChannelId: snowflakeSchema.optional(),
    personnelChannelId: snowflakeSchema.optional(),
    documentsWebhookUrl: z.string().url().optional(),
    personnelWebhookUrl: z.string().url().optional(),
  })
  .passthrough();

export type FactionDeliverySettings = z.infer<typeof factionDeliverySettingsSchema>;

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

export async function resolveFineDelivery(): Promise<DeliveryTarget> {
  const [channelId, incidentGuildId] = await Promise.all([
    getSetting("fines.channelId"),
    getSetting("core.incidentGuildId"),
  ]);
  if (!channelId || !incidentGuildId) {
    return {
      kind: "unconfigured",
      reason: "Канал штрафов или сервер ЧП ещё не настроены",
    };
  }
  return {
    kind: "channel",
    guildDiscordId: incidentGuildId,
    channelDiscordId: channelId,
  };
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
