/**
 * Bot job handlers: Discord delivery for Stage 3 modules.
 * Prefer channel send via bot; fall back to webhook URL from settings.
 * A handler that returns `{ status: "deferred" }` (target not configured yet) is put back by the worker
 * and tried again every few minutes — see `deferJob`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  MessageFlags,
  Routes,
  ThreadAutoArchiveDuration,
  type Client,
  type TextChannel,
} from "discord.js";
import { AuditActorType, prisma, RecordStatus, type Job } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  REGISTRATION_LEFT_REASON,
  finePaymentClaimsEnabled,
  getFinePaymentClaim,
  setFinePaymentClaimReviewMessage,
  setFormSubmissionReviewMessage,
  PERSONNEL_AUDIT_META,
  checkDiscordLimits,
  discordMessageToSpec,
  formatUserError,
  type RawDiscordMessage,
  discordIdentity,
  embedSpecSchema,
  formatPersonnelDetailsText,
  formatRoleMentions,
  makeFineOverdueEmbed,
  parseCustomId,
  substituteVariables,
  writeAuditEvent,
  createButtonAction,
  findDiscordIdByStatic,
  formatMoney,
  getSetting,
  wantsDm,
  type DmKind,
  type VehicleRequestPayload,
  makeCompactAuditEmbed,
  makeDocumentEmbed,
  makeFineEmbed,
  makeFinePaidEmbed,
  makeResponseEmbed,
  makeIcBlacklistEmbed,
  makeWantedDoneEmbed,
  makeWantedEmbed,
  discordMessageUrl,
  findFormForWebhookRequest,
  materializeEmbedSpecButtons,
  recordSentMessage,
  setDiscordFormOpenMessage,
  setFeedbackOpenMessage,
  setTokenReceiveOpenMessage,
  setLawyerCallOpenMessage,
  LAWYER_CALL_PANEL_TEXT,
  resolveDocumentResponseDelivery,
  resolveDocumentResponseLocalDelivery,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFactionPingRoleId,
  resolveIcBlacklistDelivery,
  resolveWantedPingRoleIds,
  resolveFineDelivery,
  resolveFinePaidDelivery,
  resolveRegistrationDelivery,
  resolveWantedDelivery,
  sameDeliveryChannel,
  readMediaFile,
  registrationKindLabel,
  resolveTransferPingRoleIds,
  setRegistrationReviewThread,
  setRegistrationReviewMessage,
  setTransferReviewMessage,
  toJsonValue,
  type ClassicEmbed,
  type DeliveryTarget,
  type EmbedSpec,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";
import { classicToEmbed, embedSpecToMessageOptions } from "./embed-payload.js";
import {
  buildRegistrationReview,
  buildTransferReview,
  editStoredReviewMessage,
  fetchReviewChannel,
  loadRegistration,
  loadTransfer,
  renderRegistrationReview,
  renderTransferReview,
} from "./stage4-review.js";
import { adminRolesApply } from "./admin-roles.js";
import { fineClaimButtons, fineClaimDm, fineClaimEmbed, finePaidRow } from "./fine-claim-review.js";
import { formDecisionDm, formSubmissionButtons, formSubmissionEmbed, loadFormSubmission } from "./form-review.js";
import { reconcileCpAccess } from "./cp-sync.js";
import type { JobHandler } from "./worker.js";

type EmbedSendResult =
  | { status: "sent"; messageId: string; channelId: string; guildId: string; spec: EmbedSpec }
  | { status: "deferred"; reason: string };

type StepResult = Record<string, unknown>;

function savedSteps(job: Job): Record<string, StepResult> {
  const result = job.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const steps = (result as { steps?: unknown }).steps;
  return steps && typeof steps === "object" && !Array.isArray(steps) ? (steps as Record<string, StepResult>) : {};
}

/**
 * Runs a side effect that must not repeat when the job is retried — a Discord post.
 * Its outcome is written to the job row as soon as it happens, so a retry after a later failure
 * (a database hiccup, a second target that is down) finds it and skips the step instead of posting again.
 */
async function runOnce<T extends StepResult>(job: Job, key: string, log: Logger, run: () => Promise<T>): Promise<T> {
  const steps = savedSteps(job);
  const saved = steps[key];
  if (saved) return saved as T;

  const value = await run();
  const next = { steps: { ...steps, [key]: value } };
  job.result = next as unknown as Job["result"];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.job.update({ where: { id: job.id }, data: { result: toJsonValue(next) } });
      break;
    } catch (error) {
      if (attempt === 3) {
        log.error({ err: error, step: key }, "could not checkpoint a finished step; a retry may repeat it");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  return value;
}

type SendEmbedOptions = {
  /** Makes the post happen once per job: `key` names the step inside the job. */
  once?: { job: Job; key: string };
  /** Buttons under the embed. Only a bot message can carry them: ignored for webhook delivery. */
  components?: ActionRowBuilder<ButtonBuilder>[];
  content?: string | null;
  /** Role snowflakes allowed to ping (parsed from content mentions). */
  mentionRoleIds?: readonly string[];
  /** User snowflakes allowed to ping (e.g. document author on /ответ). */
  mentionUserIds?: readonly string[];
};

/** Wrap a single classic embed as an EmbedSpec for sent-message persistence. */
function classicEmbedToSpec(embed: ClassicEmbed): EmbedSpec {
  return { version: 1, embeds: [embed] };
}

async function sendEmbed(
  client: Client,
  target: DeliveryTarget,
  classic: ClassicEmbed,
  log: Logger,
  options: SendEmbedOptions = {},
): Promise<EmbedSendResult> {
  if (target.kind === "unconfigured") {
    return { status: "deferred", reason: target.reason };
  }
  if (!options.once) return postEmbed(client, target, classic, log, options);

  const { job, key } = options.once;
  const posted = await runOnce(job, key, log, async () => {
    const result = await postEmbed(client, target, classic, log, options);
    if (result.status !== "sent") throw new Error("unexpected deferred send");
    return { messageId: result.messageId, channelId: result.channelId, guildId: result.guildId };
  });
  return { status: "sent", ...posted, spec: classicEmbedToSpec(classic) };
}

async function postEmbed(
  client: Client,
  target: Exclude<DeliveryTarget, { kind: "unconfigured" }>,
  classic: ClassicEmbed,
  log: Logger,
  options: SendEmbedOptions,
): Promise<EmbedSendResult> {

  const content = options.content?.trim() || undefined;
  const mentionRoleIds = [...new Set(options.mentionRoleIds ?? [])].filter((id) =>
    /^\d{17,20}$/.test(id),
  );
  const mentionUserIds = [...new Set(options.mentionUserIds ?? [])].filter((id) =>
    /^\d{17,20}$/.test(id),
  );

  const embed = classicToEmbed(classic);
  const spec = classicEmbedToSpec(classic);

  if (target.kind === "channel") {
    const guild = await client.guilds.fetch(target.guildDiscordId);
    const channel = (await guild.channels.fetch(target.channelDiscordId)) as TextChannel | null;
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Канал ${target.channelDiscordId} недоступен`);
    }
    const message = await channel.send({
      ...(content ? { content } : {}),
      embeds: [embed],
      ...(options.components?.length ? { components: options.components } : {}),
      allowedMentions: { parse: [], roles: mentionRoleIds, users: mentionUserIds },
    });
    return {
      status: "sent",
      messageId: message.id,
      channelId: channel.id,
      guildId: guild.id,
      spec,
    };
  }

  const webhookUrl = new URL(target.webhookUrl);
  webhookUrl.searchParams.set("wait", "true");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed.toJSON()],
      allowed_mentions: { parse: [], roles: mentionRoleIds, users: mentionUserIds },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook failed: ${response.status} ${body}`);
  }
  const data = (await response.json()) as { id?: string; channel_id?: string };
  const messageId = data.id;
  const channelId = data.channel_id ?? target.channelDiscordId ?? "unknown";
  if (!messageId) {
    log.warn("webhook response missing message id");
    return {
      status: "sent",
      messageId: `webhook-${Date.now()}`,
      channelId,
      guildId: target.guildDiscordId ?? "unknown",
      spec,
    };
  }
  return {
    status: "sent",
    messageId,
    channelId,
    guildId: target.guildDiscordId ?? "unknown",
    spec,
  };
}

async function persistSend(
  result: Extract<EmbedSendResult, { status: "sent" }>,
  link: {
    documentId?: string;
    responseId?: string;
    wantedId?: string;
    fineId?: string;
    personnelId?: string;
    icBlacklistId?: string;
  },
) {
  const sent = await recordSentMessage({
    guildDiscordId: result.guildId,
    channelDiscordId: result.channelId,
    messageDiscordId: result.messageId,
    spec: result.spec,
  });
  const data = {
    sentMessageId: sent.id,
    documentId: link.documentId ?? null,
    responseId: link.responseId ?? null,
    wantedId: link.wantedId ?? null,
    fineId: link.fineId ?? null,
    personnelId: link.personnelId ?? null,
    icBlacklistId: link.icBlacklistId ?? null,
  };
  // A retried job reaches this point again for a message it already linked.
  const existing = await prisma.sentMessageLink.findFirst({ where: data, select: { id: true } });
  if (!existing) await prisma.sentMessageLink.create({ data });
  return sent;
}

