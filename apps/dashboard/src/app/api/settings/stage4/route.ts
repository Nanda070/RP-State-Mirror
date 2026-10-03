import {
  createDiscordForm,
  closeFeedbackTicket,
  addFeedbackMessage,
  listFeedbackTickets,
  listIcBlacklistEntries,
  listWebhookRequests,
  getSetting,
  isSettingKey,
  setSetting,
  setWebhookRequestStatus,
  type SettingKey,
} from "@mirror/core";
import { prisma, RecordStatus, type WebhookRequestStatus } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const settingKeys = [
  "registrations.ttlDays",
  "registrations.vehicleChannelId",
  "registrations.uniformChannelId",
  "registrations.coordinatorRoleIds",
  "transfers.channelId",
  "transfers.approvalDmText",
  "webhooks.notifyChannelId",
  "feedback.notifyChannelId",
  "icBlacklist.enabled",
  "icBlacklist.channelId",
  "icBlacklist.managerRoleIds",
  "icBlacklist.searchRoleIds",
  "invites.guildIds",
  "invites.defaultMaxAgeSeconds",
  "tokens.expandThresholdPercent",
  "tokens.finderRoleIds",
] as const;

const snowflake = z.string().regex(/^\d{17,20}$/);

const bodySchema = z.object({
  settings: z.record(z.unknown()).optional(),
  form: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).nullable().optional(),
      webhookUrl: z.string().url().nullable().optional(),
      deliveryChannelId: snowflake.nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      responseLimit: z.number().int().positive().nullable().optional(),
      fields: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
            label: z.string().trim().min(1).max(45),
            type: z.enum(["short", "paragraph"]).default("short"),
            required: z.boolean().default(false),
          }),
        )
        .min(1)
        .max(5),
    })
    .optional(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const [settings, forms] = await Promise.all([
      Promise.all(settingKeys.map(async (key) => [key, await getSetting(key)] as const)),
      prisma.discordForm.findMany({
        where: { status: RecordStatus.ACTIVE },
        include: { fields: { orderBy: { position: "asc" } }, _count: { select: { submissions: true } } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    ]);
    return Response.json({
      settings: Object.fromEntries(settings),
      forms,
      feedback: await listFeedbackTickets(),
      webhookRequests: await listWebhookRequests({ limit: 40 }),
      icBlacklist: await listIcBlacklistEntries({ limit: 40 }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close-feedback"), id: z.string().min(1) }),
  z.object({ action: z.literal("reply-feedback"), id: z.string().min(1), content: z.string().trim().min(1).max(4000) }),
  z.object({
    action: z.literal("webhook-status"),
    id: z.string().min(1),
    status: z.enum(["PENDING", "FORM_BUILT", "CLOSED", "REJECTED"]),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const action = actionSchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    if (action.action === "close-feedback") {
      return Response.json(await closeFeedbackTicket(action.id, context));
    }
    if (action.action === "webhook-status") {
      return Response.json(
        await setWebhookRequestStatus(action.id, action.status as WebhookRequestStatus, undefined, context),
      );
    }
    return Response.json(await addFeedbackMessage(action.id, session.user.id, action.content, context));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = bodySchema.parse(await request.json());
    const context = await dashboardAuditContext(session.user.id);
    const updated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.settings ?? {})) {
      if (!isSettingKey(key) || !settingKeys.includes(key as (typeof settingKeys)[number])) continue;
      updated[key] = await setSetting(key as SettingKey, value as never, context);
    }

    let form = null;
    if (body.form) {
      form = await createDiscordForm(
        {
          name: body.form.name,
          description: body.form.description ?? null,
          webhookUrl: body.form.webhookUrl ?? null,
          deliveryChannelId: body.form.deliveryChannelId ?? null,
          expiresAt: body.form.expiresAt ? new Date(body.form.expiresAt) : null,
          responseLimit: body.form.responseLimit ?? null,
          fields: body.form.fields,
          createdByDiscordId: session.user.id,
        },
        context,
      );
    }
    return Response.json({ settings: updated, form });
  } catch (error) {
    return jsonError(error);
  }
}
