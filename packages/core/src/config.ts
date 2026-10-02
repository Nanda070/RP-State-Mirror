import { prisma } from "@mirror/db";
import { z } from "zod";

export const bootstrapConfigSchema = z.object({
  superAdminUserIds: z.array(z.string()),
});

export async function getSystemSetting<T>(key: string, schema: z.ZodType<T>) {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  return setting ? schema.parse(setting.value) : null;
}

export async function setSystemSetting(key: string, value: unknown, updatedById?: string) {
  return prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedById: updatedById ?? null },
    update: { value: value as object, updatedById: updatedById ?? null },
  });
}