async function findLinkedMessage(wantedId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { wantedId },
    include: { sentMessage: true },
    orderBy: { createdAt: "desc" },
  });
}

async function findLinkedIcBlacklistMessage(entryId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { icBlacklistId: entryId },
    include: { sentMessage: true },
    orderBy: { createdAt: "desc" },
  });
}

async function findLinkedFineMessage(fineId: string) {
  return prisma.sentMessageLink.findFirst({
    where: { fineId },
    include: { sentMessage: true },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveAuthor(
  client: Client,
  discordId: string,
): Promise<{ displayName: string; username: string; avatarUrl: string }> {
  try {
    const user = await client.users.fetch(discordId);
    return {
      displayName: user.displayName || user.username,
      username: user.username,
      avatarUrl: user.displayAvatarURL({ size: 256 }),
    };
  } catch {
    return { displayName: discordId, username: discordId, avatarUrl: "" };
  }
}

const documentSend: JobHandler = async (payload, { client, log, job }) => {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const target = await resolveFactionDocumentDelivery(doc.factionCode);
  const actor = await resolveAuthor(client, doc.authorDiscordId);

  const classic = makeDocumentEmbed({
    actor,
    faction: doc.factionCode,
    docNumber: doc.number,
    description: doc.content,
    notifiedPerson: doc.notifiedPerson,
    forumLink: doc.forumLink,
    leaderText: doc.leaderText,
    deputyText: doc.deputyText,
  });

  const pingRoleId = await resolveFactionPingRoleId(doc.factionCode);
  const mention = pingRoleId ? formatRoleMentions([pingRoleId]) : "";
  const content = mention
    ? `Новый документ из правительства. ${mention} незамедлительно исполнить.`
    : "Новый документ из правительства.";

  const result = await sendEmbed(client, target, classic, log, {
    once: { job, key: "post" },
    content,
    mentionRoleIds: pingRoleId ? [pingRoleId] : [],
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { documentId: doc.id });
  return { status: "sent", documentNumber: doc.number, messageId: result.messageId };
};

const documentResponseSend: JobHandler = async (payload, { client, log, job }) => {
  const responseId = String(payload.responseId ?? "");
  const sourceGuildDiscordId =
    typeof payload.sourceGuildDiscordId === "string" ? payload.sourceGuildDiscordId : null;
  const response = await prisma.documentResponse.findUnique({
    where: { id: responseId },
    include: { document: true },
  });
  if (!response) throw new Error(`Document response ${responseId} not found`);

  // Dual delivery (legacy): GOV documents + documents channel of the guild where /ответ ran.
  const govTarget = await resolveDocumentResponseDelivery();
  const localTarget = await resolveDocumentResponseLocalDelivery(sourceGuildDiscordId);
  const actor = await resolveAuthor(client, response.authorDiscordId);
  const authorId = response.document.authorDiscordId;
  const responderId = response.authorDiscordId;
  const docNumber = response.document.number;

  const classic = makeResponseEmbed({
    docNumber,
    actor,
    personalFile: response.personalFile,
    video: response.video,
    comment: response.content,
  });

  const govResult = await sendEmbed(client, govTarget, classic, log, {
    once: { job, key: "gov" },
    content: `<@${authorId}>`,
    mentionUserIds: [authorId],
  });
  if (govResult.status === "deferred" && localTarget.kind === "unconfigured") {
    return govResult;
  }
  if (govResult.status === "sent") {
    await persistSend(govResult, { responseId: response.id, documentId: response.documentId });
  }

  let localMessageId: string | null = null;
  const shouldSendLocal =
    localTarget.kind !== "unconfigured" && !sameDeliveryChannel(govTarget, localTarget);
  if (shouldSendLocal) {
    const localContent = [
      `Ответ на документ **${docNumber}**`,
      `Автор документа: <@${authorId}>`,
      `Ответил: <@${responderId}>`,
    ].join(" · ");
    const localResult = await sendEmbed(client, localTarget, classic, log, {
      once: { job, key: "local" },
      content: localContent,
      mentionUserIds: [authorId, responderId],
    });
    if (localResult.status === "sent") {
      await persistSend(localResult, { responseId: response.id, documentId: response.documentId });
      localMessageId = localResult.messageId;
    } else if (govResult.status === "deferred") {
      return localResult;
    }
  }

  if (govResult.status === "deferred" && !localMessageId) {
    return govResult;
  }
  return {
    status: "sent",
    documentNumber: docNumber,
    messageId: govResult.status === "sent" ? govResult.messageId : localMessageId,
    localMessageId,
    govDeferred: govResult.status === "deferred" ? govResult.reason : null,
  };
};

const wantedPublish: JobHandler = async (payload, { client, log, job }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const target = await resolveWantedDelivery();
  // Ping every ЧП faction role except WN — not the legacy shared «Фракция» role.
  const pingRoleIds = await resolveWantedPingRoleIds();
  const content = formatRoleMentions(pingRoleIds);
  const actor = await resolveAuthor(client, wanted.issuedByDiscordId);

  const classic = makeWantedEmbed({
    actorName: actor.displayName,
    actorUsername: actor.username,
    actorAvatarUrl: actor.avatarUrl,
    fio: wanted.characterName,
    passport: wanted.staticId,
    orderNumber: wanted.number,
    article: wanted.reason,
    termText: wanted.termText,
    forumLink: wanted.forumLink,
  });

  const result = await sendEmbed(client, target, classic, log, {
    once: { job, key: "post" },
    ...(content ? { content } : {}),
    mentionRoleIds: pingRoleIds,
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const wantedEditClosed: JobHandler = async (payload, { client, log, job }) => {
  const wantedId = String(payload.wantedId ?? "");
  const wanted = await prisma.wanted.findUnique({ where: { id: wantedId } });
  if (!wanted) throw new Error(`Wanted ${wantedId} not found`);

  const link = await findLinkedMessage(wanted.id);
  const issuer = await resolveAuthor(client, wanted.issuedByDiscordId);
  let closedBy = "—";
  let closer = issuer;
  if (wanted.closedByDiscordId) {
    closer = await resolveAuthor(client, wanted.closedByDiscordId);
    closedBy = discordIdentity(closer.displayName, closer.username);
  }

  const classic = makeWantedEmbed({
    actorName: issuer.displayName,
    actorUsername: issuer.username,
    actorAvatarUrl: issuer.avatarUrl,
    fio: wanted.characterName,
    passport: wanted.staticId,
    orderNumber: wanted.number,
    article: wanted.reason,
    termText: wanted.termText,
    forumLink: wanted.forumLink,
    closed: true,
    closedBy,
    evidenceLink: wanted.evidence ?? "",
  });
  const embed = classicToEmbed(classic);

  const doneEmbed = makeWantedDoneEmbed({
    actor: closer,
    wantedNumber: wanted.number,
    evidenceLink: wanted.evidence ?? "",
  });

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ content: "~~Федеральный розыск~~", embeds: [embed] });
        // Legacy also posts make_wanted_done_embed as a follow-up.
        const doneResult = await sendEmbed(
          client,
          {
            kind: "channel",
            guildDiscordId: guild.id,
            channelDiscordId: channel.id,
          },
          doneEmbed,
          log,
          { once: { job, key: "done" } },
        );
        if (doneResult.status === "sent") {
          await persistSend(doneResult, { wantedId: wanted.id });
        }
        return {
          status: "edited",
          wantedNumber: wanted.number,
          messageId: message.id,
        };
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit wanted message; publishing new");
    }
  }

  const target = await resolveWantedDelivery();
  const result = await sendEmbed(client, target, classic, log, { once: { job, key: "closed" } });
  if (result.status === "deferred") return result;
  await persistSend(result, { wantedId: wanted.id });
  const doneResult = await sendEmbed(client, target, doneEmbed, log, { once: { job, key: "done" } });
  if (doneResult.status === "sent") {
    await persistSend(doneResult, { wantedId: wanted.id });
  }
  return { status: "sent", wantedNumber: wanted.number, messageId: result.messageId };
};

const icBlacklistPublish: JobHandler = async (payload, { client, log, job }) => {
  const entryId = String(payload.entryId ?? "");
  const entry = await prisma.icBlacklistEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error(`IC blacklist ${entryId} not found`);

  const target = await resolveIcBlacklistDelivery();
  const actor = await resolveAuthor(client, entry.createdByDiscordId);
  const classic = makeIcBlacklistEmbed({
    actorUsername: actor.username,
    actorAvatarUrl: actor.avatarUrl,
    fio: entry.fullName,
    passport: entry.staticId,
    reason: entry.reason,
    forumLink: entry.forumLink,
    number: entry.number,
  });
  const result = await sendEmbed(client, target, classic, log, { once: { job, key: "post" } });
  if (result.status === "deferred") return result;
  await persistSend(result, { icBlacklistId: entry.id });
  return { status: "sent", number: entry.number, messageId: result.messageId };
};

const icBlacklistEditClosed: JobHandler = async (payload, { client, log, job }) => {
  const entryId = String(payload.entryId ?? "");
  const entry = await prisma.icBlacklistEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error(`IC blacklist ${entryId} not found`);

  const link = await findLinkedIcBlacklistMessage(entry.id);
  const issuer = await resolveAuthor(client, entry.createdByDiscordId);
  let closedByUsername: string | null = null;
  if (entry.closedByDiscordId) {
    const closer = await resolveAuthor(client, entry.closedByDiscordId);
    closedByUsername = closer.username;
  }

  const classic = makeIcBlacklistEmbed({
    actorUsername: issuer.username,
    actorAvatarUrl: issuer.avatarUrl,
    fio: entry.fullName,
    passport: entry.staticId,
    reason: entry.reason,
    forumLink: entry.forumLink,
    number: entry.number,
    closed: true,
    closeReason: entry.closeReason,
    closedByUsername,
  });
  const embed = classicToEmbed(classic);

  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ content: "~~IC Черный Список~~", embeds: [embed] });
        return { status: "edited", number: entry.number, messageId: message.id };
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit ic blacklist message; publishing new");
    }
  }

  const target = await resolveIcBlacklistDelivery();
  const result = await sendEmbed(client, target, classic, log, { once: { job, key: "closed" } });
  if (result.status === "deferred") return result;
  await persistSend(result, { icBlacklistId: entry.id });
  return { status: "sent", number: entry.number, messageId: result.messageId };
};

