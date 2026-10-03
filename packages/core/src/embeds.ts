/**
 * Embed specification types and utilities for the Mirror embed manager.
 *
 * Two formats are supported:
 *   - Classic embeds (v1): up to 10 Discord embeds, all standard fields.
 *   - Components V2 (v2): Discord's new component tree format.
 *
 * The same JSON spec is used in the DB, the editor, the bot's send/edit logic,
 * and button payloads. Variable substitution uses {name} placeholders.
 */
import { z } from "zod";

// ──────────────────────────────────────────────────────────────
// Classic embed field types
// ──────────────────────────────────────────────────────────────

export const embedFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().optional(),
});
export type EmbedField = z.infer<typeof embedFieldSchema>;

export const embedAuthorSchema = z.object({
  name: z.string().min(1).max(256),
  iconUrl: z.string().url().optional(),
  url: z.string().url().optional(),
});
export type EmbedAuthor = z.infer<typeof embedAuthorSchema>;

export const embedFooterSchema = z.object({
  text: z.string().min(1).max(2048),
  iconUrl: z.string().url().optional(),
});
export type EmbedFooter = z.infer<typeof embedFooterSchema>;

export const classicEmbedSchema = z.object({
  type: z.literal("embed"),
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  /** Discord color integer (0x000000–0xFFFFFF). */
  color: z.number().int().min(0).max(0xff_ff_ff).optional(),
  url: z.string().url().optional(),
  author: embedAuthorSchema.optional(),
  footer: embedFooterSchema.optional(),
  image: z.string().url().optional(),
  thumbnail: z.string().url().optional(),
  fields: z.array(embedFieldSchema).max(25).optional(),
  /** If true, Discord timestamp is appended. */
  timestamp: z.boolean().optional(),
});
export type ClassicEmbed = z.infer<typeof classicEmbedSchema>;

// ──────────────────────────────────────────────────────────────
// Components V2 types (simplified subset)
// ──────────────────────────────────────────────────────────────

export const v2TextDisplaySchema = z.object({
  type: z.literal("text_display"),
  content: z.string().max(4096),
});

export const v2MediaItemSchema = z.object({
  url: z.string().url(),
  description: z.string().max(1024).optional(),
});

export const v2MediaGallerySchema = z.object({
  type: z.literal("media_gallery"),
  items: z.array(v2MediaItemSchema).min(1).max(10),
});

export const v2SeparatorSchema = z.object({
  type: z.literal("separator"),
  divider: z.boolean().optional(),
  spacing: z.enum(["small", "large"]).optional(),
});

export const BUTTON_ACTIONS = [
  "role.toggle",
  "callback",
  "form.open",
  "feedback.open",
  "token.receive",
] as const;
export type ButtonActionName = (typeof BUTTON_ACTIONS)[number];

export const v2ButtonSchema = z.object({
  type: z.literal("button"),
  label: z.string().min(1).max(80),
  style: z.enum(["primary", "secondary", "success", "danger", "link"]).optional(),
  /** Resolved interactive id: mirror:<action>:<id>. Set on send if action+params given. */
  customId: z.string().max(100).optional(),
  url: z.string().url().optional(),
  emoji: z.string().optional(),
  disabled: z.boolean().optional(),
  /** Logical action stored in button_actions (role.toggle / callback). */
  action: z.enum(BUTTON_ACTIONS).optional(),
  params: z.record(z.unknown()).optional(),
});
export type V2Button = z.infer<typeof v2ButtonSchema>;

export const v2ActionRowSchema = z.object({
  type: z.literal("action_row"),
  components: z.array(v2ButtonSchema).min(1).max(5),
});
export type V2ActionRow = z.infer<typeof v2ActionRowSchema>;

export type V2Component =
  | z.infer<typeof v2TextDisplaySchema>
  | z.infer<typeof v2MediaGallerySchema>
  | z.infer<typeof v2SeparatorSchema>
  | z.infer<typeof v2ActionRowSchema>;

const v2ComponentSchema: z.ZodType<V2Component> = z.discriminatedUnion("type", [
  v2TextDisplaySchema,
  v2MediaGallerySchema,
  v2SeparatorSchema,
  v2ActionRowSchema,
]);

export const v2ContainerSchema = z.object({
  type: z.literal("container"),
  accentColor: z.number().int().min(0).max(0xff_ff_ff).optional(),
  components: z.array(v2ComponentSchema).min(1).max(10),
});

// ──────────────────────────────────────────────────────────────
// Top-level spec discriminated union
// ──────────────────────────────────────────────────────────────

export const embedSpecV1Schema = z.object({
  version: z.literal(1),
  embeds: z.array(classicEmbedSchema).min(1).max(10),
  /** Optional action rows (role toggle / callback buttons) attached under classic embeds. */
  components: z.array(v2ActionRowSchema).max(5).optional(),
});
export type EmbedSpecV1 = z.infer<typeof embedSpecV1Schema>;

