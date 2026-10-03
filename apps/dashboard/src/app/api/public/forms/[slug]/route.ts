import { getPublicForm, LOCKDOWN_MESSAGE, submitPublicForm, UserError } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { isSameOrigin } from "@/lib/public-request";
import { publicLockedOut } from "@/lib/session";

type RouteContext = { params: Promise<{ slug: string }> };

const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  values: z.record(z.unknown()),
  /** Honeypot: hidden from people, filled in by naive bots. */
  website: z.string().max(200).nullish(),
});

/** Public, unauthenticated. The form's own expiry and response limit apply. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    }
    if (await publicLockedOut()) {
      return Response.json({ error: LOCKDOWN_MESSAGE }, { status: 503 });
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Слишком большой ответ" }, { status: 413 });
    }
    const body = bodySchema.parse(JSON.parse(text));
    const { slug } = await params;
    const form = await getPublicForm(slug);
    if (!form) return Response.json({ error: "Форма не найдена или закрыта" }, { status: 404 });

    // Pretend success so the bot does not learn that the trap worked.
    if (body.website) return Response.json({ ok: true, message: form.successMessage });

    await submitPublicForm(slug, body.values);
    return Response.json({ ok: true, message: form.successMessage });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    if (error instanceof UserError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
