/**
 * Applies a global admin role operation (§4.12): on every guild with configured role sets, grant the
 * roles of the chosen level and remove the admin roles of the other levels. Produces a per-guild report.
 */
import type { Client } from "discord.js";
import {
  completeAdminRoleOperation,
  getAdminRoleOperation,
  getSetting,
  planAdminRoles,
  type AdminRoleReport,
} from "@mirror/core";
import type { JobHandler } from "./worker.js";

/** Discord API: Unknown Member / Unknown User. */
const NOT_A_MEMBER_CODES = new Set([10007, 10013]);

async function applyOnGuild(
  client: Client,
  plan: { guildDiscordId: string; add: string[]; remove: string[] },
  targetDiscordId: string,
): Promise<AdminRoleReport[number]> {
  const guild = client.guilds.cache.get(plan.guildDiscordId);
  const base = { guildDiscordId: plan.guildDiscordId, guildName: guild?.name ?? plan.guildDiscordId };
  const row = (outcome: string, extra: Partial<AdminRoleReport[number]> = {}) => ({
    ...base,
    outcome,
    added: [],
    removed: [],
    detail: null,
    ...extra,
  });
  if (!guild || !guild.available) return row("unavailable", { detail: "Бот не состоит на сервере или сервер недоступен." });

  try {
    const member = await guild.members.fetch(targetDiscordId).catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === "number" && NOT_A_MEMBER_CODES.has(code)) return null;
      throw error;
    });
    if (!member) return row("not_member", { detail: "Пользователь не состоит на сервере." });

    const me = guild.members.me ?? (await guild.members.fetchMe());
    const blocked: string[] = [];
    const usable = (roleId: string) => {
      const role = guild.roles.cache.get(roleId);
      if (role && !role.managed && role.position < me.roles.highest.position) return true;
      blocked.push(role?.name ?? roleId);
      return false;
    };
    const add = plan.add.filter((id) => !member.roles.cache.has(id)).filter(usable);
    const remove = plan.remove.filter((id) => member.roles.cache.has(id)).filter(usable);

    if (remove.length > 0) await member.roles.remove(remove, "Mirror: глобальные admin-роли");
    if (add.length > 0) await member.roles.add(add, "Mirror: глобальные admin-роли");

    const names = (ids: string[]) => ids.map((id) => guild.roles.cache.get(id)?.name ?? id);
    return row(add.length + remove.length > 0 ? "changed" : "unchanged", {
      added: names(add),
      removed: names(remove),
      detail: blocked.length > 0 ? `Не удалось изменить (роль выше роли бота или управляется интеграцией): ${blocked.join(", ")}` : null,
    });
  } catch (error) {
    return row("failed", { detail: error instanceof Error ? error.message.slice(0, 300) : String(error) });
  }
}

export const adminRolesApply: JobHandler = async (payload, { client, log }) => {
  const operationId = String(payload.operationId ?? "");
  const operation = await getAdminRoleOperation(operationId);
  if (!operation) return { status: "skipped", reason: "operation not found" };
  if (operation.status !== "PENDING") return { status: "skipped", reason: "already applied" };

  const plans = planAdminRoles(await getSetting("adminRoles.byGuild"), operation.level);
  const report: AdminRoleReport = [];
  for (const plan of plans) report.push(await applyOnGuild(client, plan, operation.targetDiscordId));

  await completeAdminRoleOperation(operation.id, report);
  log.info(
    { operationId, target: operation.targetDiscordId, level: operation.level, guilds: report.length },
    "admin roles applied",
  );
  return { status: "done", operationId, guilds: report.length };
};
