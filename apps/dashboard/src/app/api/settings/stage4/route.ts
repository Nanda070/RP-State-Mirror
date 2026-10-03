import {
  archiveDiscordForm,
  createDiscordForm,
  closeFeedbackTicket,
  addFeedbackMessage,
  disableDiscordForm,
  enableDiscordForm,
  listFeedbackTickets,
  listIcBlacklistEntries,
  listWebhookRequests,
  getSetting,
  isSettingKey,
  publishDiscordFormOpen,
  publishFeedbackOpen,
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
  "transfers.pingRoleIds",
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
      webhookUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
      deliveryChannelId: z.union([snowflake, z.literal("")]).nullable().optional(),
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
    .superRefine((data, ctx) => {
      const webhook = data.webhookUrl?.trim() || null;
      const channel = data.deliveryChannelId?.trim() || null;
      if (!webhook && !channel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Укажите канал доставки и/или webhook URL для ответов формы.",
          path: ["deliveryChannelId"],
        });
      }
    })
    .optional(),
});

export async function GET() {
  try {
    await requireSystemSettings();
    const [settings, forms] = await Promise.all([
      Promise.all(settingKeys.map(async (key) => [key, await getSetting(key)] as const)),
      prisma.discordForm.findMany({
        where: { status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
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
  z.object({
    action: z.literal("publish-form-open"),
    formId: z.string().min(1),
    guildDiscordId: snowflake,
    channelDiscordId: snowflake,
  }),
  z.object({
    action: z.literal("publish-feedback-open"),
    guildDiscordId: snowflake,
    channelDiscordId: snowflake,
  }),
  z.object({ action: z.literal("disable-form"), formId: z.string().min(1) }),
  z.object({ action: z.literal("enable-form"), formId: z.string().min(1) }),
  z.object({ action: z.literal("archive-form"), formId: z.string().min(1) }),
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
    if (action.action === "publish-form-open") {
      return Response.json(
        await publishDiscordFormOpen(
          {
            formId: action.formId,
            guildDiscordId: action.guildDiscordId,
            channelDiscordId: action.channelDiscordId,
          },
          context,
        ),
      );
    }
    if (action.action === "publish-feedback-open") {
      return Response.json(
        await publishFeedbackOpen(
          {
            guildDiscordId: action.guildDiscordId,
            channelDiscordId: action.channelDiscordId,
          },
          context,
        ),
      );
    }
    if (action.action === "disable-form") {
      return Response.json(await disableDiscordForm(action.formId, context));
    }
    if (action.action === "enable-form") {
      return Response.json(await enableDiscordForm(action.formId, context));
    }
    if (action.action === "archive-form") {
      return Response.json(await archiveDiscordForm(action.formId, context));
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
      const webhookUrl = body.form.webhookUrl?.trim() || null;
      const deliveryChannelId = body.form.deliveryChannelId?.trim() || null;
      form = await createDiscordForm(
        {
          name: body.form.name,
          description: body.form.description ?? null,
          webhookUrl,
          deliveryChannelId,
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
