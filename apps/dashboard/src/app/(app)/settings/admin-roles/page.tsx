import { adminRoleReportSchema, getSetting, listAdminRoleOperations } from "@mirror/core";
import Link from "next/link";
import { AdminRolesManager } from "@/components/admin-roles-manager";
import { getActiveGuildOptions, getActiveRoleOptions } from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscow } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Admin-роли" };

export default async function AdminRolesPage() {
  await requireSystemSettingsPage();
  const [guilds, roles, sets, operations] = await Promise.all([
    getActiveGuildOptions(),
    getActiveRoleOptions(),
    getSetting("adminRoles.byGuild"),
    listAdminRoleOperations(20),
  ]);
  const labels = await resolveAuthorLabels(
    operations.flatMap((operation) => [operation.targetDiscordId, operation.requestedByDiscordId]),
  );

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Admin-роли</span>
        </p>
        <h1>Admin-роли на всех серверах</h1>
        <p className="muted">
          Выдача и снятие ролей администрации сразу на всех подключённых серверах с отчётом по каждому.
        </p>
      </div>
      <AdminRolesManager
        guilds={guilds.map((guild) => ({
          discordId: guild.discordId,
          name: guild.name,
          roles: roles
            .filter((role) => role.guild.discordId === guild.discordId && role.name !== "@everyone")
            .map((role) => ({ discordId: role.discordId, name: role.name })),
        }))}
        initialSets={sets}
        operations={operations.map((operation) => {
          const report = adminRoleReportSchema.safeParse(operation.report);
          return {
            id: operation.id,
            target: labels.get(operation.targetDiscordId) ?? operation.targetDiscordId,
            level: operation.level,
            status: operation.status,
            requestedBy: labels.get(operation.requestedByDiscordId) ?? operation.requestedByDiscordId,
            createdAt: formatMoscow(operation.createdAt),
            report: report.success ? report.data : [],
          };
        })}
      />
    </div>
  );
}
