/**
 * Persistent button engine: custom_id = mirror:<action>:<id>.
 */
import {
  ActionRowBuilder,
  ModalBuilder,
  MessageFlags,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  decideRegistration,
  decideTransfer,
  createFeedbackTicket,
  canManageModules,
  ensureUserByDiscordId,
  formatTokenDisplay,
  getCharacterForUser,
  getSetting,
  getDiscordForm,
  getButtonAction,
  issueToken,
  parseCustomId,
  submitDiscordForm,
  resolveIdentity,
  writeAuditEvent,
  type AuditContext,
  type Logger,
} from "@mirror/core";
import { AuditActorType, DecisionStatus } from "@mirror/db";
import {
  buildRegistrationReview,
  buildTransferReview,
  editStoredReviewMessage,
  loadRegistration,
  loadTransfer,
  type ReviewMessagePayload,
} from "./stage4-review.js";

export interface InteractionContext {
  client: Client;
  superAdminUserIds: readonly string[];
  log: Logger;
}

const COOLDOWN_MS = 3_000;
const recentClicks = new Map<string, number>();
type AnyInteraction = ButtonInteraction | ModalSubmitInteraction;

function cooldownKey(userId: string, actionId: string) {
  return `${userId}:${actionId}`;
}

function underCooldown(userId: string, actionId: string): boolean {
  const key = cooldownKey(userId, actionId);
  const last = recentClicks.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  recentClicks.set(key, Date.now());
  return false;
}

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

/** Replies with an ephemeral error whether or not the interaction was already acknowledged. */
export async function replyInteractionError(interaction: AnyInteraction, error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  const payload = ephemeral(`Ошибка: ${message}`);
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

function interactionRoleIds(interaction: AnyInteraction): string[] {
  if (!interaction.member || typeof interaction.member === "string") return [];
  return Array.isArray(interaction.member.roles) ? interaction.member.roles : [...interaction.member.roles.cache.keys()];
}

function auditContext(interaction: AnyInteraction, source: string): AuditContext {
  return {
    actorType: AuditActorType.USER,
    source,
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId ?? undefined,
    metadata: { discordUserId: interaction.user.id },
  };
}

function storedParams(stored: { params: unknown } | null): Record<string, unknown> {
  return stored?.params && typeof stored.params === "object" && !Array.isArray(stored.params)
    ? (stored.params as Record<string, unknown>)
    : {};
}

async function canReviewRegistration(interaction: AnyInteraction, ctx: InteractionContext): Promise<boolean> {
  const identity = await resolveIdentity(interaction.user.id, { superAdminUserIds: ctx.superAdminUserIds });
  if (canManageModules(identity)) return true;
  const coordinatorRoleIds = await getSetting("registrations.coordinatorRoleIds");
  const held = interactionRoleIds(interaction);
  return coordinatorRoleIds.some((roleId) => held.includes(roleId));
}

async function canReviewTransfer(
  interaction: AnyInteraction,
  params: Record<string, unknown>,
  ctx: InteractionContext,
): Promise<boolean> {
  const identity = await resolveIdentity(interaction.user.id, { superAdminUserIds: ctx.superAdminUserIds });
  if (canManageModules(identity)) return true;
  const factionCode = String(params.factionCode ?? "").toUpperCase();
  const faction = identity.factions.find((item) => item.code.toUpperCase() === factionCode);
  return Boolean(faction?.isLeader || faction?.isDeputy);
}

/** Updates the message the interaction came from, or the stored review message otherwise. */
async function applyReviewUpdate(
  interaction: AnyInteraction,
  ctx: InteractionContext,
  location: { reviewGuildId: string | null; reviewChannelId: string | null; reviewMessageId: string | null },
  payload: ReviewMessagePayload,
  confirmation: string,
) {
  const fromMessage = interaction.isButton() || interaction.isFromMessage();
  if (fromMessage && interaction.message?.id === location.reviewMessageId) {
    await interaction.update(payload);
    await interaction.followUp(ephemeral(confirmation));
    return;
  }
  await interaction.reply(ephemeral(confirmation));
  try {
    await editStoredReviewMessage(ctx.client, location, payload);
  } catch (error) {
    ctx.log.warn({ err: error }, "failed to edit stored review message");
  }
}

function asSnowflakeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && /^\d{17,20}$/.test(item));
}

