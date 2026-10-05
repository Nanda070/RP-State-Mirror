/**
 * Form builder (§5.5): one form entity for Discord modals and public web pages.
 *
 * - Field types: short, paragraph, number, select, multiselect, checkbox, date.
 * - Discord modals only have text inputs, so a form is «Discord-compatible» when every field is
 *   short / paragraph / number / date (the last two are typed as text and validated here).
 *   Forms longer than 5 fields are filled in several modal steps; partial answers live in `form_drafts`.
 * - Public page `/f/<slug>`: expiry and response limit are enforced here.
 */
import { AuditActorType, DecisionStatus, RecordStatus, prisma, type FormField, type Prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";
import { toCsv } from "./exports.js";
import { createButtonAction } from "./message-designs.js";
import { enqueueFormSubmissionDecided, enqueueFormSubmissionDeliver } from "./module-jobs.js";
import { discordWebhookUrlSchema } from "./text.js";

export const FORM_FIELD_TYPES = ["short", "paragraph", "number", "select", "multiselect", "checkbox", "date"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_FIELD_TYPE_LABELS_RU: Record<FormFieldType, string> = {
  short: "Короткий текст",
  paragraph: "Абзац",
  number: "Число",
  select: "Выбор одного",
  multiselect: "Выбор нескольких",
  checkbox: "Флажок",
  date: "Дата",
};

/** Field types a Discord modal can collect (as text inputs). */
const DISCORD_TEXT_TYPES: ReadonlySet<string> = new Set<FormFieldType>(["short", "paragraph", "number", "date"]);

export const MAX_FORM_FIELDS = 25;
export const DISCORD_MODAL_FIELDS = 5;
const SHORT_MAX = 300;
const PARAGRAPH_MAX = 4000;

export class FormError extends UserError {
  override name = "FormError";
}

// ──────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────

export { discordWebhookUrlSchema };

const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(PARAGRAPH_MAX).optional(),
    maxLength: z.number().int().min(1).max(PARAGRAPH_MAX).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .default({});
export type FormFieldValidation = z.infer<typeof validationSchema>;

export const formFieldInputSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "Ключ поля: латинские буквы, цифры и _, начинается с буквы"),
    label: z.string().trim().min(1, "Укажите подпись поля").max(100),
    type: z.enum(FORM_FIELD_TYPES).default("short"),
    required: z.boolean().default(false),
    helpText: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .transform((value) => value || null),
    options: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
    validation: validationSchema,
  })
  .superRefine((field, ctx) => {
    const choice = field.type === "select" || field.type === "multiselect";
    if (choice && field.options.length === 0) {
      ctx.addIssue({ code: "custom", message: `Поле «${field.label}»: добавьте варианты выбора.`, path: ["options"] });
    }
    if (choice && new Set(field.options).size !== field.options.length) {
      ctx.addIssue({ code: "custom", message: `Поле «${field.label}»: варианты повторяются.`, path: ["options"] });
    }
    const { minLength, maxLength, min, max } = field.validation;
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      ctx.addIssue({ code: "custom", message: `Поле «${field.label}»: минимальная длина больше максимальной.` });
    }
    if (min !== undefined && max !== undefined && min > max) {
      ctx.addIssue({ code: "custom", message: `Поле «${field.label}»: минимум больше максимума.` });
    }
  });
export type FormFieldInput = z.input<typeof formFieldInputSchema>;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,47}$/, "Адрес страницы: 3–48 символов, латинские буквы, цифры и дефис");

const formBaseSchema = z.object({
  name: z.string().trim().min(1, "Укажите название формы").max(120),
  description: z.string().trim().max(1000).nullish(),
  webhookUrl: discordWebhookUrlSchema.nullish(),
  deliveryChannelId: z.string().regex(SNOWFLAKE_RE).nullish(),
  expiresAt: z.date().nullish(),
  responseLimit: z.number().int().positive().nullish(),
  fields: z.array(formFieldInputSchema).min(1, "Добавьте хотя бы одно поле").max(MAX_FORM_FIELDS),
  publicEnabled: z.boolean().default(false),
  slug: slugSchema.nullish(),
  successMessage: z.string().trim().max(500).nullish(),
  /** Answers get «Одобрить / Отказать» under them in the delivery channel. */
  requiresDecision: z.boolean().default(false),
  /** Roles that may decide, besides administrators. */
  deciderRoleIds: z.array(z.string().regex(SNOWFLAKE_RE)).max(25).default([]),
  approvedDmText: z.string().trim().max(1000).nullish(),
  rejectedDmText: z.string().trim().max(1000).nullish(),
});

