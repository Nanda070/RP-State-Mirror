import {
  archiveMessageDesign,
  archiveSentMessage,
  cancelScheduledMessageSend,
  createMessageDesign,
  embedSpecSchema,
  enqueueMessageDesignResend,
  enqueueMessageDesignSend,
  enqueueMessageImport,
  getMessageDesign,
  getMessageImport,
  listMessageDesigns,
  listScheduledMessageSends,
  listSentMessages,
  scheduleMessageDesignSend,
  updateMessageDesign,
} from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireSystemSettings } from "@/lib/session";

const designBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  spec: embedSpecSchema,
});

const patchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    spec: embedSpecSchema.optional(),
  }),
  z.object({ op: z.literal("archive"), id: z.string().min(1) }),
  z.object({
    op: z.literal("send"),
    designId: z.string().min(1),
    guildDiscordId: z.string().regex(/^\d{17,20}$/),
    channelDiscordId: z.string().regex(/^\d{17,20}$/),
    variables: z.record(z.string().max(1000)).optional(),
    /** ISO time with an offset; absent — send right away. */
    sendAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ op: z.literal("resend"), sentMessageId: z.string().min(1) }),
  z.object({ op: z.literal("cancel_scheduled"), jobId: z.string().min(1) }),
  /** Read an existing Discord message into the editor (the bot does it; the result is polled). */
  z.object({ op: z.literal("import_message"), link: z.string().min(1).max(300) }),
  z.object({ op: z.literal("archive_sent"), id: z.string().min(1) }),
]);

export async function GET(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const url = new URL(request.url);
    const importJob = url.searchParams.get("importJob");
    if (importJob) return Response.json(await getMessageImport(importJob, session.user.discordId));
    const id = url.searchParams.get("id");
    if (id) {
      const design = await getMessageDesign(id);
      if (!design) return Response.json({ error: "Шаблон не найден" }, { status: 404 });
      return Response.json({ design });
    }
    const [designs, sent, scheduled] = await Promise.all([
      listMessageDesigns(false),
      listSentMessages(40),
      listScheduledMessageSends(),
    ]);
    return Response.json({ designs, sent, scheduled });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = designBodySchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);
    const design = await createMessageDesign(body, ctx);
    return Response.json({ design }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { session } = await requireSystemSettings();
    const body = patchSchema.parse(await request.json());
    const ctx = await dashboardAuditContext(session.user.id);

    if (body.op === "update") {
      const design = await updateMessageDesign(
        body.id,
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description ?? undefined }
            : {}),
          ...(body.spec !== undefined ? { spec: body.spec } : {}),
        },
        ctx,
      );
      return Response.json({ design });
    }
    if (body.op === "archive") {
      const design = await archiveMessageDesign(body.id, ctx);
      return Response.json({ design });
    }
    if (body.op === "send" && body.sendAt) {
      const job = await scheduleMessageDesignSend(
        {
          designId: body.designId,
          guildDiscordId: body.guildDiscordId,
          channelDiscordId: body.channelDiscordId,
          ...(body.variables ? { variables: body.variables } : {}),
          sendAt: body.sendAt,
        },
        ctx,
      );
      return Response.json({ jobId: job.id, sendAt: job.availableAt.toISOString() });
    }
    if (body.op === "send") {
      const job = await enqueueMessageDesignSend({
        designId: body.designId,
        guildDiscordId: body.guildDiscordId,
        channelDiscordId: body.channelDiscordId,
        ...(body.variables ? { variables: body.variables } : {}),
      });
      return Response.json({ jobId: job.id });
    }
    if (body.op === "import_message") {
      const job = await enqueueMessageImport(body.link, session.user.discordId);
      return Response.json({ jobId: job.id });
    }
    if (body.op === "cancel_scheduled") {
      await cancelScheduledMessageSend(body.jobId, ctx);
      return Response.json({ ok: true });
    }
    if (body.op === "resend") {
      const job = await enqueueMessageDesignResend(body.sentMessageId);
      return Response.json({ jobId: job.id });
    }
    const sent = await archiveSentMessage(body.id, ctx);
    return Response.json({ sent });
  } catch (error) {
    return jsonError(error);
  }
}