/**
 * Tells the owner of the fined character in direct messages. The fine names a static id, so the
 * account is found through the active character; nobody is told when no character has that id.
 */
async function notifyFined(
  client: Client,
  job: Job,
  log: Logger,
  staticId: string,
  kind: DmKind,
  lines: string[],
  components: ActionRowBuilder<ButtonBuilder>[] = [],
) {
  const step = await runOnce(job, "dm", log, async () => {
    const discordId = await findDiscordIdByStatic(staticId);
    const sent = discordId ? await sendDirectMessage(client, discordId, lines.join("\n"), log, kind, components) : false;
    return { sent };
  });
  return step.sent === true;
}

const finePublish: JobHandler = async (payload, { client, log, job }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  // Legacy + product: /штраф goes only to the selected faction documents channel (like /пост), not ЧП.
  const target = await resolveFineDelivery(fine.factionCode);
  const actor = await resolveAuthor(client, fine.issuedByDiscordId);

  const classic = makeFineEmbed({
    actor,
    faction: fine.factionCode,
    fineNumber: fine.number,
    fio: fine.characterName,
    passport: fine.staticId,
    article: fine.reason,
    amount: fine.amount,
    paymentDeadlineText: fine.paymentDeadlineText,
  });

  const pingRoleId = await resolveFactionPingRoleId(fine.factionCode);
  const mention = pingRoleId ? formatRoleMentions([pingRoleId]) : "";
  const content = mention
    ? `Новый штраф из правительства. ${mention} требуется исполнение и контроль оплаты.`
    : "Новый штраф из правительства.";

  const claimRows = (await finePaymentClaimsEnabled()) ? [finePaidRow(fine.id)] : [];
  const result = await sendEmbed(client, target, classic, log, {
    once: { job, key: "post" },
    content,
    mentionRoleIds: pingRoleId ? [pingRoleId] : [],
    components: claimRows,
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  const dm = await notifyFined(client, job, log, fine.staticId, "fine", [
    `Вам выписан штраф **${fine.number}** на **${formatMoney(fine.amount)}** (статик ${fine.staticId}).`,
    `**Основание:** ${fine.reason}`,
    `**Срок оплаты:** ${fine.paymentDeadlineText}`,
  ], claimRows);
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId, dm };
};

/** The payment deadline passed: the faction that must collect the fine is told once. */
const fineOverdue: JobHandler = async (payload, { client, log, job }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);
  // Paid or cancelled between the deadline and this job: nothing to announce.
  if (fine.status !== RecordStatus.ACTIVE) return { status: "skipped", reason: "fine is no longer active" };

  const target = await resolveFineDelivery(fine.factionCode);
  const actor = await resolveAuthor(client, fine.issuedByDiscordId);
  const classic = makeFineOverdueEmbed({
    fine: {
      fineNumber: fine.number,
      faction: fine.factionCode,
      fio: fine.characterName,
      passport: fine.staticId,
      article: fine.reason,
      amount: fine.amount,
      paymentDeadlineText: fine.paymentDeadlineText,
      createdByDisplayName: actor.displayName,
      createdByUsername: actor.username,
    },
  });
  const pingRoleId = await resolveFactionPingRoleId(fine.factionCode);
  const result = await sendEmbed(client, target, classic, log, {
    once: { job, key: "post" },
    content: pingRoleId
      ? `Срок оплаты штрафа истёк. ${formatRoleMentions([pingRoleId])} требуется взыскание.`
      : "Срок оплаты штрафа истёк.",
    mentionRoleIds: pingRoleId ? [pingRoleId] : [],
  });
  if (result.status === "deferred") return result;
  const dm = await notifyFined(client, job, log, fine.staticId, "fineOverdue", [
    `Срок оплаты штрафа **${fine.number}** на **${formatMoney(fine.amount)}** (статик ${fine.staticId}) истёк.`,
  ]);
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId, dm };
};

/** Full ЧП reconcile requested from the dashboard; the summary is the job result the page shows. */
const cpReconcile: JobHandler = async (_payload, { client, log }) => {
  const summary = await reconcileCpAccess(client, log.child({ component: "cp-sync" }));
  if (!summary) {
    return { status: "skipped", reason: "Синхронизация выключена, сервер ЧП не задан или нет привязок ролей." };
  }
  return { status: "done", ...summary };
};

/** The amount was corrected in the dashboard: the original card shows the new one. */
const fineRefresh: JobHandler = async (payload, { client, log }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);
  const link = await findLinkedFineMessage(fine.id);
  if (!link?.sentMessage || link.sentMessage.status !== RecordStatus.ACTIVE) {
    return { status: "skipped", reason: "the fine has no published message" };
  }
  const actor = await resolveAuthor(client, fine.issuedByDiscordId);
  const classic = makeFineEmbed({
    actor,
    faction: fine.factionCode,
    fineNumber: fine.number,
    fio: fine.characterName,
    passport: fine.staticId,
    article: fine.reason,
    amount: fine.amount,
    paymentDeadlineText: fine.paymentDeadlineText,
  });
  const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
  const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) return { status: "skipped", reason: "channel is gone" };
  const message = await channel.messages.fetch(link.sentMessage.messageDiscordId).catch(() => null);
  if (!message) {
    log.warn({ fineId }, "fine message was deleted in Discord; nothing to refresh");
    return { status: "skipped", reason: "message is gone" };
  }
  await message.edit({ embeds: [classicToEmbed(classic)] });
  return { status: "edited", fineNumber: fine.number };
};

/** «Кикнуть» pressed in the dashboard: removes the dismissed person from the faction's guild. */
const personnelKick: JobHandler = async (payload, { client, log }) => {
  const event = await prisma.personnelEvent.findUnique({ where: { id: String(payload.personnelEventId ?? "") } });
  if (!event) throw new Error("Personnel event not found");
  const faction = await prisma.faction.findFirst({
    where: { code: event.factionCode, status: RecordStatus.ACTIVE },
    include: { guild: { select: { discordId: true } } },
  });
  const guildDiscordId = faction?.guild?.discordId;
  if (!guildDiscordId) return { status: "skipped", reason: `У фракции ${event.factionCode} не задан сервер.` };

  const guild = await client.guilds.fetch(guildDiscordId);
  const member = await guild.members.fetch(event.subjectDiscordId).catch(() => null);
  let outcome: "kicked" | "not_member" | "not_kickable";
  if (!member) outcome = "not_member";
  else if (!member.kickable) outcome = "not_kickable";
  else {
    await member.kick("Увольнение: кадровый аудит, исключение из дашборда");
    outcome = "kicked";
  }
  await writeAuditEvent({
    actorType: AuditActorType.BOT,
    source: "personnel.kick",
    guildId: guildDiscordId,
    action: outcome === "kicked" ? "personnel.kicked" : "personnel.kick_skipped",
    entityType: "personnel_event",
    entityId: event.id,
    after: {
      outcome,
      subjectDiscordId: event.subjectDiscordId,
      factionCode: event.factionCode,
      requestedByDiscordId: String(payload.requestedByDiscordId ?? ""),
    },
  });
  if (outcome === "not_kickable") {
    // Not a failure of the queue: the bot's role is too low. Say it where the admins look.
    log.warn({ personnelEventId: event.id }, "cannot kick: the member's role is above the bot's or the permission is missing");
    throw new Error("Бот не может исключить участника: его роль выше роли бота или нет права «Исключать участников».");
  }
  return { status: outcome };
};