function refineForm(data: z.infer<typeof formBaseSchema>, ctx: z.RefinementCtx) {
  if (!data.webhookUrl && !data.deliveryChannelId) {
    ctx.addIssue({
      code: "custom",
      message: "Укажите канал доставки и/или webhook URL для ответов формы.",
      path: ["deliveryChannelId"],
    });
  }
  if (data.requiresDecision && !data.deliveryChannelId) {
    ctx.addIssue({
      code: "custom",
      message:
        "Решение по ответам работает только при доставке в канал: под сообщением вебхука кнопки не нажимаются. Выберите канал.",
      path: ["deliveryChannelId"],
    });
  }
  const keys = data.fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "Ключи полей должны быть уникальными.", path: ["fields"] });
  }
  if (data.publicEnabled && !data.slug) {
    ctx.addIssue({ code: "custom", message: "Для публичной страницы укажите её адрес.", path: ["slug"] });
  }
}

export const createDiscordFormSchema = formBaseSchema
  .extend({ createdByDiscordId: z.string().min(1).max(32) })
  .superRefine(refineForm);
export type CreateDiscordFormInput = z.input<typeof createDiscordFormSchema>;

export const updateFormSchema = formBaseSchema.superRefine(refineForm);
export type UpdateFormInput = z.input<typeof updateFormSchema>;

// ──────────────────────────────────────────────────────────────
// Reading
// ──────────────────────────────────────────────────────────────

const ACTIVE_FIELDS = { where: { status: RecordStatus.ACTIVE }, orderBy: { position: "asc" } } as const;

/** ACTIVE form with its ACTIVE fields, or null (disabled and archived forms do not resolve). */
export async function getDiscordForm(formId: string) {
  return prisma.discordForm.findFirst({
    where: { id: formId, status: RecordStatus.ACTIVE },
    include: { fields: ACTIVE_FIELDS },
  });
}

export async function getPublicForm(slug: string) {
  return prisma.discordForm.findFirst({
    where: { slug: slug.toLowerCase(), publicEnabled: true, status: RecordStatus.ACTIVE },
    include: { fields: ACTIVE_FIELDS },
  });
}

export type PublicFormState = "open" | "disabled" | "expired" | "full";

/**
 * What the public address `/f/<slug>` shows: the form, or why it takes no responses.
 * A switched-off form keeps its address, so the visitor sees «отключена» instead of «не найдена»;
 * its name and questions are not returned in that case.
 */