async function handleRoleToggle(interaction: ButtonInteraction, params: Record<string, unknown>, log: Logger) {
  const roleDiscordId = String(params.roleDiscordId ?? "");
  if (!/^\d{17,20}$/.test(roleDiscordId)) {
    await interaction.reply(ephemeral("Кнопка настроена некорректно (роль)."));
    return;
  }
  if (!interaction.guild || !interaction.member) {
    await interaction.reply(ephemeral("Кнопка работает только на сервере."));
    return;
  }

  const role = await interaction.guild.roles.fetch(roleDiscordId).catch(() => null);
  const me = interaction.guild.members.me;
  if (!role || !me) {
    await interaction.reply(ephemeral("Роль недоступна."));
    return;
  }
  if (role.managed || role.position >= me.roles.highest.position) {
    await interaction.reply(ephemeral("Не могу выдать или снять эту роль (иерархия / managed)."));
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const allowedRoleIds = asSnowflakeArray(params.allowedRoleIds);
  if (allowedRoleIds.length > 0 && !allowedRoleIds.some((id) => member.roles.cache.has(id))) {
    await interaction.reply(ephemeral("У вас нет роли, необходимой для нажатия этой кнопки."));
    return;
  }

  const has = member.roles.cache.has(role.id);
  if (has) {
    await member.roles.remove(role, "Mirror: кнопка role.toggle");
  } else {
    const exclusiveRoleIds = asSnowflakeArray(params.exclusiveRoleIds).filter((id) => id !== role.id);
    const toRemove = exclusiveRoleIds.filter((id) => member.roles.cache.has(id));
    if (toRemove.length > 0) {
      await member.roles.remove(toRemove, "Mirror: взаимоисключающие роли");
    }
    await member.roles.add(role, "Mirror: кнопка role.toggle");
  }

  await writeAuditEvent({
    actorType: AuditActorType.USER,
    source: "discord.button",
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    action: has ? "button.role_removed" : "button.role_added",
    entityType: "discord_role",
    entityId: role.id,
    after: {
      userDiscordId: interaction.user.id,
      roleName: role.name,
      exclusiveRemoved: has ? [] : asSnowflakeArray(params.exclusiveRoleIds).filter((id) => id !== role.id),
    },
  });

  await interaction.reply(ephemeral(has ? `Роль **${role.name}** снята.` : `Роль **${role.name}** выдана.`));
  log.info({ userId: interaction.user.id, roleId: role.id, removed: has }, "role.toggle");
}

async function handleCallback(interaction: ButtonInteraction, params: Record<string, unknown>) {
  const message = typeof params.message === "string" && params.message.trim()
    ? params.message.trim().slice(0, 500)
    : "Кнопка нажата.";
  await interaction.reply(ephemeral(message));
}

async function handleFormOpen(interaction: ButtonInteraction, params: Record<string, unknown>) {
  const formId = String(params.formId ?? "");
  const form = await getDiscordForm(formId);
  if (!form) {
    await interaction.reply(ephemeral("Форма недоступна."));
    return;
  }
  if (form.fields.length > 5) {
    await interaction.reply(ephemeral("Форма содержит больше пяти полей и требует многошагового режима."));
    return;
  }
  const modal = new ModalBuilder().setCustomId(`mirror:form.submit:${form.id}`).setTitle(form.name.slice(0, 45));
  modal.addComponents(
    ...form.fields.map((field) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`field:${field.key}`)
          .setLabel(field.label.slice(0, 45))
          .setStyle(field.type === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(field.required),
      ),
    ),
  );
  await interaction.showModal(modal);
}

function reasonModal(customId: string) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Причина отказа")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Причина")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

function tokenReceiveModal(actionId: string) {
  return new ModalBuilder()
    .setCustomId(`mirror:token.receive:${actionId}`)
    .setTitle("Получить нашивку")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("static")
          .setLabel("Статик персонажа")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32),
      ),
    );
}

