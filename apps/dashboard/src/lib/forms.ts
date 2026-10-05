import type { getFormForEdit } from "@mirror/core";
import type { FormBuilderField, FormBuilderValue } from "@/components/form-builder";

type EditableForm = NonNullable<Awaited<ReturnType<typeof getFormForEdit>>>;

const FIELD_TYPES: ReadonlySet<string> = new Set([
  "short",
  "paragraph",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "date",
]);

function numberText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function emptyFormBuilderValue(webhookUrl = ""): FormBuilderValue {
  return {
    id: null,
    name: "",
    description: "",
    webhookUrl,
    deliveryChannelId: "",
    expiresAt: "",
    responseLimit: "",
    publicEnabled: false,
    slug: "",
    successMessage: "",
    requiresDecision: false,
    deciderRoleIds: [],
    approvedDmText: "",
    rejectedDmText: "",
    fields: [
      {
        key: "name",
        label: "Имя",
        type: "short",
        required: true,
        helpText: "",
        options: [],
        minLength: "",
        maxLength: "",
        min: "",
        max: "",
      },
    ],
  };
}

export function toFormBuilderValue(form: EditableForm): FormBuilderValue {
  return {
    id: form.id,
    name: form.name,
    description: form.description ?? "",
    webhookUrl: form.webhookUrl ?? "",
    deliveryChannelId: form.deliveryChannelId ?? "",
    expiresAt: form.expiresAt?.toISOString() ?? "",
    responseLimit: form.responseLimit ? String(form.responseLimit) : "",
    publicEnabled: form.publicEnabled,
    slug: form.slug ?? "",
    successMessage: form.successMessage ?? "",
    requiresDecision: form.requiresDecision,
    deciderRoleIds: form.deciderRoleIds,
    approvedDmText: form.approvedDmText ?? "",
    rejectedDmText: form.rejectedDmText ?? "",
    fields: form.fields.map((field): FormBuilderField => {
      const validation =
        field.validation && typeof field.validation === "object" && !Array.isArray(field.validation)
          ? (field.validation as Record<string, unknown>)
          : {};
      return {
        key: field.key,
        label: field.label,
        type: (FIELD_TYPES.has(field.type) ? field.type : "short") as FormBuilderField["type"],
        required: field.required,
        helpText: field.helpText ?? "",
        options: Array.isArray(field.options)
          ? field.options.filter((option): option is string => typeof option === "string")
          : [],
        minLength: numberText(validation, "minLength"),
        maxLength: numberText(validation, "maxLength"),
        min: numberText(validation, "min"),
        max: numberText(validation, "max"),
      };
    }),
  };
}
