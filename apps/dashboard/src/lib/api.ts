import { Prisma } from "@mirror/db";
import { RoleMappingError, SettingValidationError, UserError } from "@mirror/core";
import { ZodError } from "zod";
import { AuthRequiredError, ForbiddenError } from "./session";

function zodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Некорректные данные запроса";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function jsonError(error: unknown): Response {
  if (error instanceof AuthRequiredError || error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof SettingValidationError ||
    error instanceof RoleMappingError ||
    error instanceof UserError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: zodMessage(error) }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return Response.json({ error: "Конфликт уникальности данных" }, { status: 409 });
    }
    if (error.code === "P2025") {
      return Response.json({ error: "Запись не найдена" }, { status: 404 });
    }
    return Response.json({ error: "Ошибка базы данных" }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return Response.json({ error: "Некорректные данные для базы" }, { status: 400 });
  }
  if (error instanceof Error) {
    return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
  return Response.json({ error: "Неизвестная ошибка" }, { status: 500 });
}