async function handleRegistrationDecision(
  interaction: ButtonInteraction,
  params: Record<string, unknown>,
  decision: DecisionStatus,
  actionId: string,
  ctx: InteractionContext,
) {
  if (!(await canReviewRegistration(interaction, ctx))) {
    await interaction.reply(ephemeral("Недостаточно прав для обработки заявок."));
    return;
  }
  const registrationId = String(params.registrationId ?? "");
  if (!registrationId) throw new Error("Заявка не указана.");
  if (decision === DecisionStatus.REJECTED) {
    await interaction.showModal(reasonModal(`mirror:registration.reject:${actionId}`));
    return;
  }
  await decideRegistration(
    registrationId,
    DecisionStatus.APPROVED,
    interaction.user.id,
    null,
    auditContext(interaction, "discord.button"),
  );
  await finishRegistrationDecision(interaction, ctx, registrationId, "Заявка одобрена.");
}

async function finishRegistrationDecision(
  interaction: AnyInteraction,
  ctx: InteractionContext,
  registrationId: string,
  confirmation: string,
) {
  const registration = await loadRegistration(registrationId);
  if (!registration) throw new Error("Заявка не найдена.");
  await applyReviewUpdate(interaction, ctx, registration, await buildRegistrationReview(registration), confirmation);
}

async function finishTransferDecision(
  interaction: AnyInteraction,
  ctx: InteractionContext,
  transferId: string,
  confirmation: string,
) {
  const transfer = await loadTransfer(transferId);
  if (!transfer) throw new Error("Перевод не найден.");
  await applyReviewUpdate(interaction, ctx, transfer, await buildTransferReview(transfer), confirmation);
}

async function handleTransferDecision(
  interaction: ButtonInteraction,
  params: Record<string, unknown>,
  action: string,
  actionId: string,
  ctx: InteractionContext,
) {
  const transferId = String(params.transferId ?? "");
  if (!transferId) throw new Error("Перевод не указан.");
  const side = action.endsWith(".source") ? "source" : "target";
  if (!(await canReviewTransfer(interaction, params, ctx))) {
    await interaction.reply(ephemeral("Решение доступно лидеру/заместителю соответствующей фракции."));
    return;
  }
  if (action.startsWith("transfer.reject")) {
    await interaction.showModal(reasonModal(`mirror:transfer.reject:${actionId}`));
    return;
  }
  await decideTransfer(
    transferId,
    side,
    DecisionStatus.APPROVED,
    interaction.user.id,
    null,
    auditContext(interaction, "discord.button"),
  );
  await finishTransferDecision(
    interaction,
    ctx,
    transferId,
    `Решение фракции (${side === "source" ? "текущая" : "принимающая"}) принято.`,
  );
}

async function handleFeedbackOpen(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`mirror:feedback.submit:${interaction.customId.split(":").at(-1)}`)
    .setTitle("Обратная связь")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("category").setLabel("Категория").setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("content").setLabel("Сообщение").setStyle(TextInputStyle.Paragraph).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

