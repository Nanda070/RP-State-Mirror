import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  FormError,
  MODULE_JOB_TYPES,
  clearFormDraft,
  createDiscordForm,
  discordFormSteps,
  discordWebhookUrlSchema,
  formSubmissionsCsv,
  formatFormValue,
  getDiscordForm,
  getFormDraft,
  getPublicForm,
  isDiscordCompatible,
  listFormColumns,
  saveFormDraft,
  submitDiscordForm,
  submitPublicForm,
  updateForm,
  validateFormValues,
  type FormFieldInput,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.forms.test" } as const;
const ADMIN = "830000000000000009";
const CHANNEL = "830000000000000100";

const FIELDS: FormFieldInput[] = [
  { key: "name", label: "Имя", type: "short", required: true, validation: { minLength: 2, maxLength: 20 } },
  { key: "about", label: "О себе", type: "paragraph" },
  { key: "age", label: "Возраст", type: "number", required: true, validation: { min: 16, max: 99 } },
  { key: "faction", label: "Фракция", type: "select", required: true, options: ["FIB", "LSPD"] },
  { key: "skills", label: "Навыки", type: "multiselect", options: ["вождение", "стрельба", "медицина"] },
  { key: "rules", label: "С правилами согласен", type: "checkbox", required: true },
  { key: "since", label: "Дата", type: "date" },
];

function makeForm(overrides: Record<string, unknown> = {}) {
  return createDiscordForm(
    { name: "Анкета", deliveryChannelId: CHANNEL, fields: FIELDS, createdByDiscordId: ADMIN, ...overrides },
    context,
  );
}

const VALID = { name: " Иван ", age: "21", faction: "FIB", skills: ["стрельба"], rules: "on", since: "2026-10-03" };

describe("form answers validation", () => {
  const fields = FIELDS.map((field, position) => ({
    key: field.key,
    label: field.label,
    type: field.type ?? "short",
    required: field.required ?? false,
    validation: field.validation ?? {},
    options: field.options ?? [],
    position,
  }));

  it("normalizes every field type", () => {
    expect(validateFormValues(fields, { ...VALID, about: "", unknown: "x", since: "3.10.2026" })).toEqual({
      name: "Иван",
      age: 21,
      faction: "FIB",
      skills: ["стрельба"],
      rules: true,
      since: "2026-10-03",
    });
    expect(validateFormValues(fields, { ...VALID, age: "18,5", skills: undefined, since: "" })).toMatchObject({
      age: 18.5,
      skills: [],
    });
  });

  it.each([
    [{ name: "" }, /Заполните поле «Имя»/],
    [{ name: "И" }, /не короче 2/],
    [{ name: "x".repeat(21) }, /не длиннее 20/],
    [{ age: "abc" }, /введите число/],
    [{ age: "15" }, /не меньше 16/],
    [{ age: "100" }, /не больше 99/],
    [{ faction: "EMS" }, /нет в списке/],
    [{ faction: "" }, /выберите вариант/],
    [{ skills: ["стрельба", "хакинг"] }, /нет в списке/],
    [{ rules: false }, /нужно отметить/],
    [{ since: "31.02.2026" }, /ДД\.ММ\.ГГГГ/],
    [{ since: "завтра" }, /ДД\.ММ\.ГГГГ/],
  ])("rejects %j", (patch, message) => {
    expect(() => validateFormValues(fields, { ...VALID, ...patch })).toThrow(message);
    expect(() => validateFormValues(fields, { ...VALID, ...patch })).toThrow(FormError);
  });

  it("formats values for humans", () => {
    expect(formatFormValue(true)).toBe("Да");
    expect(formatFormValue(false)).toBe("Нет");
    expect(formatFormValue(["a", "b"])).toBe("a, b");
    expect(formatFormValue([])).toBe("—");
    expect(formatFormValue(undefined)).toBe("—");
    expect(formatFormValue(7)).toBe("7");
  });
});

