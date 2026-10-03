import {
  discordWebhookUrlSchema,
  getSetting,
  isSettingKey,
  setSetting,
  wakeDeferredJobs,
  snowflakeSchema,
  type SettingKey,
} from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const bodySchema = z.object({
  "documents.ttlHours": z.number().int().positive().optional(),
  "wanted.enabled": z.boolean().optional(),
  "wanted.channelId": snowflakeSchema.nullable().optional(),
  "wanted.pingRoleIds": z.array(snowflakeSchema).optional(),
  "wanted.coordinatorRoleIds": z.array(snowflakeSchema).optional(),
  "fines.dueDays": z.number().int().positive().optional(),
  "fines.channelId": snowflakeSchema.nullable().optional(),
  "fines.pingRoleIds": z.array(snowflakeSchema).optional(),
  "cp.syncEnabled": z.boolean().optional(),
  "cp.excludedRoleIds": z.array(snowflakeSchema).optional(),
  "cp.logChannelId": snowflakeSchema.nullable().optional(),
  "cp.maxKickPercent": z.number().min(0).max(100).optional(),
  "cp.dryRun": z.boolean().optional(),
  "documents.posterRoleIds": z.array(snowflakeSchema).max(50).optional(),
  "documents.responderRoleIds": z.array(snowflakeSchema).max(50).optional(),
  "fines.managerRoleIds": z.array(snowflakeSchema).max(50).optional(),
  "personnel.managerRoleIds": z.array(snowflakeSchema).max(50).optional(),
  "admins.positions": z
    .array(z.object({ discordId: snowflakeSchema, title: z.string().trim().min(1).max(64) }))
    .max(200)
    .optional(),
  "monitoring.errorChannelId": snowflakeSchema.nullable().optional(),
  "monitoring.alertWebhookUrl": discordWebhookUrlSchema.nullable().optional(),
  "audit.archiveAfterDays": z.number().int().min(30).max(3650).optional(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const [
      documentsTtlHours,
      wantedEnabled,
      wantedChannelId,
      wantedPingRoleIds,
      wantedCoordinatorRoleIds,
      finesDueDays,
      finesChannelId,
      finesPingRoleIds,
      cpSyncEnabled,
      cpExcludedRoleIds,
      cpLogChannelId,
    ] = await Promise.all([
      getSetting("documents.ttlHours"),
      getSetting("wanted.enabled"),
      getSetting("wanted.channelId"),
      getSetting("wanted.pingRoleIds"),
      getSetting("wanted.coordinatorRoleIds"),
      getSetting("fines.dueDays"),
      getSetting("fines.channelId"),
      getSetting("fines.pingRoleIds"),
      getSetting("cp.syncEnabled"),
      getSetting("cp.excludedRoleIds"),
      getSetting("cp.logChannelId"),
    ]);
    return Response.json({
      "documents.ttlHours": documentsTtlHours,
      "wanted.enabled": wantedEnabled,
      "wanted.channelId": wantedChannelId,
      "wanted.pingRoleIds": wantedPingRoleIds,
      "wanted.coordinatorRoleIds": wantedCoordinatorRoleIds,
      "fines.dueDays": finesDueDays,
      "fines.channelId": finesChannelId,
      "fines.pingRoleIds": finesPingRoleIds,
      "cp.syncEnabled": cpSyncEnabled,
      "cp.excludedRoleIds": cpExcludedRoleIds,
      "cp.logChannelId": cpLogChannelId,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = bodySchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);

    const updated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (!isSettingKey(key)) continue;
      updated[key] = await setSetting(key as SettingKey, value as never, ctx);
    }
    // A channel may just have been configured: deliveries that waited for it go out now.
    await wakeDeferredJobs();
    return Response.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