async function routeModalSubmit(interaction: ModalSubmitInteraction, ctx: InteractionContext): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (parsed.action === "form.submit") {
    const form = await getDiscordForm(parsed.id);
    if (!form) throw new Error("Форма недоступна.");
    const values = Object.fromEntries(form.fields.map((field) => [field.key, interaction.fields.getTextInputValue(`field:${field.key}`)]));
    await submitDiscordForm(form.id, values, interaction.user.id);
    await interaction.reply(ephemeral("Ответ на форму сохранён."));
    return true;
  }
  if (parsed.action === "feedback.submit") {
    const category = interaction.fields.getTextInputValue("category");
    const content = interaction.fields.getTextInputValue("content");
    await createFeedbackTicket({ authorDiscordId: interaction.user.id, category, content }, auditContext(interaction, "discord.modal"));
    await interaction.reply(ephemeral("Обращение создано."));
    return true;
  }
  if (parsed.action === "registration.reject") {
    const params = storedParams(await getButtonAction(parsed.id));
    const registrationId = String(params.registrationId ?? "");
    if (!registrationId) throw new Error("Кнопка устарела или отключена.");
    if (!(await canReviewRegistration(interaction, ctx))) {
      await interaction.reply(ephemeral("Недостаточно прав для обработки заявок."));
      return true;
    }
    await decideRegistration(
      registrationId,
      DecisionStatus.REJECTED,
      interaction.user.id,
      interaction.fields.getTextInputValue("reason"),
      auditContext(interaction, "discord.modal"),
    );
    await finishRegistrationDecision(interaction, ctx, registrationId, "Заявка отклонена.");
    return true;
  }
  if (parsed.action === "transfer.reject") {
    const params = storedParams(await getButtonAction(parsed.id));
    const transferId = String(params.transferId ?? "");
    if (!transferId) throw new Error("Кнопка устарела или отключена.");
    if (!(await canReviewTransfer(interaction, params, ctx))) {
      await interaction.reply(ephemeral("Решение доступно лидеру/заместителю соответствующей фракции."));
      return true;
    }
    const side = params.side === "target" ? "target" : "source";
    await decideTransfer(
      transferId,
      side,
      DecisionStatus.REJECTED,
      interaction.user.id,
      interaction.fields.getTextInputValue("reason"),
      auditContext(interaction, "discord.modal"),
    );
    await finishTransferDecision(interaction, ctx, transferId, "Решение об отказе сохранено.");
    return true;
  }
  if (parsed.action === "token.receive") {
    if (!(await getButtonAction(parsed.id))) throw new Error("Кнопка устарела или отключена.");
    const staticId = interaction.fields.getTextInputValue("static").trim();
    const { user } = await ensureUserByDiscordId(interaction.user.id);
    const character = await getCharacterForUser(user.id, staticId);
    if (!character) {
      await interaction.reply(ephemeral("Персонаж с таким статиком не найден в вашем профиле."));
      return true;
    }
    const token = await issueToken(character.id, auditContext(interaction, "discord.modal"));
    await interaction.reply(
      ephemeral(
        `Выдан номер нашивки: **${formatTokenDisplay({
          factionCode: character.factionCode,
          department: character.department,
          number: token.number,
        })}**.`,
      ),
    );
    return true;
  }
  return false;
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction, ctx: InteractionContext) {
  try {
    return await routeModalSubmit(interaction, ctx);
  } catch (error) {
    ctx.log.warn({ err: error, customId: interaction.customId }, "modal submit failed");
    await replyInteractionError(interaction, error);
    return true;
  }
}

async function routeButton(interaction: ButtonInteraction, ctx: InteractionContext): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (underCooldown(interaction.user.id, parsed.id)) {
    await interaction.reply(ephemeral("Подождите пару секунд."));
    return true;
  }

  const stored = await getButtonAction(parsed.id);
  if (!stored) {
    await interaction.reply(ephemeral("Кнопка устарела или отключена."));
    return true;
  }

  const params = storedParams(stored);
  const action = stored.action || parsed.action;
  if (action === "role.toggle") {
    await handleRoleToggle(interaction, params, ctx.log);
  } else if (action === "form.open") {
    await handleFormOpen(interaction, params);
  } else if (action === "registration.approve") {
    await handleRegistrationDecision(interaction, params, DecisionStatus.APPROVED, parsed.id, ctx);
  } else if (action === "registration.reject") {
    await handleRegistrationDecision(interaction, params, DecisionStatus.REJECTED, parsed.id, ctx);
  } else if (action.startsWith("transfer.approve") || action.startsWith("transfer.reject")) {
    await handleTransferDecision(interaction, params, action, parsed.id, ctx);
  } else if (action === "feedback.open") {
    await handleFeedbackOpen(interaction);
  } else if (action === "token.receive") {
    await interaction.showModal(tokenReceiveModal(parsed.id));
  } else if (action === "callback") {
    await handleCallback(interaction, params);
  } else {
    await interaction.reply(ephemeral(`Неизвестное действие кнопки: ${action}`));
  }
  return true;
}

export async function handleButtonInteraction(interaction: ButtonInteraction, ctx: InteractionContext) {
  try {
    return await routeButton(interaction, ctx);
  } catch (error) {
    ctx.log.warn({ err: error, customId: interaction.customId }, "button interaction failed");
    await replyInteractionError(interaction, error);
    return true;
  }
}
