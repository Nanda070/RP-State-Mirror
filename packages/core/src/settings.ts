import { prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, writeAuditEvents, type AuditContext } from "./audit.js";
import { toJsonValue, type Db } from "./db.js";
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
  "backups.retentionDays": defineSetting(z.number().int().positive(), 14, "Срок хранения бэкапов, дни"),
  "fines.dueDays": defineSetting(z.number().int().positive(), 14, "Срок оплаты штрафа, дни"),
  "fines.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для публикации штрафов",
  ),
  "wanted.enabled": defineSetting(z.boolean(), true, "Модуль розыска включён"),
  "wanted.channelId": defineSetting(
    snowflakeSchema.nullable(),
    null,
    "Канал на сервере ЧП для публикации розысков",
  ),
  "cp.syncEnabled": defineSetting(z.boolean(), true, "Синхронизация ролей ЧП включена"),
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

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<SettingValue<K>> {
  const definition = settingDefinitions[key];
  const row = await db.systemSetting.findUnique({ where: { key } });
  if (!row) return definition.defaultValue as SettingValue<K>;
  return definition.schema.parse(row.value) as SettingValue<K>;
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
