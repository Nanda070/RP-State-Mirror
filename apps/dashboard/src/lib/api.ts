import { AuthRequiredError, ForbiddenError } from "./session";

export function jsonError(error: unknown): Response {
  if (error instanceof AuthRequiredError || error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: "Неизвестная ошибка" }, { status: 500 });
}
