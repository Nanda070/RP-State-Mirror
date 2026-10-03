import {
  getSetting,
  isSettingKey,
  setSetting,
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
  "fines.dueDays": z.number().int().positive().optional(),
  "fines.channelId": snowflakeSchema.nullable().optional(),
  "cp.syncEnabled": z.boolean().optional(),
  "cp.excludedRoleIds": z.array(snowflakeSchema).optional(),
  "cp.logChannelId": snowflakeSchema.nullable().optional(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const [
      documentsTtlHours,
      wantedEnabled,
      wantedChannelId,
      finesDueDays,
      finesChannelId,
      cpSyncEnabled,
      cpExcludedRoleIds,
      cpLogChannelId,
    ] = await Promise.all([
      getSetting("documents.ttlHours"),
      getSetting("wanted.enabled"),
      getSetting("wanted.channelId"),
      getSetting("fines.dueDays"),
      getSetting("fines.channelId"),
      getSetting("cp.syncEnabled"),
      getSetting("cp.excludedRoleIds"),
      getSetting("cp.logChannelId"),
    ]);
    return Response.json({
      "documents.ttlHours": documentsTtlHours,
      "wanted.enabled": wantedEnabled,
      "wanted.channelId": wantedChannelId,
      "fines.dueDays": finesDueDays,
      "fines.channelId": finesChannelId,
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
    return Response.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
