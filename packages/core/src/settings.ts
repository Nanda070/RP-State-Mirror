import { prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
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