const fineEditPaid: JobHandler = async (payload, { client, log, job }) => {
  const fineId = String(payload.fineId ?? "");
  const fine = await prisma.fine.findUnique({ where: { id: fineId } });
  if (!fine) throw new Error(`Fine ${fineId} not found`);

  const link = await findLinkedFineMessage(fine.id);
  const actor = fine.paidByDiscordId
    ? await resolveAuthor(client, fine.paidByDiscordId)
    : { displayName: "—", username: "—", avatarUrl: "" };

  const classic = makeFinePaidEmbed({
    fineNumber: fine.number,
    fio: fine.characterName,
    passport: fine.staticId,
    amount: fine.amount,
    actor,
  });
  const embed = classicToEmbed(classic);

  // Best-effort: update the original faction fine message if we still have a link.
  if (link?.sentMessage && link.sentMessage.status === RecordStatus.ACTIVE) {
    try {
      const guild = await client.guilds.fetch(link.sentMessage.guildDiscordId);
      const channel = (await guild.channels.fetch(link.sentMessage.channelDiscordId)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(link.sentMessage.messageDiscordId);
        await message.edit({ embeds: [embed], components: [] });
      }
    } catch (error) {
      log.warn({ err: error }, "failed to edit fine message; continuing with GOV notice");
    }
  }

  // Paid notice → GOV documents channel (same place as /ответ), not ЧП.
  const target = await resolveFinePaidDelivery();
  const result = await sendEmbed(client, target, classic, log, { once: { job, key: "notice" } });
  if (result.status === "deferred") return result;
  await persistSend(result, { fineId: fine.id });
  return { status: "sent", fineNumber: fine.number, messageId: result.messageId };
};

const personnelPublish: JobHandler = async (payload, { client, log, job }) => {
  const personnelEventId = String(payload.personnelEventId ?? "");
  const event = await prisma.personnelEvent.findUnique({ where: { id: personnelEventId } });
  if (!event) throw new Error(`Personnel event ${personnelEventId} not found`);

  const type = event.type as PersonnelEventType;
  const meta = PERSONNEL_AUDIT_META[type as keyof typeof PERSONNEL_AUDIT_META];
  if (!meta) {
    throw new Error(`Unknown personnel event type: ${event.type}`);
  }

  const actor = await resolveAuthor(client, event.actorDiscordId);
  const targetUser = await resolveAuthor(client, event.subjectDiscordId);
  const detailsText = formatPersonnelDetailsText(
    type as keyof typeof PERSONNEL_AUDIT_META,
    event.details,
  );

  const classic = makeCompactAuditEmbed({
    actionTitle: meta.actionTitle,
    actorDisplayName: actor.displayName,
    actorId: event.actorDiscordId,
    targetDisplayName: event.subjectName || targetUser.displayName,
    targetId: event.subjectDiscordId,
    actorLabel: meta.actorLabel,
    targetLabel: meta.targetLabel,
    detailsText,
    targetAvatarUrl: targetUser.avatarUrl,
  });

  const target = await resolveFactionPersonnelDelivery(event.factionCode);
  // After a dismissal the person usually has to leave the faction server: one button does it.
  const components =
    type === "dismissal" && target.kind === "channel"
      ? await runOnce(job, "kick-button", log, async () => {
          const action = await createButtonAction("personnel.kick", {
            personnelEventId: event.id,
            factionCode: event.factionCode,
            subjectDiscordId: event.subjectDiscordId,
          });
          return { customId: action.customId };
        }).then((step) => [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(String(step.customId)).setLabel("Кикнуть с сервера").setStyle(ButtonStyle.Danger),
          ),
        ])
      : undefined;
  const result = await sendEmbed(client, target, classic, log, {
    once: { job, key: "post" },
    ...(components ? { components } : {}),
  });
  if (result.status === "deferred") return result;
  await persistSend(result, { personnelId: event.id });
  return { status: "sent", personnelEventId: event.id, messageId: result.messageId };
};

/** Why a message could not be read, in words for the editor. */
function importError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    if (error.code === 10008) return "Сообщение не найдено: возможно, его удалили.";
    if (error.code === 10003) return "Канал не найден.";
    if (error.code === 50001 || error.code === 50013) {
      return "У бота нет доступа к этому каналу: нужны права «Просмотр канала» и «Читать историю сообщений».";
    }
  }
  return formatUserError(error);
}

/**
 * Reads an existing message for the editor. The answer — a template or the reason — is the job's
 * result: a wrong link is not a failure of the bot and does not go to the error channel.
 */
const messageDesignImport: JobHandler = async (payload, { client, log }) => {
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const messageDiscordId = String(payload.messageDiscordId ?? "");
  try {
    const raw = (await client.rest.get(Routes.channelMessage(channelDiscordId, messageDiscordId))) as RawDiscordMessage;
    const { spec, notes } = await discordMessageToSpec(raw);
    log.info({ channelDiscordId, messageDiscordId, notes: notes.length }, "message imported into the editor");
    return { spec, notes };
  } catch (error) {
    log.info({ err: error, channelDiscordId, messageDiscordId }, "message import refused");
    return { error: importError(error) };
  }
};

const messageDesignSend: JobHandler = async (payload, { client, log, job }) => {
  const designId = String(payload.designId ?? "");
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const design = await prisma.messageDesign.findUnique({ where: { id: designId } });
  if (!design || design.status !== RecordStatus.ACTIVE) {
    throw new Error(`Design ${designId} not found`);
  }

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${channelDiscordId} недоступен`);
  }

  const now = new Date();
  const custom =
    payload.variables && typeof payload.variables === "object" && !Array.isArray(payload.variables)
      ? Object.fromEntries(Object.entries(payload.variables).map(([key, value]) => [key, String(value)]))
      : {};
  const parsed = substituteVariables(embedSpecSchema.parse(design.spec), {
    ...custom,
    server: guild.name,
    channel: `<#${channel.id}>`,
    date: now.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }),
    time: now.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
  });
  const violations = checkDiscordLimits(parsed);
  if (violations.length > 0) {
    throw new Error(violations.map((v) => v.message).join("; "));
  }
  const ready = await materializeEmbedSpecButtons(parsed);
  const options = embedSpecToMessageOptions(ready);

  const message = await runOnce(job, "post", log, async () => ({ id: (await channel.send(options)).id }));
  await recordSentMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
    designId: design.id,
    spec: ready,
  });
  log.info({ designId, messageId: message.id, channelId: channel.id }, "message design sent");
  return { status: "sent", messageId: message.id, channelId: channel.id };
};

