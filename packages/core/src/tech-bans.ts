/**
 * Technical bans (§6): an administrative block on using the bot and the dashboard.
 * Not to be confused with the IC blacklist, which is in-game information and blocks nothing.
 *
 * - DISCORD ban: the account cannot use commands, buttons, forms in Discord or sign in to the dashboard.
 * - STATIC ban: applications that name this static (badge, registrations, transfers) are refused.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";

export const TECH_BAN_KINDS = ["DISCORD", "STATIC"] as const;
export type TechBanKind = (typeof TECH_BAN_KINDS)[number];

export const TECH_BAN_MESSAGE = "Вам запрещено пользоваться ботом и сайтом. Обратитесь к администрации.";

export class TechBanError extends UserError {
  override name = "TechBanError";
}

export const createTechBanSchema = z
  .object({
    kind: z.enum(TECH_BAN_KINDS),
    value: z.string().trim().min(1).max(64),
    reason: z.string().trim().min(1, "Укажите причину бана").max(500),
    createdByDiscordId: z.string().min(1).max(32),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "DISCORD" && !SNOWFLAKE_RE.test(data.value)) {
      ctx.addIssue({ code: "custom", message: "Discord ID — это число из 17–20 цифр", path: ["value"] });
    }
  });

export async function createTechBan(
  input: z.input<typeof createTechBanSchema>,
  context: AuditContext,
  options: { superAdminUserIds?: readonly string[] } = {},
) {
  const data = createTechBanSchema.parse(input);
  if (data.kind === "DISCORD") {
    if (data.value === data.createdByDiscordId) throw new TechBanError("Нельзя забанить самого себя.");
    // A super admin must always be able to get in — that is what the bootstrap list is for.
    if (options.superAdminUserIds?.includes(data.value)) {
      throw new TechBanError("Главного администратора забанить нельзя.");
    }
  }
  return auditedMutation(context, "tech_ban.created", "tech_ban", async (tx) => {
    const existing = await tx.techBan.findFirst({
      where: { kind: data.kind, value: data.value, status: RecordStatus.ACTIVE },
      select: { id: true },
    });
    if (existing) throw new TechBanError("Такой бан уже действует.");
    const ban = await tx.techBan.create({ data });
    if (data.kind === "DISCORD") {
      // The ban takes effect immediately on the dashboard: open sessions are ended.
      await tx.userSession.updateMany({
        where: { discordId: data.value, revokedAt: null },
        data: { revokedAt: new Date(), revokedByDiscordId: data.createdByDiscordId },
      });
    }
    return { entityId: ban.id, after: ban, result: ban };
  });
}

export async function revokeTechBan(id: string, actorDiscordId: string, context: AuditContext) {
  return auditedMutation(context, "tech_ban.revoked", "tech_ban", async (tx) => {
    const current = await tx.techBan.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
    if (!current) throw new TechBanError("Бан не найден или уже снят.");
    const ban = await tx.techBan.update({
      where: { id },
      data: { status: RecordStatus.REVOKED, revokedAt: new Date(), revokedByDiscordId: actorDiscordId },
    });
    return { entityId: id, before: current, after: ban, result: ban };
  });
}

export async function listTechBans(filter: { activeOnly?: boolean; limit?: number } = {}) {
  return prisma.techBan.findMany({
    ...(filter.activeOnly ? { where: { status: RecordStatus.ACTIVE } } : {}),
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 200,
  });
}

/** The ACTIVE ban that applies to this account or static, if any. */
export async function findActiveTechBan(subject: { discordId?: string | null; staticId?: string | null }) {
  const or = [
    ...(subject.discordId ? [{ kind: "DISCORD", value: subject.discordId }] : []),
    ...(subject.staticId?.trim() ? [{ kind: "STATIC", value: subject.staticId.trim() }] : []),
  ];
  if (or.length === 0) return null;
  return prisma.techBan.findFirst({ where: { status: RecordStatus.ACTIVE, OR: or } });
}

/** Every banned Discord account: the bot keeps the list in memory and checks it before each interaction. */
export async function listActiveDiscordBanIds(): Promise<string[]> {
  const rows = await prisma.techBan.findMany({
    where: { status: RecordStatus.ACTIVE, kind: "DISCORD" },
    select: { value: true },
  });
  return rows.map((row) => row.value);
}

export async function assertNotTechBanned(subject: { discordId?: string | null; staticId?: string | null }) {
  const ban = await findActiveTechBan(subject);
  if (!ban) return;
  throw new TechBanError(
    ban.kind === "STATIC" ? `Статик ${ban.value} заблокирован администрацией.` : TECH_BAN_MESSAGE,
  );
}
