import { prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, writeAuditEvents, type AuditContext } from "./audit.js";
import { fromJsonValue, toJsonValue, type Db } from "./db.js";
import { snowflakeSchema } from "./env.js";

function defineSetting<S extends z.ZodTypeAny>(schema: S, defaultValue: z.output<S>, description: string) {
  return { schema, defaultValue, description };
}

export const settingDefinitions = {
  "core.mainGuildId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Главный сервер: с него берутся уровни доступа админов",
  ),
  "core.incidentGuildId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Сервер ЧП: синхронизация ролей, розыск, регистрации",
  ),
  "app.timezone": defineSetting(z.string().min(1), "Europe/Moscow", "Часовой пояс отображения"),
  "documents.ttlHours": defineSetting(z.number().int().positive(), 72, "Срок актуальности документа, часы"),
  "registrations.ttlDays": defineSetting(z.number().int().positive(), 31, "Срок актуальности регистрации, дни"),
  "tokens.expandThresholdPercent": defineSetting(
    z.number().min(0).max(100),
    10,
    "Порог свободных номеров нашивок для перехода на следующую длину, %",
  ),
  "tokens.finderRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли на серверах GOV и ЧП (ОГП/Юстиция): право /token find",
  ),
  "backups.retentionDays": defineSetting(z.number().int().positive(), 14, "Срок хранения бэкапов, дни"),
  "fines.dueDays": defineSetting(z.number().int().positive(), 14, "Срок оплаты штрафа, дни"),
  "fines.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для публикации штрафов",
  ),
  "fines.pingRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли на сервере ЧП: пинг при публикации нового штрафа",
  ),
  "wanted.enabled": defineSetting(z.boolean(), true, "Модуль розыска включён"),
  "wanted.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для публикации розысков",
  ),
  "wanted.pingRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Устарело: пинг розыска берётся из фракционных ролей на ЧП (все кроме WN)",
  ),
  "wanted.coordinatorRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли на сервере ЧП: право объявлять и закрывать розыск (Координатор)",
  ),
  "registrations.vehicleChannelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для заявок регистрации ТС",
  ),
  "registrations.uniformChannelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для заявок регистрации формы (униформы)",
  ),
  "registrations.coordinatorRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли на сервере ЧП: координаторы регистраций (одобрение/отказ и пинг для ТС и формы)",
  ),
  "transfers.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал для заявок переводов между фракциями",
  ),
  "transfers.approvalDmText": defineSetting(
    z.string().min(1).max(2000),
    "Ваш перевод одобрен обеими сторонами. Можете подойти в холл на собеседование.",
    "Текст ЛС игроку после одобрения перевода обеими фракциями",
  ),
  "webhooks.notifyChannelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал уведомлений админам о новых запросах форм (/создать-webhook)",
  ),
  "feedback.notifyChannelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал уведомлений о новых обращениях обратной связи",
  ),
  "feedback.openMessage": defineSetting(
    z
      .object({
        guildDiscordId: snowflakeSchema,
        channelDiscordId: snowflakeSchema,
        messageDiscordId: snowflakeSchema,
      })
      .nullable(),
    null,
    "Последнее опубликованное сообщение с кнопкой feedback.open",
  ),
  "icBlacklist.enabled": defineSetting(z.boolean(), true, "Модуль IC чёрного списка (/чс-гос) включён"),
  "icBlacklist.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для публикации IC чёрного списка",
  ),
  "icBlacklist.managerRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли GOV: добавление и снятие IC чёрного списка (/чс-гос)",
  ),
  "icBlacklist.searchRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли: поиск по IC чёрному списку",
  ),
  "invites.guildIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Серверы для /инвайт-админ (пусто = главный + серверы фракций)",
  ),
  "invites.defaultMaxAgeSeconds": defineSetting(
    z.number().int().min(60).max(7 * 24 * 3600),
    3600,
    "Срок жизни временного инвайта /инвайт-админ, секунды",
  ),
  "cp.syncEnabled": defineSetting(z.boolean(), true, "Синхронизация ролей ЧП включена"),
  "cp.excludedRoleIds": defineSetting(
    z.array(snowflakeSchema).default([]),
    [],
    "Роли на сервере ЧП: участники с ними не синхронизируются и не кикаются",
  ),
  "cp.logChannelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для логов синхронизации ролей",
  ),
};

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingDefinitions)[K]["schema"]>;

export const SETTING_KEYS = Object.keys(settingDefinitions) as SettingKey[];

export class SettingValidationError extends Error {
  override name = "SettingValidationError";
}

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingDefinitions, key);
}

async function readSettingValue<K extends SettingKey>(
  key: K,
  row: { key: string; value: unknown } | null | undefined,
  db: Db,
): Promise<SettingValue<K>> {
  const definition = settingDefinitions[key];
  if (!definition) {
    throw new SettingValidationError(`Неизвестный ключ настройки: ${String(key)}`);
  }
  if (!row) return definition.defaultValue as SettingValue<K>;

  const decoded = fromJsonValue(row.value);
  const parsed = definition.schema.safeParse(decoded);
  if (!parsed.success) {
    throw parsed.error;
  }

  // Heal rows where JSON null was persisted as `{}` (Prisma.JsonNull stringify artifact).
  if (decoded !== row.value) {
    await db.systemSetting.update({
      where: { key },
      data: { value: toJsonValue(parsed.data) },
    });
  }

  return parsed.data as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return readSettingValue(key, row, db);
}

