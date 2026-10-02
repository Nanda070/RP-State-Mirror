import { Prisma, prisma } from "@mirror/db";

export type Db = Prisma.TransactionClient | typeof prisma;

export function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
