/**
 * Slash command interaction handlers for Stage 3 modules.
 * Mutations go through core APIs; Discord delivery is enqueued as jobs.
 */
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { AuditActorType } from "@mirror/db";
import {
  canActOnModuleRecord,
  canManageModules,
  closeWanted,
  createDocument,
  createDocumentResponse,
  createFine,
  createPersonnelEvent,
  createWanted,
  deliveryDeferredMessage,
  enqueueDocumentResponseSend,
  enqueueDocumentSend,
  enqueueFineEditPaid,
  enqueueFinePublish,
  enqueuePersonnelPublish,
  enqueueWantedEditClosed,
  enqueueWantedPublish,
  getDocumentByNumber,
  getSetting,
  markFinePaid,
  PERSONNEL_EVENT_LABELS_RU,
  PERSONNEL_EVENT_TYPES,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFineDelivery,
  resolveIdentity,
  resolveWantedDelivery,
  type Identity,
  type Logger,
  type PersonnelEventType,
} from "@mirror/core";

export interface SlashHandlerContext {
  superAdminUserIds: readonly string[];
  log: Logger;
}

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

function auditFromInteraction(interaction: ChatInputCommandInteraction) {
  return {
    actorType: AuditActorType.USER,
    source: "bot.slash",
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId,
    metadata: {
      discordUserId: interaction.user.id,
      command: interaction.commandName,
    },
  };
}

function hasFactionMembership(identity: Identity, factionCode?: string): boolean {
  if (factionCode) {
    return identity.factions.some((f) => f.code.toUpperCase() === factionCode.toUpperCase());
  }
  return identity.factions.length > 0;
}

function canPostDocument(identity: Identity): boolean {
  return canManageModules(identity) || hasFactionMembership(identity);
}

function canReplyDocument(identity: Identity, documentFactionCode: string): boolean {
  return (
    canManageModules(identity) ||
    hasFactionMembership(identity, documentFactionCode) ||
    hasFactionMembership(identity, "GOV")
  );
}

function canPersonnel(identity: Identity, factionCode: string): boolean {
  if (canManageModules(identity)) return true;
  const faction = identity.factions.find((f) => f.code.toUpperCase() === factionCode.toUpperCase());
  return Boolean(faction?.isLeader || faction?.isDeputy);
}

function primaryFactionCode(identity: Identity): string | null {
  return identity.factions[0]?.code ?? null;
}

