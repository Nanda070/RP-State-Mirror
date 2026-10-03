import { Prisma, type prisma } from "@mirror/db";

export type Db = Prisma.TransactionClient | typeof prisma;

function isPrismaNullSentinel(value: unknown): value is typeof Prisma.JsonNull | typeof Prisma.DbNull {
  return value === Prisma.JsonNull || value === Prisma.DbNull || value === Prisma.AnyNull;
}

/**
 * Convert an application value into something Prisma accepts for a Json column.
 * Never JSON.stringifies Prisma null sentinels — that collapses them to `{}`.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined || isPrismaNullSentinel(value)) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** True for the empty-object artifact produced by JSON.stringify(Prisma.JsonNull). */
export function isJsonNullArtifact(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0 &&
    !(value instanceof Date)
  );
}

/**
 * Normalize a Json column value read from Prisma before Zod parsing.
 * Maps the JsonNull stringify artifact `{}` back to null.
 */
export function fromJsonValue(value: unknown): unknown {
  if (isJsonNullArtifact(value)) return null;
  return value;
}
