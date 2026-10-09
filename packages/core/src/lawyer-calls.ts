/**
 * «Вызов адвоката»: anyone on the ЧП server calls a lawyer to a place (`/вызов-адвоката` or the
 * button the dashboard publishes); one lawyer takes the call, or the caller cancels it while
 * nobody has.
 *
 * The bot posts the call in the channel where it was made, pings the lawyer roles and opens a
 * thread under it. Here are the checks and the record: who called, where, who took the call and
 * when. Two lawyers pressing «Принять вызов» at once cannot both take it — the second one is told
 * the call is taken.
 */
import { LawyerCallStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { toJsonValue } from "./db.js";
import { UserError } from "./errors.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { getSetting } from "./settings.js";

export const LAWYER_CALL_PLACES = [
  { value: "lspd_kpz", label: "КПЗ LSPD" },
  { value: "lssd_kpz", label: "КПЗ LSSD" },
  { value: "fib_office", label: "Офис FIB" },
  { value: "federal_prison", label: "Федеральная тюрьма" },
] as const;

export type LawyerCallPlace = (typeof LAWYER_CALL_PLACES)[number]["value"];

export function lawyerCallPlaceLabel(place: string): string {
  return LAWYER_CALL_PLACES.find((entry) => entry.value === place)?.label ?? place;
}

/**
 * The «Адвокат» role written in the code: used only while none is chosen in the dashboard
 * (Настройки → Модули → Вызов адвоката). Discord role ids of the ЧП server.
 */
export const LAWYER_ROLE_IDS_FALLBACK: readonly string[] = [];

/** The roles that are pinged and may take a call: the dashboard's choice, else the code's. */
export async function getLawyerRoleIds(): Promise<string[]> {
  const chosen = await getSetting("lawyerCalls.lawyerRoleIds");
  return chosen.length > 0 ? chosen : [...LAWYER_ROLE_IDS_FALLBACK];
}

const snowflake = z.string().regex(/^\d{17,20}$/);
/** Any text comes from Discord; only the places of the list pass. */
const placeSchema = z
  .string()
  .refine((value): value is LawyerCallPlace => LAWYER_CALL_PLACES.some((entry) => entry.value === value), "Выберите место из списка.");

const createSchema = z.object({
  callerDiscordId: snowflake,
  callerName: z.string().trim().min(1).max(128),
  guildDiscordId: snowflake.nullable(),
  channelDiscordId: snowflake,
  place: placeSchema,
});

async function assertIncidentGuild(guildDiscordId: string | null) {
  const incidentGuildId = await getSetting("core.incidentGuildId");
  if (!incidentGuildId || guildDiscordId !== incidentGuildId) {
    throw new UserError("Вызов адвоката работает только на сервере ЧП.");
  }
}

export async function createLawyerCall(input: z.input<typeof createSchema>, context: AuditContext) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Проверьте данные.");
  const data = parsed.data;
  await assertIncidentGuild(data.guildDiscordId);
  if ((await getLawyerRoleIds()).length === 0) {
    throw new UserError("Роль адвоката не настроена. Сообщите администрации.");
  }
  return auditedMutation(context, "lawyer_call.created", "lawyer_call", async (tx) => {
    const call = await tx.lawyerCall.create({
      data: {
        place: data.place,
        callerDiscordId: data.callerDiscordId,
        callerName: data.callerName,
        guildDiscordId: data.guildDiscordId!,
        channelDiscordId: data.channelDiscordId,
      },
    });
    return { entityId: call.id, after: call, result: call };
  });
}

/** Where the bot posted the call and opened its thread. */
export async function setLawyerCallMessage(id: string, message: { messageDiscordId: string; threadDiscordId: string | null }) {
  return prisma.lawyerCall.update({
    where: { id },
    data: { messageDiscordId: message.messageDiscordId, threadDiscordId: message.threadDiscordId },
  });
}

export async function getLawyerCall(id: string) {
  return prisma.lawyerCall.findUnique({ where: { id } });
}

function closedCallError(status: LawyerCallStatus | undefined): UserError {
  if (status === LawyerCallStatus.ACCEPTED) return new UserError("Вызов уже принят другим адвокатом.");
  if (status === LawyerCallStatus.CANCELLED) return new UserError("Вызов отменён.");
  return new UserError("Вызов не найден.");
}

