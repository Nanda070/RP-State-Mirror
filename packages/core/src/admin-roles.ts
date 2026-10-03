/**
 * Global admin roles (§4.12, dashboard only). For every connected guild the dashboard stores which
 * Discord roles an admin of each level should hold. A super admin then picks a person and a level,
 * and the bot grants those roles — and removes the admin roles of other levels — on every guild,
 * reporting per guild what happened.
 */
import { AdminLevel, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";
import { ADMIN_LEVEL_ORDER } from "./identity.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { getSetting, type SettingValue } from "./settings.js";

export class AdminRolesError extends UserError {
  override name = "AdminRolesError";
}

export type AdminRoleSets = SettingValue<"adminRoles.byGuild">;

export interface AdminRolePlan {
  guildDiscordId: string;
  /** Roles the person must hold for the chosen level. */
  add: string[];
  /** Admin roles of other levels that must be taken away. */
  remove: string[];
}

/**
 * What to change on each guild. `level: null` removes every admin role.
 * Guilds without configured roles are left out — there is nothing to manage there.
 */
export function planAdminRoles(sets: AdminRoleSets, level: AdminLevel | null): AdminRolePlan[] {
  const plans: AdminRolePlan[] = [];
  for (const [guildDiscordId, byLevel] of Object.entries(sets)) {
    const managed = new Set(ADMIN_LEVEL_ORDER.flatMap((entry) => byLevel[entry] ?? []));
    if (managed.size === 0) continue;
    const add = level ? [...new Set(byLevel[level] ?? [])] : [];
    plans.push({ guildDiscordId, add, remove: [...managed].filter((roleId) => !add.includes(roleId)) });
  }
  return plans;
}

export const requestAdminRolesSchema = z.object({
  targetDiscordId: z.string().trim().regex(SNOWFLAKE_RE, "Discord ID — это число из 17–20 цифр"),
  level: z.nativeEnum(AdminLevel).nullable(),
  requestedByDiscordId: z.string().min(1).max(32),
});

/** Queues the operation; the bot applies it and writes the per-guild report. */
export async function requestAdminRolesApply(input: z.input<typeof requestAdminRolesSchema>, context: AuditContext) {
  const data = requestAdminRolesSchema.parse(input);
  const sets = await getSetting("adminRoles.byGuild");
  if (planAdminRoles(sets, data.level).length === 0) {
    throw new AdminRolesError("Сначала настройте роли по уровням хотя бы для одного сервера.");
  }
  return auditedMutation(context, "admin_roles.requested", "admin_role_operation", async (tx) => {
    const operation = await tx.adminRoleOperation.create({ data });
    await enqueueJob(
      { type: MODULE_JOB_TYPES.ADMIN_ROLES_APPLY, payload: { operationId: operation.id }, maxAttempts: 3 },
      tx,
    );
    return { entityId: operation.id, after: operation, result: operation };
  });
}

export const adminRoleReportSchema = z.array(
  z.object({
    guildDiscordId: z.string(),
    guildName: z.string(),
    /** changed | unchanged | not_member | unavailable | failed */
    outcome: z.string(),
    added: z.array(z.string()).default([]),
    removed: z.array(z.string()).default([]),
    detail: z.string().nullable().default(null),
  }),
);
export type AdminRoleReport = z.infer<typeof adminRoleReportSchema>;

/** Called by the bot when it has gone through every guild. */
export async function completeAdminRoleOperation(id: string, report: AdminRoleReport) {
  const parsed = adminRoleReportSchema.parse(report);
  const failed = parsed.length > 0 && parsed.every((row) => row.outcome === "failed" || row.outcome === "unavailable");
  return auditedMutation(
    { actorType: "BOT", source: "admin_roles" },
    "admin_roles.applied",
    "admin_role_operation",
    async (tx) => {
      const operation = await tx.adminRoleOperation.update({
        where: { id },
        data: { status: failed ? "FAILED" : "DONE", report: toJsonValue(parsed), completedAt: new Date() },
      });
      return { entityId: id, after: { status: operation.status, report: parsed }, result: operation };
    },
  );
}

export async function getAdminRoleOperation(id: string) {
  return prisma.adminRoleOperation.findUnique({ where: { id } });
}

export async function listAdminRoleOperations(limit = 30) {
  return prisma.adminRoleOperation.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