describe("form definition", () => {
  it("validates the definition itself", async () => {
    await expect(makeForm({ fields: [] })).rejects.toThrow(/хотя бы одно поле/);
    await expect(makeForm({ fields: [FIELDS[0], FIELDS[0]] })).rejects.toThrow(/уникальными/);
    await expect(makeForm({ fields: [{ key: "x", label: "X", type: "select" }] })).rejects.toThrow(/варианты выбора/);
    await expect(makeForm({ publicEnabled: true })).rejects.toThrow(/адрес/);
    await expect(makeForm({ slug: "A b" })).rejects.toThrow(/Адрес страницы/);
    await expect(makeForm({ webhookUrl: "https://evil.example/api/webhooks/1/abc" })).rejects.toThrow(/вебхука Discord/);
    await expect(makeForm({ deliveryChannelId: null })).rejects.toThrow(/канал доставки/);
  });

  it("accepts only Discord webhook URLs", () => {
    const ok = (url: string) => discordWebhookUrlSchema.safeParse(url).success;
    expect(ok("https://discord.com/api/webhooks/123456789012345678/AbC-_123")).toBe(true);
    expect(ok("https://canary.discord.com/api/v10/webhooks/123456789012345678/token")).toBe(true);
    expect(ok("http://discord.com/api/webhooks/1/abc")).toBe(false);
    expect(ok("https://discord.com.evil.example/api/webhooks/1/abc")).toBe(false);
    expect(ok("https://discord.com/api/webhooks/1/abc?wait=true#x")).toBe(false);
    expect(ok("https://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("knows what fits a Discord modal and splits long forms into steps", async () => {
    const form = await makeForm();
    expect(isDiscordCompatible(form.fields)).toBe(false);
    const text = form.fields.filter((field) => ["short", "paragraph", "number", "date"].includes(field.type));
    expect(isDiscordCompatible(text)).toBe(true);
    expect(discordFormSteps([1, 2, 3, 4, 5, 6, 7]).map((step) => step.length)).toEqual([5, 2]);
    expect(discordFormSteps([1, 2, 3, 4, 5])).toHaveLength(1);
  });

  it("updates fields by key: edits, adds, archives and restores without deleting", async () => {
    const form = await makeForm({ slug: "anketa" });
    await submitDiscordForm(form.id, VALID, ADMIN);
    await saveFormDraft(form.id, ADMIN, { name: "черновик" }, 1);

    const base = { name: "Анкета v2", deliveryChannelId: CHANNEL, slug: "anketa", publicEnabled: true };
    const updated = await updateForm(
      form.id,
      {
        ...base,
        fields: [
          { key: "age", label: "Полных лет", type: "number", required: true },
          { key: "name", label: "Имя", type: "short", required: true },
          { key: "discord", label: "Discord", type: "short" },
        ],
      },
      context,
    );
    expect(updated.fields.map((f) => [f.key, f.label, f.position])).toEqual([
      ["age", "Полных лет", 0],
      ["name", "Имя", 1],
      ["discord", "Discord", 2],
    ]);
    expect(await prisma.formField.count({ where: { formId: form.id } })).toBe(8);
    expect(await prisma.formField.count({ where: { formId: form.id, status: RecordStatus.ARCHIVED } })).toBe(5);
    expect(await getFormDraft(form.id, ADMIN)).toBeNull();
    // Archived columns are still listed, so old answers keep their labels.
    expect((await listFormColumns(form.id)).map((c) => c.key)).toContain("faction");

    const restored = await updateForm(
      form.id,
      { ...base, fields: [{ key: "faction", label: "Фракция", type: "select", options: ["FIB"] }] },
      context,
    );
    expect(restored.fields.map((f) => f.key)).toEqual(["faction"]);
    expect(await prisma.formField.count({ where: { formId: form.id } })).toBe(8);

    const other = await makeForm({ name: "Другая" });
    await expect(updateForm(other.id, { ...base, fields: [FIELDS[0] as FormFieldInput] }, context)).rejects.toThrow(
      /уже занят/,
    );
    expect(await prisma.auditLog.count({ where: { action: "form.updated" } })).toBe(2);
  });
});

describe("form submissions", () => {
  it("stores a public answer, marks its source and queues delivery", async () => {
    await makeForm({ slug: "anketa", publicEnabled: true });
    const submission = await submitPublicForm("ANKETA", VALID);
    expect(submission).toMatchObject({ source: "web", authorDiscordId: null });
    expect(submission.values).toMatchObject({ name: "Иван", age: 21, rules: true });
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.FORM_SUBMISSION_DELIVER } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "form.submitted" } });
    expect(audit).toMatchObject({ source: "web.form", actorType: AuditActorType.SYSTEM });
  });

  it("does not expose forms that are not public, disabled or expired", async () => {
    const hidden = await makeForm({ slug: "hidden" });
    expect(await getPublicForm("hidden")).toBeNull();
    await expect(submitPublicForm("hidden", VALID)).rejects.toThrow(/не найдена/);
    expect(await getDiscordForm(hidden.id)).not.toBeNull();

    await makeForm({ slug: "old", publicEnabled: true, expiresAt: new Date(Date.now() - 1000) });
    await expect(submitPublicForm("old", VALID)).rejects.toThrow(/истёк/);
  });

  it("honours the response limit for public answers too", async () => {
    await makeForm({ slug: "anketa", publicEnabled: true, responseLimit: 2 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => submitPublicForm("anketa", VALID)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    await expect(submitPublicForm("anketa", VALID)).rejects.toThrow(/Лимит ответов/);
  });

  it("keeps multi-step drafts per user and clears them on submit", async () => {
    const form = await makeForm();
    await saveFormDraft(form.id, ADMIN, { name: "Иван" }, 1);
    await saveFormDraft(form.id, ADMIN, { name: "Иван", age: 21 }, 2);
    await saveFormDraft(form.id, "830000000000000002", { name: "Пётр" }, 1);
    expect(await getFormDraft(form.id, ADMIN)).toMatchObject({ step: 2, values: { name: "Иван", age: 21 } });

    await submitDiscordForm(form.id, VALID, ADMIN);
    expect(await getFormDraft(form.id, ADMIN)).toBeNull();
    expect(await getFormDraft(form.id, "830000000000000002")).not.toBeNull();
    await clearFormDraft(form.id, "830000000000000002");
    expect(await prisma.formDraft.count()).toBe(0);
  });

  it("exports answers as CSV that spreadsheets cannot execute", async () => {
    const form = await makeForm({ slug: "anketa", publicEnabled: true });
    await submitPublicForm("anketa", { ...VALID, name: '=HYPERLINK("x")', about: 'кавычки "тут"; и точка с запятой' });
    const csv = await formSubmissionsCsv(form.id);
    const [header, row] = csv.replace(String.fromCharCode(0xfeff), "").trim().split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toContain('"Имя";"О себе";"Возраст"');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"кавычки ""тут""; и точка с запятой"');
    expect(row).toContain('"Да"');
    expect(row).toContain('"стрельба"');
  });
});