/** «Принять вызов»: only a holder of the lawyer role, never the caller, and only once per call. */
export async function acceptLawyerCall(
  id: string,
  lawyer: { discordId: string; roleIds: readonly string[] },
  context: AuditContext,
) {
  const lawyerRoleIds = await getLawyerRoleIds();
  if (!lawyerRoleIds.some((roleId) => lawyer.roleIds.includes(roleId))) {
    throw new UserError("Принять вызов может только адвокат.");
  }
  return auditedMutation(context, "lawyer_call.accepted", "lawyer_call", async (tx) => {
    const current = await tx.lawyerCall.findUnique({ where: { id } });
    if (!current) throw closedCallError(undefined);
    if (current.callerDiscordId === lawyer.discordId) throw new UserError("Свой вызов принять нельзя.");
    const now = new Date();
    const { count } = await tx.lawyerCall.updateMany({
      where: { id, status: LawyerCallStatus.PENDING },
      data: { status: LawyerCallStatus.ACCEPTED, acceptedByDiscordId: lawyer.discordId, acceptedAt: now },
    });
    if (count !== 1) {
      const latest = await tx.lawyerCall.findUnique({ where: { id }, select: { status: true } });
      throw closedCallError(latest?.status);
    }
    const call = await tx.lawyerCall.findUniqueOrThrow({ where: { id } });
    return {
      entityId: id,
      before: { status: current.status },
      after: { status: call.status, acceptedByDiscordId: lawyer.discordId },
      result: call,
    };
  });
}

/** «Отменить»: the caller, while no lawyer has taken the call. */
export async function cancelLawyerCall(id: string, actorDiscordId: string, context: AuditContext) {
  return auditedMutation(context, "lawyer_call.cancelled", "lawyer_call", async (tx) => {
    const current = await tx.lawyerCall.findUnique({ where: { id } });
    if (!current) throw closedCallError(undefined);
    if (current.callerDiscordId !== actorDiscordId) throw new UserError("Отменить вызов может только тот, кто его сделал.");
    const { count } = await tx.lawyerCall.updateMany({
      where: { id, status: LawyerCallStatus.PENDING },
      data: { status: LawyerCallStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (count !== 1) {
      const latest = await tx.lawyerCall.findUnique({ where: { id }, select: { status: true } });
      throw closedCallError(latest?.status);
    }
    const call = await tx.lawyerCall.findUniqueOrThrow({ where: { id } });
    return { entityId: id, before: { status: current.status }, after: { status: call.status }, result: call };
  });
}

const publishPanelSchema = z.object({
  channelDiscordId: snowflake,
  messageText: z.string().trim().max(2000).nullable().optional(),
});

export const LAWYER_CALL_PANEL_TEXT = "Для вызова адвоката нажмите кнопку ниже.";

/** Queue the message with the «Вызвать адвоката» button into a channel of the ЧП server. */
export async function publishLawyerCallPanel(input: z.input<typeof publishPanelSchema>, context: AuditContext) {
  const data = publishPanelSchema.parse(input);
  const incidentGuildId = await getSetting("core.incidentGuildId");
  if (!incidentGuildId) throw new UserError("Сначала задайте сервер ЧП.");
  const channel = await prisma.discordChannel.findFirst({
    where: { discordId: data.channelDiscordId, guild: { discordId: incidentGuildId } },
    select: { id: true },
  });
  if (!channel) throw new UserError("Выберите канал сервера ЧП.");
  const payload = {
    guildDiscordId: incidentGuildId,
    channelDiscordId: data.channelDiscordId,
    messageText: data.messageText?.trim() || null,
  };
  return auditedMutation(context, "lawyer_call.panel_publish_queued", "system_setting", async (tx) => {
    await enqueueJob({ type: MODULE_JOB_TYPES.LAWYER_CALL_PANEL_PUBLISH, payload }, tx);
    return { entityId: "lawyerCalls.openMessage", after: payload, result: payload };
  });
}

/** Persist the last published panel (called by the bot worker), so a new publish edits it. */
export async function setLawyerCallOpenMessage(message: {
  guildDiscordId: string;
  channelDiscordId: string;
  messageDiscordId: string;
}) {
  const parsed = z.object({ guildDiscordId: snowflake, channelDiscordId: snowflake, messageDiscordId: snowflake }).parse(message);
  await prisma.systemSetting.upsert({
    where: { key: "lawyerCalls.openMessage" },
    create: { key: "lawyerCalls.openMessage", value: toJsonValue(parsed) },
    update: { value: toJsonValue(parsed) },
  });
  return parsed;
}