const messageDesignResend: JobHandler = async (payload, { client, log }) => {
  const sentMessageId = String(payload.sentMessageId ?? "");
  const sent = await prisma.sentMessage.findUnique({ where: { id: sentMessageId } });
  if (!sent || sent.status !== RecordStatus.ACTIVE) {
    throw new Error(`Sent message ${sentMessageId} not found`);
  }

  const parsed = embedSpecSchema.parse(sent.spec);
  const ready = await materializeEmbedSpecButtons(parsed);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(sent.guildDiscordId);
  const channel = (await guild.channels.fetch(sent.channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${sent.channelDiscordId} недоступен`);
  }

  try {
    const existing = await channel.messages.fetch(sent.messageDiscordId);
    const editPayload: {
      content?: string | null;
      embeds?: typeof options.embeds;
      components?: typeof options.components;
      flags?: MessageFlags.IsComponentsV2;
    } = {
      content: options.content ?? null,
    };
    if (options.embeds) editPayload.embeds = options.embeds;
    if (options.components) editPayload.components = options.components;
    if (ready.version === 2) editPayload.flags = MessageFlags.IsComponentsV2;
    await existing.edit(editPayload);
    await recordSentMessage({
      guildDiscordId: guild.id,
      channelDiscordId: channel.id,
      messageDiscordId: existing.id,
      ...(sent.designId ? { designId: sent.designId } : {}),
      spec: ready,
    });
    log.info({ sentMessageId, messageId: existing.id }, "message design resent (edit)");
    return { status: "edited", messageId: existing.id };
  } catch {
    const message = await channel.send(options);
    await recordSentMessage({
      guildDiscordId: guild.id,
      channelDiscordId: channel.id,
      messageDiscordId: message.id,
      ...(sent.designId ? { designId: sent.designId } : {}),
      spec: ready,
    });
    log.info({ sentMessageId, messageId: message.id }, "message design resent (new)");
    return { status: "sent", messageId: message.id };
  }
};

const registrationReview: JobHandler = async (payload, { client, log, job }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  // Idempotent: a retry after a successful post must not post a second copy.
  if (registration.reviewMessageId) {
    return { status: "skipped", reason: "already posted", messageId: registration.reviewMessageId };
  }

  const target = await resolveRegistrationDelivery(registration.kind === "VEHICLE" ? "VEHICLE" : "UNIFORM");
  if (target.kind !== "channel") {
    return {
      status: "deferred",
      reason: target.kind === "unconfigured" ? target.reason : "Канал заявок ЧП не настроен.",
    };
  }

  const channel = await fetchReviewChannel(client, target.guildDiscordId, target.channelDiscordId);
  const photo = registration.evidenceFileIds[0] ? await readMediaFile(registration.evidenceFileIds[0]) : null;
  const pingRoleIds = await getSetting("registrations.coordinatorRoleIds");
  const posted = await runOnce(job, "post", log, async () => {
    const sentMessage = await channel.send({
      ...renderRegistrationReview(registration, {
        imageUrl: photo ? `attachment://${photo.attachmentName}` : null,
      }),
      ...(pingRoleIds.length > 0 ? { content: formatRoleMentions(pingRoleIds) } : {}),
      allowedMentions: { parse: [], roles: [...pingRoleIds] },
      files: photo ? [{ attachment: photo.body, name: photo.attachmentName }] : [],
    });
    return { id: sentMessage.id };
  });
  const message = await channel.messages.fetch(posted.id);
  await setRegistrationReviewMessage(registrationId, {
    guildId: target.guildDiscordId,
    channelId: channel.id,
    messageId: message.id,
  });

  let threadId: string | null = null;
  try {
    const plate = registration.plate ? ` · ${registration.plate}` : "";
    const thread = await message.startThread({
      name: `${registration.kind === "VEHICLE" ? "ТС" : "Униформа"} · ${registration.staticId}${plate}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    threadId = thread.id;
    await setRegistrationReviewThread(registrationId, thread.id);
  } catch (error) {
    log.warn({ err: error, registrationId }, "registration thread was not created (Create Public Threads permission?)");
  }
  return { status: "sent", messageId: message.id, threadId, registrationId };
};

/** `kind` — the notification the player may have switched off in the profile; without it the message always goes. */
async function sendDirectMessage(
  client: Client,
  discordId: string,
  content: string,
  log: Logger,
  kind?: DmKind,
  components: ActionRowBuilder<ButtonBuilder>[] = [],
): Promise<boolean> {
  if (kind && !(await wantsDm(discordId, kind))) {
    log.info({ discordId, kind }, "direct message skipped: switched off in the profile");
    return false;
  }
  try {
    const user = await client.users.fetch(discordId);
    await user.send({ content, components, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    log.info({ err: error, discordId }, "direct message not delivered (DMs closed?)");
    return false;
  }
}

async function postToThread(client: Client, threadId: string | null, content: string, log: Logger) {
  if (!threadId) return false;
  try {
    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) return false;
    if (thread.archived) await thread.setArchived(false);
    await thread.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    log.warn({ err: error, threadId }, "failed to post to review thread");
    return false;
  }
}

const registrationDecided: JobHandler = async (payload, { client, log }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  const what = `регистрацию ${registrationKindLabel(registration.kind)}${registration.plate ? ` (${registration.plate})` : ""}`;
  const who = `статик ${registration.staticId}`;
  // Buttons already update the card; an automatic close (nobody reviewed in time) reaches it only here.
  if (registration.decision !== "PENDING") {
    await editStoredReviewMessage(client, registration, await buildRegistrationReview(registration)).catch(
      (error: unknown) => log.warn({ err: error, registrationId }, "failed to refresh registration card"),
    );
  }
  if (registration.decision === "REJECTED") {
    const decidedBy = registration.decidedByDiscordId ? `<@${registration.decidedByDiscordId}>` : "автоматически";
    const thread = await postToThread(
      client,
      registration.reviewThreadId,
      `**Отказ.** Решение принял: ${decidedBy}\n**Причина:** ${registration.rejectionReason ?? "—"}`,
      log,
    );
    const dm = await sendDirectMessage(
      client,
      registration.applicantDiscordId,
      `Ваша заявка на ${what} (${who}) отклонена.\n**Причина:** ${registration.rejectionReason ?? "—"}`,
      log,
      "registration",
    );
    return { status: "sent", decision: "REJECTED", thread, dm };
  }
  if (registration.decision === "APPROVED") {
    const until = registration.expiresAt?.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) ?? "—";
    const thread = await postToThread(
      client,
      registration.reviewThreadId,
      `**Одобрено.** Решение принял: <@${registration.decidedByDiscordId}>. Действует до ${until}.`,
      log,
    );
    const dm = await sendDirectMessage(
      client,
      registration.applicantDiscordId,
      `Ваша заявка на ${what} (${who}) одобрена. Регистрация действует до ${until}.`,
      log,
      "registration",
    );
    return { status: "sent", decision: "APPROVED", thread, dm };
  }
  return { status: "skipped", reason: "pending" };
};

const registrationExpired: JobHandler = async (payload, { client, log }) => {
  const registrationId = String(payload.registrationId ?? "");
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error(`Registration ${registrationId} not found`);
  let edited = false;
  try {
    edited = await editStoredReviewMessage(client, registration, await buildRegistrationReview(registration));
  } catch (error) {
    log.warn({ err: error, registrationId }, "failed to edit expired registration card");
  }
  const dm = await sendDirectMessage(
    client,
    registration.applicantDiscordId,
    registration.status === RecordStatus.REVOKED
      ? `Регистрация ${registrationKindLabel(registration.kind)}${registration.plate ? ` (${registration.plate})` : ""} для статика ${registration.staticId} снята${registration.rejectionReason === REGISTRATION_LEFT_REASON ? "" : " администрацией"}.\n**Причина:** ${registration.rejectionReason ?? "—"}`
      : `Срок регистрации ${registrationKindLabel(registration.kind)}${registration.plate ? ` (${registration.plate})` : ""} для статика ${registration.staticId} истёк. При необходимости подайте заявку заново.`,
    log,
    "registrationExpiry",
  );
  return { status: "sent", edited, dm };
};

const transferReview: JobHandler = async (payload, { client, log, job }) => {
  const transferId = String(payload.transferId ?? "");
  const transfer = await loadTransfer(transferId);
  if (!transfer) throw new Error(`Transfer ${transferId} not found`);
  if (transfer.reviewMessageId) {
    return { status: "skipped", reason: "already posted", messageId: transfer.reviewMessageId };
  }
  const channelId = await getSetting("transfers.channelId");
  const guildId = await getSetting("core.incidentGuildId");
  if (!guildId || !channelId) return { status: "deferred", reason: "Канал переводов не настроен." };

  const channel = await fetchReviewChannel(client, guildId, channelId);
  const photo = transfer.documentFileIds[0] ? await readMediaFile(transfer.documentFileIds[0]) : null;
  const pingRoleIds = await resolveTransferPingRoleIds(guildId);
  const message = await runOnce(job, "post", log, async () => {
    const sentMessage = await channel.send({
      ...renderTransferReview(transfer, {
        imageUrl: photo ? `attachment://${photo.attachmentName}` : null,
      }),
      ...(pingRoleIds.length > 0 ? { content: formatRoleMentions(pingRoleIds) } : {}),
      allowedMentions: { parse: [], roles: pingRoleIds },
      files: photo ? [{ attachment: photo.body, name: photo.attachmentName }] : [],
    });
    return { id: sentMessage.id };
  });
  await setTransferReviewMessage(transferId, { guildId, channelId: channel.id, messageId: message.id });
  if (pingRoleIds.length === 0) {
    log.warn({ transferId }, "transfer review posted without ping roles");
  }
  return { status: "sent", messageId: message.id, transferId, pinged: pingRoleIds.length };
};

const transferDecided: JobHandler = async (payload, { client, log }) => {
  const transferId = String(payload.transferId ?? "");
  const transfer = await loadTransfer(transferId);
  if (!transfer) throw new Error(`Transfer ${transferId} not found`);
  await editStoredReviewMessage(client, transfer, await buildTransferReview(transfer)).catch((error: unknown) =>
    log.warn({ err: error, transferId }, "failed to refresh transfer card"),
  );
  if (transfer.status === "CLOSED") {
    const dm = await sendDirectMessage(
      client,
      transfer.createdByDiscordId,
      `Заявка на перевод **${transfer.fromFactionCode} → ${transfer.toFactionCode}** (статик ${transfer.character.staticId}) закрыта.\n**Причина:** ${transfer.rejectionReason ?? "—"}`,
      log,
      "transfer",
    );
    return { status: "sent", decision: "CLOSED", dm };
  }
  if (transfer.status === "REJECTED") {
    const dm = await sendDirectMessage(
      client,
      transfer.createdByDiscordId,
      `Заявка на перевод **${transfer.fromFactionCode} → ${transfer.toFactionCode}** (статик ${transfer.character.staticId}) отклонена.\n**Причина:** ${transfer.rejectionReason ?? "—"}`,
      log,
      "transfer",
    );
    return { status: "sent", decision: "REJECTED", dm };
  }
  if (transfer.status === "APPROVED") {
    const text = await getSetting("transfers.approvalDmText");
    const dm = await sendDirectMessage(
      client,
      transfer.createdByDiscordId,
      `${text}\n\nПеревод: **${transfer.fromFactionCode} → ${transfer.toFactionCode}**, персонаж ${transfer.character.name} (${transfer.character.staticId}).`,
      log,
      "transfer",
    );
    return { status: "sent", decision: "APPROVED", dm };
  }
  return { status: "skipped", reason: "pending" };
};

