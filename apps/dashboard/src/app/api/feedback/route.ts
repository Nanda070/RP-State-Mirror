import {
  UserError,
  addFeedbackMessage,
  assignFeedbackTicket,
  canManageModules,
  closeFeedbackTicket,
  createFeedbackTicket,
  getSetting,
} from "@mirror/core";
import { prisma } from "@mirror/db";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireIdentity, requireModuleManager, resolveFreshIdentity } from "@/lib/session";

const text = z
  .string()
  .trim()
  .min(1, "Напишите текст обращения.")
  .max(4000, "Текст длиннее 4000 символов. Сократите его.");
const createSchema = z.object({ category: z.string().trim().min(1, "Выберите категорию.").max(64), content: text });

const UNREADABLE = "Не удалось прочитать запрос. Обновите страницу.";

/** Players see the first problem in plain Russian, never a field path; checks without a message read as UNREADABLE. */
function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value, { errorMap: () => ({ message: UNREADABLE }) });
  if (!result.success) throw new UserError(result.error.issues[0]?.message ?? UNREADABLE);
  return result.data;
}

/** Any signed-in person opens a ticket; staff are told in the feedback channel, as with the Discord button. */
export async function POST(request: Request) {
  try {
    const { session } = await requireIdentity();
    const body = parseBody(createSchema, await request.json());
    const categories = await getSetting("feedback.categories");
    if (!categories.includes(body.category)) throw new UserError("Такой категории больше нет. Обновите страницу.");
    const ticket = await createFeedbackTicket(
      { authorDiscordId: session.user.discordId, category: body.category, content: body.content },
      await dashboardAuditContext(session.user.id),
    );
    return Response.json({ id: ticket.id });
  } catch (error) {
    return jsonError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  /** The author writes again in their own ticket. */
  z.object({ action: z.literal("reply-own"), id: z.string().min(1), content: text }),
  z.object({ action: z.literal("reply"), id: z.string().min(1), content: text }),
  z.object({ action: z.literal("close"), id: z.string().min(1) }),
  z.object({
    action: z.literal("assign"),
    id: z.string().min(1),
    assigneeDiscordId: z
      .string()
      .regex(/^\d{17,20}$/)
      .nullable(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const body = parseBody(actionSchema, await request.json());

    if (body.action === "reply-own") {
      const { session } = await requireIdentity();
      const ticket = await prisma.feedbackTicket.findUnique({ where: { id: body.id }, select: { authorDiscordId: true } });
      if (!ticket || ticket.authorDiscordId !== session.user.discordId) throw new UserError("Обращение не найдено.");
      await addFeedbackMessage(body.id, session.user.discordId, body.content, await dashboardAuditContext(session.user.id));
      return Response.json({ ok: true });
    }

    // Answering, closing and assigning: «Админ» and above.
    const { session } = await requireModuleManager();
    const context = await dashboardAuditContext(session.user.id);
    if (body.action === "reply") {
      await addFeedbackMessage(body.id, session.user.discordId, body.content, context);
      return Response.json({ ok: true });
    }
    if (body.action === "close") {
      await closeFeedbackTicket(body.id, context);
      return Response.json({ ok: true });
    }
    if (body.assigneeDiscordId && !canManageModules(await resolveFreshIdentity(body.assigneeDiscordId))) {
      throw new UserError("Ответственным может быть только администратор.");
    }
    const ticket = await assignFeedbackTicket(body.id, body.assigneeDiscordId, context);
    return Response.json({ ok: true, status: ticket.status });
  } catch (error) {
    return jsonError(error);
  }
}
