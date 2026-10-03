import { FormRateLimitError, getPublicForm, submitPublicForm, UserError } from "@mirror/core";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { clientIp, isSameOrigin, verifyTurnstile } from "@/lib/public-request";

type RouteContext = { params: Promise<{ slug: string }> };

const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  values: z.record(z.unknown()),
  captchaToken: z.string().max(4096).nullish(),
  /** Honeypot: hidden from people, filled in by naive bots. */
  website: z.string().max(200).nullish(),
});

/** Public, unauthenticated: protected by same-origin check, honeypot, captcha, per-IP limit and IP bans. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: "Запрос отклонён" }, { status: 403 });
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

    const ip = clientIp(request.headers);
    if (form.captchaRequired && !(await verifyTurnstile(body.captchaToken, ip))) {
      return Response.json({ error: "Проверка «я не робот» не пройдена. Попробуйте ещё раз." }, { status: 400 });
    }

    await submitPublicForm(slug, body.values, { ipAddress: ip, userAgent: request.headers.get("user-agent") });
    return Response.json({ ok: true, message: form.successMessage });
  } catch (error) {
    if (error instanceof FormRateLimitError) {
      return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": "3600" } });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    if (error instanceof UserError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