const rolePanelPublish: JobHandler = async (payload, { client, log }) => {
  const panelId = String(payload.rolePanelId ?? "");
  const panel = await prisma.rolePanel.findUnique({ where: { id: panelId } });
  if (!panel || panel.status !== RecordStatus.ACTIVE) {
    return { status: "skipped", reason: "panel not found or not active" };
  }
  const spec = embedSpecSchema.parse(panel.spec);
  const materializedSpec = await materializeEmbedSpecButtons(spec);

  const channel = await client.channels.fetch(panel.channelDiscordId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Канал ${panel.channelDiscordId} не найден или недоступен`);
  }

  const messageOptions = embedSpecToMessageOptions(materializedSpec);
  let message = null;
  if (panel.messageDiscordId && "messages" in channel) {
    const existing = await channel.messages.fetch(panel.messageDiscordId).catch(() => null);
    if (existing) {
      message = await existing.edit(messageOptions as Parameters<typeof existing.edit>[0]);
    }
  }
  if (!message) {
    message = await channel.send(messageOptions);
  }

  await prisma.rolePanel.update({
    where: { id: panel.id },
    data: {
      messageDiscordId: message.id,
      spec: toJsonValue(materializedSpec),
    },
  });

  await recordSentMessage({
    guildDiscordId: panel.guildDiscordId,
    channelDiscordId: panel.channelDiscordId,
    messageDiscordId: message.id,
    spec: materializedSpec,
  });

  log.info({ panelId: panel.id, messageId: message.id }, "role panel published");
  return { status: "sent", panelId: panel.id, messageId: message.id };
};

const rolePanelArchive: JobHandler = async (payload, { client, log }) => {
  const panelId = String(payload.rolePanelId ?? "");
  const panel = await prisma.rolePanel.findUnique({ where: { id: panelId } });
  if (!panel || !panel.messageDiscordId) {
    return { status: "skipped", reason: "panel not found or message not published" };
  }
  try {
    const channel = await client.channels.fetch(panel.channelDiscordId).catch(() => null);
    if (channel && channel.isTextBased() && "messages" in channel) {
      const message = await channel.messages.fetch(panel.messageDiscordId).catch(() => null);
      if (message) {
        // Custom ids of every button and list on the message, whatever the layout version.
        const actionIds = [...JSON.stringify(message.components).matchAll(/"custom_?id":"([^"]+)"/gi)]
          .map((match) => parseCustomId(match[1] ?? "")?.id)
          .filter((id): id is string => Boolean(id));
        if (actionIds.length > 0) {
          await prisma.buttonAction.updateMany({
            where: { id: { in: actionIds }, status: RecordStatus.ACTIVE },
            data: { status: RecordStatus.ARCHIVED },
          });
        }
        await message.edit({ components: [] });
      }
    }
    log.info({ panelId }, "role panel archived and components removed");
    return { status: "archived", panelId };
  } catch (error) {
    log.warn({ err: error, panelId }, "failed to clean up archived role panel message");
    return { status: "deferred", reason: String(error) };
  }
};

/** Discord refuses bigger uploads from a bot; files over the budget are linked to the site instead. */
const TICKET_FILES_UPLOAD_BUDGET = 8 * 1024 * 1024;

/**
 * Files of a ticket message for a Discord message: attached while they fit the upload budget,
 * the rest named with a pointer to the site page where they open (`sitePath`).
 */
async function ticketFilesPayload(fileIds: readonly string[], sitePath: string) {
  const files: Array<{ attachment: Buffer; name: string }> = [];
  const linked: string[] = [];
  let total = 0;
  for (const id of fileIds) {
    const media = await readMediaFile(id);
    if (!media) continue;
    if (total + media.body.byteLength <= TICKET_FILES_UPLOAD_BUDGET) {
      total += media.body.byteLength;
      files.push({ attachment: media.body, name: media.attachmentName });
    } else {
      linked.push(media.file.originalName);
    }
  }
  const siteUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const note =
    linked.length > 0 ? `\n📎 Не поместились в сообщение (откройте на сайте ${siteUrl}${sitePath}): ${linked.join(", ")}` : "";
  return { files, note };
}

const feedbackTicketNotify: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return { status: "skipped", reason: "ticket not found" };

  const notifyChannelId = await getSetting("feedback.notifyChannelId");
  if (!notifyChannelId || typeof notifyChannelId !== "string") {
    return { status: "deferred", reason: "feedback.notifyChannelId is not configured" };
  }

  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Канал обратной связи ${notifyChannelId} недоступен`);
  }

  // With a message id it is the player's answer in an existing ticket, otherwise a new ticket.
  const followUp = payload.messageId ? ticket.messages.find((entry) => entry.id === String(payload.messageId)) : null;
  const shown = followUp ?? ticket.messages[0];
  const initialContent = shown?.content || (shown?.attachmentFileIds.length ? "📎 Файлы без текста" : "—");
  const attachments = await ticketFilesPayload(shown?.attachmentFileIds ?? [], "/feedback");
  const embed: ClassicEmbed = {
    type: "embed",
    title: followUp ? `Ответ игрока по обращению: ${ticket.category}` : `Новое обращение: ${ticket.category}`,
    description: initialContent,
    color: 0x5865f2,
    fields: [
      { name: "Автор", value: `<@${ticket.authorDiscordId}> (${ticket.authorDiscordId})`, inline: true },
      { name: "Статус", value: ticket.status, inline: true },
      { name: "ID тикета", value: ticket.id, inline: true },
    ],
    timestamp: true,
  };

  const message = await channel.send({
    embeds: [classicToEmbed(embed)],
    files: attachments.files,
    ...(attachments.note ? { content: attachments.note.trim() } : {}),
    allowedMentions: { parse: [] },
  });
  log.info({ ticketId, messageId: message.id, files: attachments.files.length }, "feedback ticket notification sent");
  return { status: "sent", ticketId, messageId: message.id };
};

const feedbackReplySend: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const messageId = String(payload.messageId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({ where: { id: ticketId } });
  const message = await prisma.feedbackMessage.findUnique({ where: { id: messageId } });
  if (!ticket || !message) return { status: "skipped", reason: "ticket or message not found" };

  // The reply carries a button, so the conversation can go on without a new ticket.
  const attachments = await ticketFilesPayload(message.attachmentFileIds, "/support");
  let dm = false;
  try {
    const user = await client.users.fetch(ticket.authorDiscordId);
    await user.send({
      content: `Вам поступил ответ по обращению **«${ticket.category}»**:\n\n${message.content}${attachments.note}`.slice(0, 2000),
      files: attachments.files,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`mirror:feedback.reply:${ticket.id}`).setLabel("Ответить").setStyle(ButtonStyle.Primary),
        ),
      ],
      allowedMentions: { parse: [] },
    });
    dm = true;
  } catch (error) {
    log.info({ err: error, ticketId }, "feedback reply DM not delivered (DMs closed?)");
  }
  log.info({ ticketId, dm }, "feedback reply DM delivered");
  return { status: "sent", dm, ticketId };
};

const feedbackClosedSend: JobHandler = async (payload, { client, log }) => {
  const ticketId = String(payload.ticketId ?? "");
  const ticket = await prisma.feedbackTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { status: "skipped", reason: "ticket not found" };

  const dm = await sendDirectMessage(
    client,
    ticket.authorDiscordId,
    `Ваше обращение **«${ticket.category}»** было закрыто администрацией.`,
    log,
  );
  log.info({ ticketId, dm }, "feedback closed DM delivered");
  return { status: "sent", dm, ticketId };
};

const formOpenPublish: JobHandler = async (payload, { client, log }) => {
  const formId = String(payload.formId ?? "");
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const form = await prisma.discordForm.findUnique({ where: { id: formId } });
  if (!form || form.status !== RecordStatus.ACTIVE) {
    return { status: "skipped", reason: "form not found or not active" };
  }

  const spec: EmbedSpec = {
    version: 1,
    embeds: [
      {
        type: "embed",
        title: form.name.slice(0, 256),
        description: (form.description?.trim() || "Нажмите кнопку ниже, чтобы открыть форму.").slice(0, 4096),
        color: 0x5865f2,
      },
    ],
    components: [
      {
        type: "action_row",
        components: [
          {
            type: "button",
            label: "Открыть форму",
            style: "primary",
            action: "form.open",
            params: { formId: form.id },
          },
        ],
      },
    ],
  };

  const ready = await materializeEmbedSpecButtons(spec);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${channelDiscordId} недоступен`);
  }

  let message = null;
  if (form.openMessageDiscordId && form.openChannelDiscordId === channelDiscordId) {
    const existing = await channel.messages.fetch(form.openMessageDiscordId).catch(() => null);
    if (existing) {
      message = await existing.edit(options as Parameters<typeof existing.edit>[0]);
    }
  }
  if (!message) {
    message = await channel.send(options);
  }

  await setDiscordFormOpenMessage(form.id, {
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
  });
  await recordSentMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
    spec: ready,
  });

  const messageUrl = discordMessageUrl(guild.id, channel.id, message.id);
  log.info({ formId: form.id, messageId: message.id, messageUrl }, "form open button published");
  return { status: "sent", formId: form.id, messageId: message.id, messageUrl };
};

const feedbackOpenPublish: JobHandler = async (payload, { client, log }) => {
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");

  const spec: EmbedSpec = {
    version: 1,
    embeds: [
      {
        type: "embed",
        title: "Обратная связь",
        description: "Нажмите кнопку ниже, чтобы отправить обращение администрации.",
        color: 0x5865f2,
      },
    ],
    components: [
      {
        type: "action_row",
        components: [
          {
            type: "button",
            label: "Написать обращение",
            style: "primary",
            action: "feedback.open",
          },
        ],
      },
    ],
  };

  const ready = await materializeEmbedSpecButtons(spec);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${channelDiscordId} недоступен`);
  }

  const previous = await getSetting("feedback.openMessage");
  let message = null;
  if (previous && previous.channelDiscordId === channelDiscordId) {
    const existing = await channel.messages.fetch(previous.messageDiscordId).catch(() => null);
    if (existing) {
      message = await existing.edit(options as Parameters<typeof existing.edit>[0]);
    }
  }
  if (!message) {
    message = await channel.send(options);
  }

  await setFeedbackOpenMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
  });
  await recordSentMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
    spec: ready,
  });

  const messageUrl = discordMessageUrl(guild.id, channel.id, message.id);
  log.info({ messageId: message.id, messageUrl }, "feedback open button published");
  return { status: "sent", messageId: message.id, messageUrl };
};

