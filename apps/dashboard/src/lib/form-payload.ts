import { FORM_FIELD_TYPES } from "@mirror/core";
import { z } from "zod";

/**
 * Wire format of the form editor. Shape only: the business rules (unique keys, options for
 * choice fields, delivery target, slug) are enforced by `createDiscordForm` / `updateForm` in core.
 */
export const formPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  webhookUrl: z.string().nullish(),
  deliveryChannelId: z.string().nullish(),
  expiresAt: z.string().datetime().nullish(),
  responseLimit: z.number().int().nullish(),
  publicEnabled: z.boolean().default(false),
  slug: z.string().nullish(),
  captchaRequired: z.boolean().default(true),
  ipLimitPerHour: z.number().int().default(3),
  successMessage: z.string().nullish(),
  fields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(FORM_FIELD_TYPES),
        required: z.boolean().default(false),
        helpText: z.string().nullish(),
        options: z.array(z.string()).default([]),
        validation: z
          .object({
            minLength: z.number().optional(),
            maxLength: z.number().optional(),
            min: z.number().optional(),
            max: z.number().optional(),
          })
          .default({}),
      }),
    )
    .max(50),
});

export type FormPayload = z.infer<typeof formPayloadSchema>;

/** Empty strings from inputs mean «not set». */
export function normalizeFormPayload(payload: FormPayload) {
  const blank = (value: string | null | undefined) => value?.trim() || null;
  return {
    name: payload.name,
    description: blank(payload.description),
    webhookUrl: blank(payload.webhookUrl),
    deliveryChannelId: blank(payload.deliveryChannelId),
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    responseLimit: payload.responseLimit ?? null,
    publicEnabled: payload.publicEnabled,
    slug: blank(payload.slug),
    captchaRequired: payload.captchaRequired,
    ipLimitPerHour: payload.ipLimitPerHour,
    successMessage: blank(payload.successMessage),
    fields: payload.fields.map((field) => ({
      key: field.key.trim(),
      label: field.label,
      type: field.type,
      required: field.required,
      helpText: blank(field.helpText),
      options: field.options.map((option) => option.trim()).filter(Boolean),
      validation: field.validation,
    })),
  };
}