/** Load many settings in one query (request-friendly for settings hubs). */
export async function getSettings<const K extends readonly SettingKey[]>(
  keys: K,
  db: Db = prisma,
): Promise<{ [P in K[number]]: SettingValue<P> }> {
  const uniqueKeys = [...new Set(keys)];
  const rows =
    uniqueKeys.length === 0
      ? []
      : await db.systemSetting.findMany({ where: { key: { in: uniqueKeys } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const result = {} as { [P in K[number]]: SettingValue<P> };
  await Promise.all(
    uniqueKeys.map(async (key) => {
      (result as Record<string, unknown>)[key] = await readSettingValue(key, byKey.get(key), db);
    }),
  );
  return result;
}

const DISTINCT_GUILD_KEYS: readonly SettingKey[] = ["core.mainGuildId", "core.incidentGuildId"];

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  context: AuditContext,
): Promise<SettingValue<K>> {
  const parsed = settingDefinitions[key].schema.safeParse(value);
  if (!parsed.success) {
    throw new SettingValidationError(`${key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const next = parsed.data as SettingValue<K>;

  return auditedMutation(context, "setting.updated", "system_setting", async (tx) => {
    if (next !== null && DISTINCT_GUILD_KEYS.includes(key)) {
      const otherKey = DISTINCT_GUILD_KEYS.find((k) => k !== key) as SettingKey;
      if ((await getSetting(otherKey, tx)) === next) {
        throw new SettingValidationError("Главный сервер и сервер ЧП должны быть разными серверами");
      }
    }

    const before = await getSetting(key, tx);
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: toJsonValue(next), updatedById: context.actorUserId ?? null },
      update: { value: toJsonValue(next), updatedById: context.actorUserId ?? null },
    });
    return { entityId: key, before, after: next, result: next };
  });
}

/**
 * Legacy split: `registrations.channelId` → both vehicle + uniform channels.
 * Copies the old value to each new key when that key is still unset/null, then
 * deletes the legacy row. Idempotent; safe to call on seed and bot/dashboard boot.
 */
export async function migrateLegacyRegistrationChannels(): Promise<{
  migrated: boolean;
  value: string | null;
}> {
  const legacy = await prisma.systemSetting.findUnique({ where: { key: "registrations.channelId" } });
  if (!legacy) return { migrated: false, value: null };

  const decoded = fromJsonValue(legacy.value);
  const parsed = snowflakeSchema.safeParse(decoded);
  const value = parsed.success ? parsed.data : null;

  if (value) {
    for (const key of ["registrations.vehicleChannelId", "registrations.uniformChannelId"] as const) {
      const current = await getSetting(key);
      if (current === null) {
        await prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: toJsonValue(value) },
          update: { value: toJsonValue(value) },
        });
      }
    }
  }

  await prisma.systemSetting.delete({ where: { key: "registrations.channelId" } });
  return { migrated: true, value };
}

/**
 * Persist main + incident guild ids in one transaction.
 * Validates they differ before any write.
 */
export async function setMainAndIncidentGuilds(
  mainGuildId: string | null,
  incidentGuildId: string | null,
  context: AuditContext,
): Promise<{ mainGuildId: string | null; incidentGuildId: string | null }> {
  const mainParsed = settingDefinitions["core.mainGuildId"].schema.safeParse(mainGuildId);
  const incidentParsed = settingDefinitions["core.incidentGuildId"].schema.safeParse(incidentGuildId);
  if (!mainParsed.success) {
    throw new SettingValidationError(
      `core.mainGuildId: ${mainParsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  if (!incidentParsed.success) {
    throw new SettingValidationError(
      `core.incidentGuildId: ${incidentParsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const main = mainParsed.data;
  const incident = incidentParsed.data;
  if (main !== null && incident !== null && main === incident) {
    throw new SettingValidationError("Главный сервер и сервер ЧП должны быть разными серверами");
  }

  return prisma.$transaction(async (tx) => {
    const mainBefore = await getSetting("core.mainGuildId", tx);
    const incidentBefore = await getSetting("core.incidentGuildId", tx);

    await tx.systemSetting.upsert({
      where: { key: "core.mainGuildId" },
      create: { key: "core.mainGuildId", value: toJsonValue(main), updatedById: context.actorUserId ?? null },
      update: { value: toJsonValue(main), updatedById: context.actorUserId ?? null },
    });
    await tx.systemSetting.upsert({
      where: { key: "core.incidentGuildId" },
      create: {
        key: "core.incidentGuildId",
        value: toJsonValue(incident),
        updatedById: context.actorUserId ?? null,
      },
      update: { value: toJsonValue(incident), updatedById: context.actorUserId ?? null },
    });

    await writeAuditEvents(
      [
        {
          ...context,
          action: "setting.updated",
          entityType: "system_setting",
          entityId: "core.mainGuildId",
          before: mainBefore,
          after: main,
        },
        {
          ...context,
          action: "setting.updated",
          entityType: "system_setting",
          entityId: "core.incidentGuildId",
          before: incidentBefore,
          after: incident,
        },
      ],
      tx,
    );

    return { mainGuildId: main, incidentGuildId: incident };
  });
}