const tokenReceivePublish: JobHandler = async (payload, { client, log }) => {
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const messageText =
    typeof payload.messageText === "string" && payload.messageText.trim()
      ? payload.messageText.trim().slice(0, 2000)
      : "Нажмите кнопку ниже, чтобы получить номер нашивки по статику.";

  const spec: EmbedSpec = {
    version: 1,
    embeds: [
      {
        type: "embed",
        title: "Получить нашивку",
        description: messageText,
        color: 0x5865f2,
      },
    ],
    components: [
      {
        type: "action_row",
        components: [
          {
            type: "button",
            label: "Получить нашивку",
            style: "primary",
            action: "token.receive",
          },
        ],
      },
    ],
  };

  const ready = await materializeEmbedSpecButtons(spec);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) {
    throw new Error(`Канал ${channelDiscordId} недоступен`);
  }

  const previous = await getSetting("tokens.openMessage");
  let message = null;
  if (previous && previous.channelDiscordId === channelDiscordId) {
    const existing = await channel.messages.fetch(previous.messageDiscordId).catch(() => null);
    if (existing) {
      message = await existing.edit(options as Parameters<typeof existing.edit>[0]);
    }
  }
  if (!message) {
    message = await channel.send(options);
  }

  await setTokenReceiveOpenMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
  });
  await recordSentMessage({
    guildDiscordId: guild.id,
    channelDiscordId: channel.id,
    messageDiscordId: message.id,
    spec: ready,
  });

  const messageUrl = discordMessageUrl(guild.id, channel.id, message.id);
  log.info({ messageId: message.id, messageUrl }, "token receive button published");
  return { status: "sent", messageId: message.id, messageUrl };
};

/** The «Вызвать адвоката» panel on the ЧП server; a new publish into the same channel edits the old one. */
const lawyerCallPanelPublish: JobHandler = async (payload, { client, log }) => {
  const guildDiscordId = String(payload.guildDiscordId ?? "");
  const channelDiscordId = String(payload.channelDiscordId ?? "");
  const messageText =
    typeof payload.messageText === "string" && payload.messageText.trim()
      ? payload.messageText.trim().slice(0, 2000)
      : LAWYER_CALL_PANEL_TEXT;

  const spec: EmbedSpec = {
    version: 1,
    embeds: [{ type: "embed", title: "Вызов адвоката", description: messageText, color: 0x5865f2 }],
    components: [
      {
        type: "action_row",
        components: [{ type: "button", label: "Вызвать адвоката", style: "primary", action: "lawyer.call" }],
      },
    ],
  };
  const ready = await materializeEmbedSpecButtons(spec);
  const options = embedSpecToMessageOptions(ready);

  const guild = await client.guilds.fetch(guildDiscordId);
  const channel = (await guild.channels.fetch(channelDiscordId)) as TextChannel | null;
  if (!channel?.isTextBased()) throw new Error(`Канал ${channelDiscordId} недоступен`);

  const previous = await getSetting("lawyerCalls.openMessage");
  let message = null;
  if (previous && previous.channelDiscordId === channelDiscordId) {
    const existing = await channel.messages.fetch(previous.messageDiscordId).catch(() => null);
    if (existing) message = await existing.edit(options as Parameters<typeof existing.edit>[0]);
  }
  if (!message) message = await channel.send(options);

  await setLawyerCallOpenMessage({ guildDiscordId: guild.id, channelDiscordId: channel.id, messageDiscordId: message.id });
  await recordSentMessage({ guildDiscordId: guild.id, channelDiscordId: channel.id, messageDiscordId: message.id, spec: ready });

  const messageUrl = discordMessageUrl(guild.id, channel.id, message.id);
  log.info({ messageId: message.id, messageUrl }, "lawyer call panel published");
  return { status: "sent", messageId: message.id, messageUrl };
};

const webhookRequestNotify: JobHandler = async (payload, { client, log }) => {
  const requestId = String(payload.requestId ?? "");
  const request = await prisma.webhookRequest.findUnique({ where: { id: requestId } });
  if (!request) return { status: "skipped", reason: "request not found" };

  let content: string;
  if (request.status === "FORM_BUILT") {
    const form = await findFormForWebhookRequest(request.webhookUrl);
    const lines = ["Ваш запрос на Discord-форму выполнен."];
    if (form) {
      lines.push(`Форма: **${form.name}**`);
    }
    if (request.description.trim()) {
      lines.push(`Описание запроса: ${request.description}`);
    }
    if (form?.openGuildDiscordId && form.openChannelDiscordId && form.openMessageDiscordId) {
      const url = discordMessageUrl(
        form.openGuildDiscordId,
        form.openChannelDiscordId,
        form.openMessageDiscordId,
      );
      lines.push(`Открыть форму: ${url}`);
      lines.push("Нажмите кнопку на сообщении, чтобы заполнить форму.");
    } else {
      lines.push(
        "Форма готова. Откройте её через кнопку «Открыть форму» в Discord (администратор публикует кнопку на странице Discord-форм).",
      );
    }
    content = lines.join("\n");
  } else if (request.status === "REJECTED") {
    content = [
      "Ваш запрос на Discord-форму отклонён.",
      request.description.trim() ? `Описание запроса: ${request.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    return { status: "skipped", reason: "status not notifiable" };
  }

  const dm = await sendDirectMessage(client, request.requesterDiscordId, content, log, "formRequest");
  log.info({ requestId, status: request.status, dm }, "webhook request status DM delivered");
  return { status: "sent", dm, requestId, requestStatus: request.status };
};

/** Posts a request to spawn a vehicle into the channel from the settings and pings the chosen roles. */
const vehicleRequestSend: JobHandler = async (payload, { client, log, job }) => {
  const request = payload as unknown as VehicleRequestPayload;
  const channelId = await getSetting("vehicleRequests.channelId");
  if (!channelId) return { status: "deferred", reason: "vehicleRequests.channelId is not configured" };

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !("send" in channel)) {
    throw new Error(`Канал запросов ТС ${channelId} недоступен`);
  }
  const roleIds = await getSetting("vehicleRequests.pingRoleIds");
  const requester = await resolveAuthor(client, request.requesterDiscordId);
  const server = request.factionCodes.length > 0 ? `${request.factionCodes.join(", ")} · ${request.guildName}` : request.guildName;
  const embed: ClassicEmbed = {
    type: "embed",
    title: "Запрос на спавн транспорта",
    color: 0xff6a1a,
    fields: [
      { name: "Модель", value: `\`${request.model}\` · ${request.category}`, inline: true },
      { name: "Время", value: request.time, inline: true },
      { name: "Сервер", value: server, inline: true },
      {
        name: "Запросил",
        value: `<@${request.requesterDiscordId}> — ${requester.displayName} (${request.requesterDiscordId})`,
      },
      { name: "Причина", value: request.reason },
    ],
    timestamp: true,
  };
  const posted = await runOnce(job, "post", log, async () => {
    const message = await channel.send({
      ...(roleIds.length > 0 ? { content: `${formatRoleMentions(roleIds)} нужно заспавнить транспорт.` } : {}),
      embeds: [classicToEmbed(embed)],
      allowedMentions: { parse: [], roles: [...roleIds], users: [request.requesterDiscordId] },
    });
    return { id: message.id };
  });
  log.info({ model: request.model, messageId: posted.id }, "vehicle request posted");
  return { status: "sent", messageId: posted.id };
};

const formSubmissionDeliver: JobHandler = async (payload, { client, log, job }) => {
  const submissionId = String(payload.submissionId ?? "");
  const submission = await loadFormSubmission(submissionId);
  if (!submission) return { status: "skipped", reason: "submission not found" };

  const form = submission.form;
  if (!form.webhookUrl && !form.deliveryChannelId) {
    return { status: "skipped", reason: "no delivery target" };
  }

  // Rendered from the stored state: an answer decided in the dashboard before the bot got to post
  // it arrives with the decision and without buttons.
  const classic = formSubmissionEmbed(submission);
  const results: Array<{ via: string; status: string; messageId?: string | undefined }> = [];

  if (form.deliveryChannelId) {
    const channel = await client.channels.fetch(form.deliveryChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error(`Канал доставки формы ${form.deliveryChannelId} недоступен`);
    }
    const message = await runOnce(job, "channel", log, async () => ({
      id: (
        await channel.send({
          embeds: [classicToEmbed(classic)],
          components: formSubmissionButtons(submission),
          allowedMentions: { parse: [] },
        })
      ).id,
    }));
    if (submission.decision) {
      await setFormSubmissionReviewMessage(submissionId, { channelId: channel.id, messageId: message.id });
    }
    results.push({ via: "channel", status: "sent", messageId: message.id });
  }

  if (form.webhookUrl) {
    const target: DeliveryTarget = {
      kind: "webhook",
      webhookUrl: form.webhookUrl,
      channelDiscordId: form.deliveryChannelId,
      guildDiscordId: null,
    };
    const sent = await sendEmbed(client, target, classic, log, { once: { job, key: "webhook" } });
    results.push({
      via: "webhook",
      status: sent.status,
      ...(sent.status === "sent" ? { messageId: sent.messageId } : {}),
    });
    if (sent.status === "deferred") {
      return { status: "deferred", reason: sent.reason, results };
    }
  }

  log.info({ submissionId, results }, "form submission delivered");
  return { status: "sent", submissionId, results };
};

