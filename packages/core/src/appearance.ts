import { prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

/**
 * Look of the dashboard for one person: a colour preset and, optionally, their own accent colour.
 * The colours themselves live in the dashboard's CSS (`[data-theme]` in globals.css).
 */
export const THEME_PRESETS = ["mirror", "midnight", "emerald", "crimson", "graphite"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export type Appearance = { theme: ThemePreset; accentColor: string | null };

export const DEFAULT_APPEARANCE: Appearance = { theme: "mirror", accentColor: null };

export const appearanceSchema = z.object({
  theme: z.enum(THEME_PRESETS),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Цвет — в виде #rrggbb.")
    .transform((value) => value.toLowerCase())
    .nullable(),
});

export function toAppearance(row: { theme: string | null; accentColor: string | null } | null): Appearance {
  const theme = (THEME_PRESETS as readonly string[]).includes(row?.theme ?? "") ? (row?.theme as ThemePreset) : "mirror";
  const accentColor = row?.accentColor && /^#[0-9a-f]{6}$/.test(row.accentColor) ? row.accentColor : null;
  return { theme, accentColor };
}

export async function getAppearance(discordId: string): Promise<Appearance> {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { theme: true, accentColor: true } });
  return toAppearance(user);
}

export async function setAppearance(discordId: string, input: z.input<typeof appearanceSchema>, context: AuditContext) {
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Не удалось сохранить оформление.");
  const value = parsed.data;
  return auditedMutation(context, "user.appearance_changed", "user", async (tx) => {
    const before = await tx.user.findUnique({ where: { discordId }, select: { theme: true, accentColor: true } });
    const user = await tx.user.upsert({
      where: { discordId },
      create: { discordId, theme: value.theme, accentColor: value.accentColor },
      update: { theme: value.theme, accentColor: value.accentColor },
    });
    return { entityId: user.id, before, after: value, result: toAppearance(user) };
  });
}