export const embedSpecV2Schema = z.object({
  version: z.literal(2),
  components: z.array(v2ContainerSchema).min(1).max(5),
});
export type EmbedSpecV2 = z.infer<typeof embedSpecV2Schema>;

export const embedSpecSchema = z.discriminatedUnion("version", [embedSpecV1Schema, embedSpecV2Schema]);
export type EmbedSpec = z.infer<typeof embedSpecSchema>;

// ──────────────────────────────────────────────────────────────
// Variable substitution
// ──────────────────────────────────────────────────────────────

const VAR_REGEX = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractVariables(spec: EmbedSpec): string[] {
  const json = JSON.stringify(spec);
  const vars = new Set<string>();
  for (const match of json.matchAll(VAR_REGEX)) {
    const name = match[1];
    if (name) vars.add(name);
  }
  return [...vars].sort();
}

export function substituteVariables(spec: EmbedSpec, vars: Record<string, string>): EmbedSpec {
  const json = JSON.stringify(spec).replaceAll(VAR_REGEX, (_, name: string) => vars[name] ?? `{${name}}`);
  return JSON.parse(json) as EmbedSpec;
}

// ──────────────────────────────────────────────────────────────
// Discord limits check
// ──────────────────────────────────────────────────────────────

export interface LimitViolation {
  path: string;
  message: string;
}

export function checkDiscordLimits(spec: EmbedSpec): LimitViolation[] {
  const violations: LimitViolation[] = [];
  if (spec.version === 1) {
    let totalChars = 0;
    for (const [i, embed] of spec.embeds.entries()) {
      const prefix = `embeds[${i}]`;
      if (embed.title && embed.title.length > 256)
        violations.push({ path: `${prefix}.title`, message: "Заголовок: максимум 256 символов" });
      if (embed.description && embed.description.length > 4096)
        violations.push({ path: `${prefix}.description`, message: "Описание: максимум 4096 символов" });
      if (embed.footer?.text && embed.footer.text.length > 2048)
        violations.push({ path: `${prefix}.footer.text`, message: "Текст подвала: максимум 2048 символов" });
      if (embed.author?.name && embed.author.name.length > 256)
        violations.push({ path: `${prefix}.author.name`, message: "Имя автора: максимум 256 символов" });
      const fields = embed.fields ?? [];
      if (fields.length > 25)
        violations.push({ path: `${prefix}.fields`, message: "Максимум 25 полей в embed" });
      for (const [fi, field] of fields.entries()) {
        if (field.value.length > 1024)
          violations.push({ path: `${prefix}.fields[${fi}].value`, message: "Значение поля: максимум 1024 символа" });
      }
      totalChars += (embed.title?.length ?? 0) + (embed.description?.length ?? 0) +
        (embed.author?.name?.length ?? 0) + (embed.footer?.text?.length ?? 0) +
        fields.reduce((s, f) => s + f.name.length + f.value.length, 0);
    }
    if (totalChars > 6000)
      violations.push({ path: "embeds", message: "Суммарно в embed'ах максимум 6000 символов" });
  }
  return violations;
}

// ──────────────────────────────────────────────────────────────
// Button action custom_id helpers
// ──────────────────────────────────────────────────────────────

const PREFIX = "mirror";

export function makeCustomId(action: string, id: string): string {
  return `${PREFIX}:${action}:${id}`;
}

export function parseCustomId(customId: string): { action: string; id: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const action = parts[1];
  const id = parts[2];
  if (!action || !id) return null;
  return { action, id };
}

/**
 * Button panels are Classic specs that always carry a `components` array
 * (even when empty while editing), or V2 trees that include action rows.
 * Embed-only designs omit `components` on Classic and have no action rows on V2.
 * Tolerates malformed JSON from the DB so list pages never crash.
 */
export function isButtonPanelSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object" || !("version" in spec)) return false;
  const value = spec as EmbedSpec;
  if (value.version === 1) return Array.isArray(value.components);
  if (value.version !== 2 || !Array.isArray(value.components)) return false;
  return value.components.some(
    (container) =>
      Array.isArray(container?.components) &&
      container.components.some((node) => node?.type === "action_row"),
  );
}

/** Strip interactive rows so a design stays on the embeds page. */
export function stripButtonComponents(spec: EmbedSpec): EmbedSpec {
  if (spec.version === 1) {
    const { components: _components, ...rest } = spec;
    return rest;
  }
  const containers = (Array.isArray(spec.components) ? spec.components : [])
    .map((container) => ({
      ...container,
      type: "container" as const,
      components: (Array.isArray(container.components) ? container.components : []).filter(
        (node) => node.type !== "action_row",
      ),
    }))
    .filter((container) => container.components.length > 0);

  return {
    version: 2,
    components:
      containers.length > 0
        ? containers
        : [
            {
              type: "container",
              accentColor: 0xff6a1a,
              components: [{ type: "text_display", content: "Текст контейнера" }],
            },
          ],
  };
}