/** The answer got its decision: the message shows it and loses the buttons, the author is told. */
const formSubmissionDecided: JobHandler = async (payload, { client, log, job }) => {
  const submissionId = String(payload.submissionId ?? "");
  const submission = await loadFormSubmission(submissionId);
  if (!submission) return { status: "skipped", reason: "submission not found" };
  if (!submission.decision || submission.decision === "PENDING") {
    return { status: "skipped", reason: "no decision yet" };
  }

  let edited = false;
  if (submission.reviewChannelId && submission.reviewMessageId) {
    try {
      const channel = await client.channels.fetch(submission.reviewChannelId);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(submission.reviewMessageId);
        await message.edit({ embeds: [classicToEmbed(formSubmissionEmbed(submission))], components: [] });
        edited = true;
      }
    } catch (error) {
      log.warn({ err: error, submissionId }, "failed to edit the decided form answer");
    }
  }

  const text = formDecisionDm(submission);
  const authorDiscordId = submission.authorDiscordId;
  const dm =
    authorDiscordId && text
      ? await runOnce(job, "dm", log, async () => ({
          sent: await sendDirectMessage(client, authorDiscordId, text, log, "formDecision"),
        }))
      : { sent: false };
  return { status: "sent", submissionId, edited, dm: dm.sent };
};

/** A person reported a paid fine: the report goes to the channel chosen in the dashboard. */
const fineClaimReview: JobHandler = async (payload, { client, log, job }) => {
  const claimId = String(payload.claimId ?? "");
  const claim = await getFinePaymentClaim(claimId);
  if (!claim) return { status: "skipped", reason: "claim not found" };
  // Idempotent: a retry after a successful post must not post a second copy.
  if (claim.reviewMessageId) return { status: "skipped", reason: "already posted", messageId: claim.reviewMessageId };

  const channelId = await getSetting("fines.claimChannelId");
  if (!channelId) return { status: "deferred", reason: "Канал сообщений об оплате штрафов не выбран." };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Канал сообщений об оплате ${channelId} недоступен`);
  }

  const files: Array<{ attachment: Buffer; name: string }> = [];
  for (const fileId of claim.evidenceFileIds) {
    const media = await readMediaFile(fileId);
    if (media) files.push({ attachment: media.body, name: media.attachmentName });
  }
  // The staff that may confirm is pinged only with roles of this very server.
  const managerRoleIds = await getSetting("fines.managerRoleIds");
  const guildRoleIds = "guild" in channel && channel.guild ? managerRoleIds.filter((id) => channel.guild.roles.cache.has(id)) : [];
  const posted = await runOnce(job, "post", log, async () => ({
    id: (
      await channel.send({
        ...(guildRoleIds.length > 0 ? { content: formatRoleMentions(guildRoleIds) } : {}),
        embeds: [fineClaimEmbed(claim, files[0]?.name ?? null)],
        components: fineClaimButtons(claim),
        files,
        allowedMentions: { parse: [], roles: guildRoleIds },
      })
    ).id,
  }));
  await setFinePaymentClaimReviewMessage(claimId, { channelId: channel.id, messageId: posted.id });
  return { status: "sent", claimId, messageId: posted.id, files: files.length };
};

/** The report got its decision: the message shows it and loses the buttons, the reporter is told. */
const fineClaimDecided: JobHandler = async (payload, { client, log, job }) => {
  const claimId = String(payload.claimId ?? "");
  const claim = await getFinePaymentClaim(claimId);
  if (!claim) return { status: "skipped", reason: "claim not found" };
  if (claim.decision === "PENDING") return { status: "skipped", reason: "no decision yet" };

  let edited = false;
  if (claim.reviewChannelId && claim.reviewMessageId) {
    try {
      const channel = await client.channels.fetch(claim.reviewChannelId);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(claim.reviewMessageId);
        // The screenshot stays attached to the message, so the embed keeps referencing it.
        const image = message.attachments.first()?.name ?? null;
        await message.edit({ embeds: [fineClaimEmbed(claim, image)], components: [] });
        edited = true;
      }
    } catch (error) {
      log.warn({ err: error, claimId }, "failed to edit the decided payment report");
    }
  }

  const text = fineClaimDm(claim);
  const dm = text
    ? await runOnce(job, "dm", log, async () => ({
        sent: await sendDirectMessage(
          client,
          claim.claimantDiscordId,
          text,
          log,
          "finePayment",
          // Declined: the person may send the report again right from this message.
          claim.decision === "REJECTED" && claim.fine.status === RecordStatus.ACTIVE ? [finePaidRow(claim.fineId)] : [],
        ),
      }))
    : { sent: false };
  return { status: "sent", claimId, edited, dm: dm.sent };
};

export const jobHandlers = new Map<string, JobHandler>([
  [
    "system.ping",
    async (_payload, { client }) => ({
      pong: true,
      botUserId: client.user?.id ?? null,
      guilds: client.guilds.cache.size,
      at: new Date().toISOString(),
    }),
  ],
  [MODULE_JOB_TYPES.DOCUMENT_SEND, documentSend],
  [MODULE_JOB_TYPES.DOCUMENT_RESPONSE_SEND, documentResponseSend],
  [MODULE_JOB_TYPES.WANTED_PUBLISH, wantedPublish],
  [MODULE_JOB_TYPES.WANTED_EDIT_CLOSED, wantedEditClosed],
  [MODULE_JOB_TYPES.FINE_PUBLISH, finePublish],
  [MODULE_JOB_TYPES.FINE_EDIT_PAID, fineEditPaid],
  [MODULE_JOB_TYPES.FINE_OVERDUE, fineOverdue],
  [MODULE_JOB_TYPES.FINE_REFRESH, fineRefresh],
  [MODULE_JOB_TYPES.FINE_CLAIM_REVIEW, fineClaimReview],
  [MODULE_JOB_TYPES.FINE_CLAIM_DECIDED, fineClaimDecided],
  [MODULE_JOB_TYPES.PERSONNEL_KICK, personnelKick],
  [MODULE_JOB_TYPES.CP_RECONCILE, cpReconcile],
  [MODULE_JOB_TYPES.PERSONNEL_PUBLISH, personnelPublish],
  [MODULE_JOB_TYPES.MESSAGE_DESIGN_SEND, messageDesignSend],
  [MODULE_JOB_TYPES.MESSAGE_DESIGN_RESEND, messageDesignResend],
  [MODULE_JOB_TYPES.MESSAGE_DESIGN_IMPORT, messageDesignImport],
  [MODULE_JOB_TYPES.REGISTRATION_REVIEW, registrationReview],
  [MODULE_JOB_TYPES.REGISTRATION_DECIDED, registrationDecided],
  [MODULE_JOB_TYPES.REGISTRATION_EXPIRED, registrationExpired],
  [MODULE_JOB_TYPES.TRANSFER_REVIEW, transferReview],
  [MODULE_JOB_TYPES.TRANSFER_DECIDED, transferDecided],
  [MODULE_JOB_TYPES.ROLE_PANEL_PUBLISH, rolePanelPublish],
  [MODULE_JOB_TYPES.ROLE_PANEL_ARCHIVE, rolePanelArchive],
  [MODULE_JOB_TYPES.FEEDBACK_TICKET_NOTIFY, feedbackTicketNotify],
  [MODULE_JOB_TYPES.FEEDBACK_REPLY_SEND, feedbackReplySend],
  [MODULE_JOB_TYPES.FEEDBACK_CLOSED_SEND, feedbackClosedSend],
  [MODULE_JOB_TYPES.FEEDBACK_OPEN_PUBLISH, feedbackOpenPublish],
  [MODULE_JOB_TYPES.FORM_SUBMISSION_DELIVER, formSubmissionDeliver],
  [MODULE_JOB_TYPES.FORM_SUBMISSION_DECIDED, formSubmissionDecided],
  [MODULE_JOB_TYPES.FORM_OPEN_PUBLISH, formOpenPublish],
  [MODULE_JOB_TYPES.TOKEN_RECEIVE_PUBLISH, tokenReceivePublish],
  [MODULE_JOB_TYPES.LAWYER_CALL_PANEL_PUBLISH, lawyerCallPanelPublish],
  [MODULE_JOB_TYPES.WEBHOOK_REQUEST_NOTIFY, webhookRequestNotify],
  [MODULE_JOB_TYPES.VEHICLE_REQUEST_SEND, vehicleRequestSend],
  [MODULE_JOB_TYPES.IC_BLACKLIST_PUBLISH, icBlacklistPublish],
  [MODULE_JOB_TYPES.IC_BLACKLIST_EDIT_CLOSED, icBlacklistEditClosed],
  [MODULE_JOB_TYPES.ADMIN_ROLES_APPLY, adminRolesApply],
]);

