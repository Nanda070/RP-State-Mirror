/**
 * Direct messages the bot sends to a player, and the player's choice of which to receive (PLAN §5.6).
 *
 * Everything is on by default; the profile stores only what was switched off. Answers to the
 * player's own feedback ticket are not in the list: they are a reply, not a notification.
 */
import { prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

export const DM_KINDS = [
  { key: "registration", label: "Решение по регистрации ТС или формы" },
  { key: "registrationExpiry", label: "Регистрация истекла или снята" },
  { key: "transfer", label: "Решение по переводу между фракциями" },
  { key: "fine", label: "Новый штраф" },
  { key: "fineOverdue", label: "Срок оплаты штрафа истёк" },
  { key: "formRequest", label: "Решение по запросу формы" },
  { key: "formDecision", label: "Решение по ответу на форму" },
] as const;

export type DmKind = (typeof DM_KINDS)[number]["key"];

const DM_KEYS = DM_KINDS.map((kind) => kind.key) as [DmKind, ...DmKind[]];
const mutedSchema = z.array(z.enum(DM_KEYS)).max(DM_KEYS.length);

function knownKinds(values: readonly string[]): DmKind[] {
  return DM_KEYS.filter((key) => values.includes(key));
}

/** The kinds this person switched off. Someone who never opened the dashboard has none. */
export async function getMutedDmKinds(discordId: string): Promise<DmKind[]> {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { dmMuted: true } });
  return knownKinds(user?.dmMuted ?? []);
}

/** Asked by the bot right before a direct message of this kind. */
export async function wantsDm(discordId: string, kind: DmKind): Promise<boolean> {
  return !(await getMutedDmKinds(discordId)).includes(kind);
}

export async function setMutedDmKinds(discordId: string, muted: readonly string[], context: AuditContext) {
  const parsed = mutedSchema.safeParse(muted);
  if (!parsed.success) throw new UserError("Такого вида уведомлений нет. Обновите страницу.");
  const next = [...new Set(parsed.data)];
  return auditedMutation(context, "user.dm_preferences_updated", "user", async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { discordId }, select: { id: true, dmMuted: true } });
    const after = await tx.user.update({ where: { discordId }, data: { dmMuted: next }, select: { id: true, dmMuted: true } });
    return { entityId: after.id, before, after, result: knownKinds(after.dmMuted) };
  });
}

/** The account a fine or another record by static id belongs to; null when no active character has it. */
export async function findDiscordIdByStatic(staticId: string): Promise<string | null> {
  const character = await prisma.character.findFirst({
    where: { staticId, status: "ACTIVE" },
    select: { user: { select: { discordId: true } } },
  });
  return character?.user.discordId ?? null;
}
