import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, DecisionStatus, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  canDecideFormSubmission,
  countPendingFormSubmissions,
  createDiscordForm,
  decideFormSubmission,
  formSubmissionsCsv,
  listFormSubmissions,
  submitDiscordForm,
  submitPublicForm,
  updateForm,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "improve.forms.test" } as const;
const ADMIN = "830000000000000009";
const AUTHOR = "830000000000000001";
const CHANNEL = "830000000000000100";
const DECIDER_ROLE = "830000000000000200";
const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_123-xyz";

function makeForm(overrides: Record<string, unknown> = {}) {
  return createDiscordForm(
    {
      name: "Набор в LSPD",
      deliveryChannelId: CHANNEL,
      createdByDiscordId: ADMIN,
      requiresDecision: true,
      deciderRoleIds: [DECIDER_ROLE],
      fields: [{ key: "name", label: "Имя", type: "short", required: true }],
      ...overrides,
    },
    context,
  );
}

const stored = (id: string) => prisma.formSubmission.findUniqueOrThrow({ where: { id } });

describe("form answers that need a decision", () => {
  it("needs delivery to a channel: buttons do not work under a plain webhook", async () => {
    await expect(makeForm({ deliveryChannelId: null, webhookUrl: WEBHOOK })).rejects.toThrow(/канал/i);
    const form = await makeForm();
    await expect(
      updateForm(
        form.id,
        {
          name: form.name,
          webhookUrl: WEBHOOK,
          requiresDecision: true,
          fields: [{ key: "name", label: "Имя", type: "short", required: true }],
        },
        context,
      ),
    ).rejects.toThrow(/канал/i);
  });

  it("marks a new answer as waiting and gives it its two buttons; a plain form does neither", async () => {
    const form = await makeForm();
    const answer = await submitDiscordForm(form.id, { name: "John" }, AUTHOR);
    expect(answer.decision).toBe(DecisionStatus.PENDING);
    const buttons = answer.reviewButtons as { approve?: string; reject?: string };
    expect(buttons.approve).toMatch(/^mirror:form\.approve:/);
    expect(buttons.reject).toMatch(/^mirror:form\.reject:/);
    expect(await prisma.buttonAction.count({ where: { status: RecordStatus.ACTIVE } })).toBe(2);

    const plain = await makeForm({ name: "Опрос", requiresDecision: false, deciderRoleIds: [] });
    const other = await submitDiscordForm(plain.id, { name: "John" }, AUTHOR);
    expect(other.decision).toBeNull();
    expect(other.reviewButtons).toEqual({});
  });

  it("takes one decision, by somebody other than the author, with a reason for a refusal", async () => {
    const form = await makeForm();
    const answer = await submitDiscordForm(form.id, { name: "John" }, AUTHOR);

    await expect(decideFormSubmission(answer.id, DecisionStatus.APPROVED, AUTHOR, null, context)).rejects.toThrow(
      /своему ответу/,
    );
    await expect(decideFormSubmission(answer.id, DecisionStatus.REJECTED, ADMIN, "  ", context)).rejects.toThrow(
      /причину/,
    );

    const decided = await decideFormSubmission(answer.id, DecisionStatus.REJECTED, ADMIN, "Мало опыта", context);
    expect(decided).toMatchObject({
      decision: DecisionStatus.REJECTED,
      decidedByDiscordId: ADMIN,
      rejectionReason: "Мало опыта",
    });
    expect(decided.decidedAt).toBeInstanceOf(Date);
    await expect(decideFormSubmission(answer.id, DecisionStatus.APPROVED, ADMIN, null, context)).rejects.toThrow(
      /уже принято/,
    );

    const job = await prisma.job.findFirstOrThrow({ where: { type: MODULE_JOB_TYPES.FORM_SUBMISSION_DECIDED } });
    expect(job.payload).toMatchObject({ submissionId: answer.id });
    expect(await prisma.buttonAction.count({ where: { status: RecordStatus.ACTIVE } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "form_submission.rejected", entityId: answer.id } })).toBe(1);
  });

  it("accepts exactly one of two decisions made at the same moment", async () => {
    const form = await makeForm();
    const answer = await submitDiscordForm(form.id, { name: "John" }, AUTHOR);
    const results = await Promise.allSettled([
      decideFormSubmission(answer.id, DecisionStatus.APPROVED, ADMIN, null, context),
      decideFormSubmission(answer.id, DecisionStatus.REJECTED, "830000000000000010", "нет", context),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await stored(answer.id)).decision).not.toBe(DecisionStatus.PENDING);
  });

  it("refuses to decide an answer of a form that asks for no decision", async () => {
    const plain = await makeForm({ requiresDecision: false, deciderRoleIds: [] });
    const answer = await submitDiscordForm(plain.id, { name: "John" }, AUTHOR);
    await expect(decideFormSubmission(answer.id, DecisionStatus.APPROVED, ADMIN, null, context)).rejects.toThrow(
      /не требует решения/,
    );
  });

  it("decides an answer from the public page, which has no author to tell", async () => {
    await makeForm({ publicEnabled: true, slug: "lspd-nabor" });
    const answer = await submitPublicForm("lspd-nabor", { name: "John" });
    expect(answer.decision).toBe(DecisionStatus.PENDING);
    const decided = await decideFormSubmission(answer.id, DecisionStatus.APPROVED, ADMIN, null, context);
    expect(decided.decision).toBe(DecisionStatus.APPROVED);
  });

  it("counts and lists the answers that still wait, and exports the decision", async () => {
    const form = await makeForm();
    const first = await submitDiscordForm(form.id, { name: "John" }, AUTHOR);
    await submitDiscordForm(form.id, { name: "Jane" }, "830000000000000002");
    await decideFormSubmission(first.id, DecisionStatus.APPROVED, ADMIN, null, context);

    expect(await countPendingFormSubmissions()).toBe(1);
    const waiting = await listFormSubmissions(form.id, { pending: true });
    expect(waiting.total).toBe(1);
    expect((waiting.items[0]?.values as { name: string }).name).toBe("Jane");
    expect((await listFormSubmissions(form.id)).total).toBe(2);

    const csv = await formSubmissionsCsv(form.id);
    expect(csv).toContain("Решение");
    expect(csv).toContain("Одобрено");
    expect(csv).toContain("Ждёт решения");
  });
});

describe("who may decide a form answer", () => {
  const nobody = { adminLevel: null, isSuperAdmin: false } as const;

  it("lets administrators and the form's roles decide, and nobody else", () => {
    expect(canDecideFormSubmission({ adminLevel: AdminLevel.ADMIN, isSuperAdmin: false }, [], [DECIDER_ROLE])).toBe(true);
    expect(canDecideFormSubmission(nobody, [DECIDER_ROLE], [DECIDER_ROLE])).toBe(true);
    expect(canDecideFormSubmission(nobody, ["830000000000000201"], [DECIDER_ROLE])).toBe(false);
    expect(canDecideFormSubmission({ adminLevel: AdminLevel.HELPER, isSuperAdmin: false }, [], [DECIDER_ROLE])).toBe(false);
  });
});