function buildPersonnelDetails(
  type: PersonnelEventType,
  raw: string | null,
): Record<string, unknown> {
  const text = raw?.trim() ?? "";
  if (text.startsWith("{")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  switch (type) {
    case "promotion": {
      const toRank = Number.parseInt(text, 10);
      if (!Number.isFinite(toRank) || toRank < 1) {
        throw new Error('Для повышения укажите новый ранг числом или JSON {"toRank":N}');
      }
      return { toRank };
    }
    case "dismissal":
      return { reason: text || "Не указана" };
    case "transfer":
      if (!text) throw new Error("Укажите отдел назначения в поле «детали»");
      return { toDepartment: text };
    case "reinstatement":
      return text ? { comment: text } : {};
    case "appointment":
      if (!text) throw new Error("Укажите должность в поле «детали»");
      return { position: text };
    default:
      return {};
  }
}

async function loadIdentity(discordUserId: string, ctx: SlashHandlerContext): Promise<Identity> {
  return resolveIdentity(discordUserId, { superAdminUserIds: ctx.superAdminUserIds });
}

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  ctx: SlashHandlerContext,
): Promise<void> {
  const name = interaction.commandName;
  try {
    switch (name) {
      case "пост":
        await handlePost(interaction, ctx);
        break;
      case "ответ":
        await handleReply(interaction, ctx);
        break;
      case "объявить-розыск":
        await handleWantedCreate(interaction, ctx);
        break;
      case "розыск-исполнено":
        await handleWantedClose(interaction, ctx);
        break;
      case "штраф":
        await handleFineCreate(interaction, ctx);
        break;
      case "штраф-оплачено":
        await handleFinePaid(interaction, ctx);
        break;
      case "кадровый-аудит":
        await handlePersonnel(interaction, ctx);
        break;
      default:
        await interaction.reply(ephemeral("Неизвестная команда."));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    ctx.log.warn({ err: error, command: name }, "slash command failed");
    const payload = ephemeral(`Ошибка: ${message}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
}

async function handlePost(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canPostDocument(identity)) {
    await interaction.editReply("Недостаточно прав: нужна фракция или уровень администратора.");
    return;
  }

  const factionCode = interaction.options.getString("фракция", true).toUpperCase();
  const subject = interaction.options.getString("тема", true);
  const content = interaction.options.getString("содержание", true);

  const doc = await createDocument(
    {
      factionCode,
      authorDiscordId: interaction.user.id,
      subject,
      content,
    },
    auditFromInteraction(interaction),
  );
  await enqueueDocumentSend(doc.id);
  const target = await resolveFactionDocumentDelivery(factionCode);
  await interaction.editReply(
    `Документ **${doc.number}** создан.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handleReply(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const number = interaction.options.getString("номер", true).toUpperCase();
  const content = interaction.options.getString("содержание", true);

  const existing = await getDocumentByNumber(number);
  if (!existing || existing.status !== "ACTIVE") {
    await interaction.editReply(`Документ ${number} не найден или не активен.`);
    return;
  }

  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canReplyDocument(identity, existing.factionCode)) {
    await interaction.editReply("Недостаточно прав для ответа на этот документ.");
    return;
  }

  const result = await createDocumentResponse(
    {
      documentNumber: number,
      authorDiscordId: interaction.user.id,
      content,
    },
    auditFromInteraction(interaction),
  );
  await enqueueDocumentResponseSend(result.response.id, result.document.id);
  const target = await resolveFactionDocumentDelivery(result.document.factionCode);
  await interaction.editReply(
    `Ответ на **${result.document.number}** сохранён.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handleWantedCreate(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canManageModules(identity)) {
    await interaction.editReply("Недостаточно прав: нужен уровень администратора.");
    return;
  }
  if (!(await getSetting("wanted.enabled"))) {
    await interaction.editReply("Модуль розыска отключён в настройках.");
    return;
  }

  const wanted = await createWanted(
    {
      staticId: interaction.options.getString("статик", true),
      characterName: interaction.options.getString("имя", true),
      reason: interaction.options.getString("основание", true),
      issuedByDiscordId: interaction.user.id,
    },
    auditFromInteraction(interaction),
  );
  await enqueueWantedPublish(wanted.id);
  const target = await resolveWantedDelivery();
  await interaction.editReply(
    `Розыск **${wanted.number}** объявлен.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handleWantedClose(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canActOnModuleRecord(identity)) {
    await interaction.editReply("Недостаточно прав: нужен уровень администратора.");
    return;
  }

  const number = interaction.options.getString("номер", true).toUpperCase();
  const evidence = interaction.options.getString("доказательства", true);
  const closed = await closeWanted(
    {
      wantedNumber: number,
      closedByDiscordId: interaction.user.id,
      evidence,
    },
    auditFromInteraction(interaction),
  );
  await enqueueWantedEditClosed(closed.id);
  const target = await resolveWantedDelivery();
  await interaction.editReply(
    `Розыск **${closed.number}** закрыт.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handleFineCreate(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canManageModules(identity)) {
    await interaction.editReply("Недостаточно прав: нужен уровень администратора.");
    return;
  }

  const factionCode =
    interaction.options.getString("фракция")?.toUpperCase() ?? primaryFactionCode(identity);
  if (!factionCode) {
    await interaction.editReply(
      "Укажите фракцию (параметр «фракция») или получите фракционную роль.",
    );
    return;
  }

  const fine = await createFine(
    {
      staticId: interaction.options.getString("статик", true),
      characterName: interaction.options.getString("имя", true),
      amount: interaction.options.getInteger("сумма", true),
      reason: interaction.options.getString("основание", true),
      issuedByDiscordId: interaction.user.id,
      factionCode,
    },
    auditFromInteraction(interaction),
  );
  await enqueueFinePublish(fine.id);
  const target = await resolveFineDelivery();
  await interaction.editReply(
    `Штраф **${fine.number}** на ${fine.amount.toLocaleString("ru-RU")} ₽ создан.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handleFinePaid(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canActOnModuleRecord(identity)) {
    await interaction.editReply("Недостаточно прав: нужен уровень администратора.");
    return;
  }

  const number = interaction.options.getString("номер", true).toUpperCase();
  const paid = await markFinePaid(
    { fineNumber: number, paidByDiscordId: interaction.user.id },
    auditFromInteraction(interaction),
  );
  await enqueueFineEditPaid(paid.id);
  const target = await resolveFineDelivery();
  await interaction.editReply(
    `Штраф **${paid.number}** отмечен как оплаченный.\n${deliveryDeferredMessage(target)}`,
  );
}

async function handlePersonnel(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  const typeRaw = interaction.options.getString("тип", true);
  if (!(PERSONNEL_EVENT_TYPES as readonly string[]).includes(typeRaw)) {
    await interaction.editReply("Неизвестный тип кадрового события.");
    return;
  }
  const type = typeRaw as PersonnelEventType;
  const subject = interaction.options.getUser("сотрудник", true);
  const detailsRaw = interaction.options.getString("детали");

  const factionCode =
    interaction.options.getString("фракция")?.toUpperCase() ?? primaryFactionCode(identity);
  if (!factionCode) {
    await interaction.editReply(
      "Укажите фракцию (параметр «фракция») или получите фракционную роль.",
    );
    return;
  }
  if (!canPersonnel(identity, factionCode)) {
    await interaction.editReply("Недостаточно прав: лидер/зам фракции или администратор.");
    return;
  }

  let details: Record<string, unknown>;
  try {
    details = buildPersonnelDetails(type, detailsRaw);
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : "Некорректные детали");
    return;
  }

  const event = await createPersonnelEvent(
    {
      factionCode,
      type,
      subjectDiscordId: subject.id,
      subjectName: subject.displayName || subject.username,
      actorDiscordId: interaction.user.id,
      details,
    },
    auditFromInteraction(interaction),
  );
  await enqueuePersonnelPublish(event.id);
  const target = await resolveFactionPersonnelDelivery(factionCode);
  const label = PERSONNEL_EVENT_LABELS_RU[type];
  await interaction.editReply(
    `Кадровое событие «${label}» для **${event.subjectName}** сохранено.\n${deliveryDeferredMessage(target)}`,
  );
}
