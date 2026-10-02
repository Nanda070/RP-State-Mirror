import { z } from "zod";

export const SNOWFLAKE_RE = /^\d{17,20}$/;

export const snowflakeSchema = z.string().regex(SNOWFLAKE_RE, "must be a Discord ID (17-20 digits)");

const snowflakeListSchema = z
  .string()
  .default("")
  .transform((raw, ctx) => {
    const ids = raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const invalid = ids.filter((id) => !SNOWFLAKE_RE.test(id));
    if (invalid.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid Discord IDs: ${invalid.join(", ")}` });
      return z.NEVER;
    }
    return [...new Set(ids)];
  });

export const baseEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  SUPER_ADMIN_USER_IDS: snowflakeListSchema,
});

export const botEnvSchema = baseEnvSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(1),
});

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
});

export type BaseEnv = z.output<typeof baseEnvSchema>;
export type BotEnv = z.output<typeof botEnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

export function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new EnvError(`Invalid environment variables:\n${lines.join("\n")}`);
  }
  return result.data;
}