export async function getPublicFormState(slug: string, now = new Date()) {
  const form = await prisma.discordForm.findFirst({
    where: { slug: slug.toLowerCase(), status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
    include: { fields: ACTIVE_FIELDS, _count: { select: { submissions: true } } },
  });
  if (!form) return null;
  if (!form.publicEnabled || form.status !== RecordStatus.ACTIVE) return { state: "disabled" as const, form: null };
  if (form.expiresAt !== null && form.expiresAt <= now) return { state: "expired" as const, form };
  if (form.responseLimit !== null && form._count.submissions >= form.responseLimit) {
    return { state: "full" as const, form };
  }
  return { state: "open" as const, form };
}

/** Form for the editor: any non-archived status, ACTIVE fields. */
export async function getFormForEdit(formId: string) {
  return prisma.discordForm.findFirst({
    where: { id: formId, status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
    include: { fields: ACTIVE_FIELDS, _count: { select: { submissions: true } } },
  });
}

export async function listForms() {
  return prisma.discordForm.findMany({
    where: { status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
    include: { fields: ACTIVE_FIELDS, _count: { select: { submissions: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export function isDiscordCompatible(fields: readonly Pick<FormField, "type">[]): boolean {
  return fields.every((field) => DISCORD_TEXT_TYPES.has(field.type));
}

/** Splits fields into modal steps of at most five inputs. */
export function discordFormSteps<T>(fields: readonly T[]): T[][] {
  const steps: T[][] = [];
  for (let index = 0; index < fields.length; index += DISCORD_MODAL_FIELDS) {
    steps.push(fields.slice(index, index + DISCORD_MODAL_FIELDS));
  }
  return steps;
}

// ──────────────────────────────────────────────────────────────
// Create / update
// ──────────────────────────────────────────────────────────────

function fieldRow(field: z.infer<typeof formFieldInputSchema>, position: number) {
  const choice = field.type === "select" || field.type === "multiselect";
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    helpText: field.helpText,
    options: toJsonValue(choice ? field.options : []),
    validation: toJsonValue(field.validation),
    position,
    status: RecordStatus.ACTIVE,
  };
}

async function assertSlugFree(tx: Prisma.TransactionClient, slug: string | null | undefined, exceptId?: string) {
  if (!slug) return;
  const taken = await tx.discordForm.findFirst({
    where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new FormError(`Адрес «${slug}» уже занят другой формой.`);
}

export async function createDiscordForm(input: CreateDiscordFormInput, context: AuditContext) {
  const data = createDiscordFormSchema.parse(input);
  return auditedMutation(context, "form.created", "form", async (tx) => {
    await assertSlugFree(tx, data.slug);
    const form = await tx.discordForm.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        webhookUrl: data.webhookUrl ?? null,
        deliveryChannelId: data.deliveryChannelId ?? null,
        expiresAt: data.expiresAt ?? null,
        responseLimit: data.responseLimit ?? null,
        createdByDiscordId: data.createdByDiscordId,
        slug: data.slug ?? null,
        publicEnabled: data.publicEnabled,
        successMessage: data.successMessage ?? null,
        requiresDecision: data.requiresDecision,
        deciderRoleIds: data.requiresDecision ? data.deciderRoleIds : [],
        approvedDmText: data.approvedDmText ?? null,
        rejectedDmText: data.rejectedDmText ?? null,
        fields: { create: data.fields.map(fieldRow) },
      },
      include: { fields: ACTIVE_FIELDS },
    });
    return { entityId: form.id, after: form, result: form };
  });
}

/**
 * Replaces the form definition. Fields are matched by `key`: existing ones are updated, new ones
 * created, missing ones archived (their key stays reserved, so old answers keep their labels and
 * re-adding the key restores the field).
 */
export async function updateForm(id: string, input: UpdateFormInput, context: AuditContext) {
  const data = updateFormSchema.parse(input);
  return auditedMutation(context, "form.updated", "form", async (tx) => {
    const current = await tx.discordForm.findFirst({
      where: { id, status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } },
      include: { fields: true },
    });
    if (!current) throw new FormError("Форма не найдена.");
    await assertSlugFree(tx, data.slug, id);

    const existingByKey = new Map(current.fields.map((field) => [field.key, field]));
    const wantedKeys = new Set(data.fields.map((field) => field.key));
    for (const [position, field] of data.fields.entries()) {
      const row = fieldRow(field, position);
      const existing = existingByKey.get(field.key);
      if (existing) await tx.formField.update({ where: { id: existing.id }, data: row });
      else await tx.formField.create({ data: { ...row, formId: id } });
    }
    const removed = current.fields.filter(
      (field) => field.status === RecordStatus.ACTIVE && !wantedKeys.has(field.key),
    );
    if (removed.length > 0) {
      await tx.formField.updateMany({
        where: { id: { in: removed.map((field) => field.id) } },
        data: { status: RecordStatus.ARCHIVED },
      });
    }

    const form = await tx.discordForm.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        webhookUrl: data.webhookUrl ?? null,
        deliveryChannelId: data.deliveryChannelId ?? null,
        expiresAt: data.expiresAt ?? null,
        responseLimit: data.responseLimit ?? null,
        slug: data.slug ?? null,
        publicEnabled: data.publicEnabled,
        successMessage: data.successMessage ?? null,
        requiresDecision: data.requiresDecision,
        deciderRoleIds: data.requiresDecision ? data.deciderRoleIds : [],
        approvedDmText: data.approvedDmText ?? null,
        rejectedDmText: data.rejectedDmText ?? null,
      },
      include: { fields: ACTIVE_FIELDS },
    });
    // Field layout changed, so half-filled multi-step answers no longer line up with the steps.
    await tx.formDraft.deleteMany({ where: { formId: id } });
    return { entityId: id, before: current, after: form, result: form };
  });
}

// ──────────────────────────────────────────────────────────────
// Validation of answers
// ──────────────────────────────────────────────────────────────

export type FormValue = string | number | boolean | string[];
type FieldDefinition = Pick<FormField, "key" | "label" | "type" | "required" | "validation" | "options">;

function readValidation(raw: unknown): FormFieldValidation {
  const parsed = validationSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function readOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

const TRUE_WORDS = new Set(["true", "on", "1", "yes", "да"]);

/** Accepts `YYYY-MM-DD` (web date input) and `ДД.ММ.ГГГГ` (typed in Discord); returns ISO date. */
function parseDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : ru ? [ru[3], ru[2], ru[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31.02 and similar: the calendar must round-trip.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function validateField(field: FieldDefinition, raw: unknown): FormValue | undefined {
  const fail = (message: string): never => {
    throw new FormError(`«${field.label}»: ${message}`);
  };
  const rules = readValidation(field.validation);
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";

  switch (field.type) {
    case "checkbox": {
      const checked = raw === true || (typeof raw === "string" && TRUE_WORDS.has(raw.trim().toLowerCase()));
      if (field.required && !checked) fail("нужно отметить.");
      return checked;
    }
    case "multiselect": {
      const options = readOptions(field.options);
      const picked = [...new Set((Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw]).map(String))];
      if (picked.some((item) => !options.includes(item))) fail("выбран вариант, которого нет в списке.");
      if (field.required && picked.length === 0) fail("выберите хотя бы один вариант.");
      return picked;
    }
    case "select": {
      if (!text) return field.required ? fail("выберите вариант.") : undefined;
      if (!readOptions(field.options).includes(text)) fail("выбран вариант, которого нет в списке.");
      return text;
    }
    case "number": {
      if (!text) return field.required ? fail("введите число.") : undefined;
      const value = Number(text.replace(",", "."));
      if (!Number.isFinite(value)) fail("введите число.");
      if (rules.min !== undefined && value < rules.min) fail(`не меньше ${rules.min}.`);
      if (rules.max !== undefined && value > rules.max) fail(`не больше ${rules.max}.`);
      return value;
    }
    case "date": {
      if (!text) return field.required ? fail("укажите дату.") : undefined;
      const date = parseDate(text);
      if (!date) return fail("дата в формате ДД.ММ.ГГГГ.");
      return date;
    }
    default: {
      if (!text) {
        if (field.required) throw new FormError(`Заполните поле «${field.label}».`);
        return undefined;
      }
      const limit = field.type === "paragraph" ? PARAGRAPH_MAX : SHORT_MAX;
      const max = Math.min(rules.maxLength ?? limit, limit);
      if (text.length > max) fail(`не длиннее ${max} символов.`);
      if (rules.minLength !== undefined && text.length < rules.minLength) fail(`не короче ${rules.minLength} символов.`);
      return text;
    }
  }
}

/**
 * Validates raw answers against field definitions and returns normalized values.
 * Unknown keys are dropped; empty optional fields are omitted.
 */
export function validateFormValues(
  fields: readonly FieldDefinition[],
  raw: Record<string, unknown>,
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {};
  for (const field of fields) {
    const value = validateField(field, raw[field.key]);
    if (value !== undefined) values[field.key] = value;
  }
  return values;
}

/** Human-readable answer for embeds, tables and CSV. */
export function formatFormValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "—";
  return String(value);
}

// ──────────────────────────────────────────────────────────────
// Submissions
// ──────────────────────────────────────────────────────────────

export interface SubmitFormMeta {
  authorDiscordId?: string | null;
  source: "discord" | "web";
}

type LoadedForm = NonNullable<Awaited<ReturnType<typeof getDiscordForm>>>;

async function storeSubmission(form: LoadedForm, raw: Record<string, unknown>, meta: SubmitFormMeta) {
  if (form.expiresAt && form.expiresAt <= new Date()) throw new FormError("Срок действия формы истёк.");
  const values = validateFormValues(form.fields, raw);
  const author = meta.authorDiscordId ?? null;
  const context: AuditContext = {
    actorType: author ? AuditActorType.USER : AuditActorType.SYSTEM,
    source: meta.source === "web" ? "web.form" : "discord.form",
    metadata: { authorDiscordId: author, formId: form.id },
  };
  return auditedMutation(context, "form.submitted", "form_submission", async (tx) => {
    // Lock the form row so concurrent submissions cannot both pass the limit checks.
    await tx.$queryRaw`SELECT id FROM forms WHERE id = ${form.id} FOR UPDATE`;
    if (form.responseLimit !== null) {
      const count = await tx.formSubmission.count({ where: { formId: form.id } });
      if (count >= form.responseLimit) throw new FormError("Лимит ответов формы исчерпан.");
    }
    const created = await tx.formSubmission.create({
      data: {
        formId: form.id,
        values: toJsonValue(values),
        authorDiscordId: author,
        source: meta.source,
        decision: form.requiresDecision ? DecisionStatus.PENDING : null,
      },
    });
    const submission = form.requiresDecision ? await addReviewButtons(tx, created.id) : created;
    if (form.webhookUrl || form.deliveryChannelId) {
      await enqueueFormSubmissionDeliver(submission.id, tx);
    }
    if (author) await tx.formDraft.deleteMany({ where: { formId: form.id, authorDiscordId: author } });
    return { entityId: submission.id, after: submission, result: submission };
  });
}

/** The two buttons under an answer that waits for a decision; the bot puts them on its message. */
async function addReviewButtons(tx: Prisma.TransactionClient, submissionId: string) {
  const approve = await createButtonAction("form.approve", { submissionId }, tx);
  const reject = await createButtonAction("form.reject", { submissionId }, tx);
  return tx.formSubmission.update({
    where: { id: submissionId },
    data: { reviewButtons: { approve: approve.customId, reject: reject.customId } },
  });
}

/** Submission from a Discord modal (or its last step). */
export async function submitDiscordForm(
  formId: string,
  values: Record<string, unknown>,
  authorDiscordId: string | null,
) {
  const form = await getDiscordForm(formId);
  if (!form) throw new FormError("Форма не найдена или отключена.");
  return storeSubmission(form, values, { authorDiscordId, source: "discord" });
}

/** Submission from the public page (no sign-in). */
export async function submitPublicForm(slug: string, values: Record<string, unknown>) {
  const form = await getPublicForm(slug);
  if (!form) throw new FormError("Форма не найдена или закрыта.");
  return storeSubmission(form, values, { source: "web" });
}

export async function listFormSubmissions(
  formId: string,
  /** `pending`: only the answers that wait for a decision. */
  options: { limit?: number; offset?: number; pending?: boolean } = {},
) {
  const where: Prisma.FormSubmissionWhereInput = {
    formId,
    ...(options.pending ? { decision: DecisionStatus.PENDING } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.formSubmission.count({ where }),
    prisma.formSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(options.limit ?? 50, 5000),
      skip: options.offset ?? 0,
    }),
  ]);
  return { total, items };
}

/** Every field the form ever had (archived included), so old answers can still be labelled. */
export async function listFormColumns(formId: string) {
  return prisma.formField.findMany({
    where: { formId },
    orderBy: [{ status: "asc" }, { position: "asc" }],
    select: { key: true, label: true, type: true, status: true },
  });
}

/** All answers of a form as CSV (UTF-8 with BOM, `;` separator — opens correctly in Excel). */
export async function formSubmissionsCsv(formId: string): Promise<string> {
  const [columns, { items }] = await Promise.all([
    listFormColumns(formId),
    listFormSubmissions(formId, { limit: 5000 }),
  ]);
  const header = ["Дата (UTC)", "Источник", "Discord ID", "Решение", ...columns.map((column) => column.label)];
  const rows = items.map((item) => {
    const values = (item.values ?? {}) as Record<string, unknown>;
    return [
      item.createdAt.toISOString(),
      item.source,
      item.authorDiscordId ?? "",
      item.decision ? FORM_DECISION_LABELS_RU[item.decision] : "",
      ...columns.map((column) => (column.key in values ? formatFormValue(values[column.key]) : "")),
    ];
  });
  return toCsv(header, rows);
}

// ──────────────────────────────────────────────────────────────
// Decisions on answers
// ──────────────────────────────────────────────────────────────

export const FORM_DECISION_LABELS_RU: Record<DecisionStatus, string> = {
  PENDING: "Ждёт решения",
  APPROVED: "Одобрено",
  REJECTED: "Отказано",
};

/**
 * One decision per answer; the author cannot decide their own. The bot then takes the buttons off
 * the message and tells the author (job `form.submission_decided`).
 */
export async function decideFormSubmission(
  id: string,
  decision: Exclude<DecisionStatus, "PENDING">,
  actorDiscordId: string,
  reason: string | null,
  context: AuditContext,
) {
  const rejectionReason = reason?.trim() ?? "";
  if (decision === DecisionStatus.REJECTED && !rejectionReason) throw new FormError("Укажите причину отказа.");
  return auditedMutation(context, `form_submission.${decision.toLowerCase()}`, "form_submission", async (tx) => {
    const current = await tx.formSubmission.findUnique({ where: { id } });
    if (!current) throw new FormError("Ответ не найден.");
    if (current.decision === null) throw new FormError("Этот ответ не требует решения.");
    if (current.authorDiscordId && current.authorDiscordId === actorDiscordId) {
      throw new FormError("Решение по своему ответу принимает другой человек.");
    }
    const { count } = await tx.formSubmission.updateMany({
      where: { id, decision: DecisionStatus.PENDING },
      data: {
        decision,
        decidedByDiscordId: actorDiscordId,
        decidedAt: new Date(),
        rejectionReason: decision === DecisionStatus.REJECTED ? rejectionReason : null,
      },
    });
    if (count !== 1) throw new FormError("Решение по этому ответу уже принято.");
    await tx.buttonAction.updateMany({
      where: { action: { in: ["form.approve", "form.reject"] }, params: { path: ["submissionId"], equals: id } },
      data: { status: RecordStatus.ARCHIVED },
    });
    const updated = await tx.formSubmission.findUniqueOrThrow({ where: { id } });
    await enqueueFormSubmissionDecided(id, tx);
    return {
      entityId: id,
      before: { decision: current.decision },
      after: { decision, decidedByDiscordId: actorDiscordId, rejectionReason: updated.rejectionReason },
      result: updated,
    };
  });
}

/** Where the bot posted the answer, so the message can be edited when the decision is made. */
export async function setFormSubmissionReviewMessage(id: string, message: { channelId: string; messageId: string }) {
  return prisma.formSubmission.update({
    where: { id },
    data: { reviewChannelId: message.channelId, reviewMessageId: message.messageId },
  });
}

/** Answers of live forms that still wait for a decision (the counter on the overview). */
export async function countPendingFormSubmissions(): Promise<number> {
  return prisma.formSubmission.count({
    where: { decision: DecisionStatus.PENDING, form: { status: { in: [RecordStatus.ACTIVE, RecordStatus.CLOSED] } } },
  });
}

// ──────────────────────────────────────────────────────────────
// Multi-step Discord drafts
// ──────────────────────────────────────────────────────────────

export async function getFormDraft(formId: string, authorDiscordId: string) {
  return prisma.formDraft.findUnique({ where: { formId_authorDiscordId: { formId, authorDiscordId } } });
}

/** Stores the answers collected so far and the index of the next step to show. */
export async function saveFormDraft(
  formId: string,
  authorDiscordId: string,
  values: Record<string, FormValue>,
  step: number,
) {
  return prisma.formDraft.upsert({
    where: { formId_authorDiscordId: { formId, authorDiscordId } },
    create: { formId, authorDiscordId, values: toJsonValue(values), step },
    update: { values: toJsonValue(values), step },
  });
}

export async function clearFormDraft(formId: string, authorDiscordId: string) {
  await prisma.formDraft.deleteMany({ where: { formId, authorDiscordId } });
}
