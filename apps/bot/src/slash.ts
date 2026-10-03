/**
 * Slash command interaction handlers for Stage 3 modules.
 * Mutations go through core APIs; Discord delivery is enqueued as jobs.
 */
import {
  type Attachment,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { AuditActorType, RegistrationKind } from "@mirror/db";
import {
  IMAGE_CONTENT_TYPES,
  MAX_MEDIA_BYTES,
  archiveMediaFile,
  listVehicleModels,
  normalizePlate,
  resolveVehicleModelName,
  storeMediaFromUrl,
  canActOnModuleRecord,
  canManageModules,
  closeWanted,
  createCharacter,
  createRegistration,
  createTransfer,
  createWebhookRequest,
  createIcBlacklistEntry,
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
  formatMoney,
  getActiveFactionByCode,
  getCharacterForUser,
  getDocumentByNumber,
  getSetting,
  listActiveFactionsForAutocomplete,
  markFinePaid,
  ensureUserByDiscordId,
  issueToken,
  listCharacters,
  PERSONNEL_EVENT_LABELS_RU,
  PERSONNEL_EVENT_TYPES,
  resolveDocumentResponseDelivery,
  resolveDocumentResponseLocalDelivery,
  resolveFactionDocumentDelivery,
  resolveFactionPersonnelDelivery,
  resolveFineDelivery,
  resolveFinePaidDelivery,
  resolveIdentity,
  resolveWantedDelivery,
  revokeToken,
  revokeIcBlacklistByStatic,
  sameDeliveryChannel,
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

function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member;
  if (!member || typeof member === "string") return [];
  const roles = member.roles;
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()];
}

function memberHasAnyRole(interaction: ChatInputCommandInteraction, roleIds: readonly string[]): boolean {
  if (roleIds.length === 0) return false;
  const held = new Set(memberRoleIds(interaction));
  return roleIds.some((id) => held.has(id));
}

function normalizeChannelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function isWantedCommandChannel(interaction: ChatInputCommandInteraction, configuredChannelId: string | null): boolean {
  if (configuredChannelId && interaction.channelId === configuredChannelId) return true;
  const channel = interaction.channel;
  if (channel && "name" in channel && typeof channel.name === "string") {
    return normalizeChannelName(channel.name) === "федеральный розыск";
  }
  return false;
}

async function assertWantedCommandAllowed(
  interaction: ChatInputCommandInteraction,
  identity: Identity,
): Promise<string | null> {
  if (!(await getSetting("wanted.enabled"))) {
    return "Модуль розыска отключён в настройках.";
  }
  const [channelId, coordinatorRoleIds] = await Promise.all([
    getSetting("wanted.channelId"),
    getSetting("wanted.coordinatorRoleIds"),
  ]);
  if (!isWantedCommandChannel(interaction, channelId)) {
    return "Команды розыска можно использовать только в канале «федеральный розыск».";
  }
  if (memberHasAnyRole(interaction, coordinatorRoleIds) || canManageModules(identity)) {
    return null;
  }
  return "Недостаточно прав: нужна роль «Координатор».";
}

function buildPersonnelDetails(
  type: PersonnelEventType,
  raw: string | null,
  ranks?: { fromRank: number | null; toRank: number | null },
): Record<string, unknown> {
  const text = raw?.trim() ?? "";
  if (text.startsWith("{")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  switch (type) {
    case "promotion": {
      const fromRank = ranks?.fromRank ?? null;
      const toRank = ranks?.toRank ?? null;
      if (fromRank == null || toRank == null || fromRank < 1 || toRank < 1) {
        throw new Error("Для повышения укажите «с_ранга» и «на_ранг»");
      }
      return {
        fromRank,
        toRank,
        ...(text ? { comment: text } : {}),
      };
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

async function requireActiveFaction(code: string): Promise<string> {
  const upper = code.toUpperCase();
  const faction = await getActiveFactionByCode(upper);
  if (!faction) {
    throw new Error(`Фракция «${upper}» не найдена или не активна`);
  }
  return faction.code;
}

/** Autocomplete for «фракция» — always all ACTIVE factions from DB. */
export async function handleFactionAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === "модель") {
    const models = await listVehicleModels(focused.value);
    await interaction.respond(
      models.map((model) => ({
        name: [model.brand, model.name, model.year].filter(Boolean).join(" ").slice(0, 100),
        value: model.name.slice(0, 100),
      })),
    );
    return;
  }
  if (focused.name !== "фракция") {
    await interaction.respond([]);
    return;
  }
  const choices = await listActiveFactionsForAutocomplete(focused.value);
  await interaction.respond(choices);
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
      case "персонаж":
        await handleCharacter(interaction);
        break;
      case "token":
        await handleToken(interaction, ctx);
        break;
      case "регистрация-тс":
      case "регистрация-формы":
        await handleRegistration(interaction, ctx);
        break;
      case "перевод-фракции":
        await handleTransfer(interaction);
        break;
      case "создать-webhook":
        await handleWebhookRequest(interaction, ctx);
        break;
      case "чс-добавить":
      case "чс-снять":
        await handleIcBlacklist(interaction, ctx);
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

async function handleCharacter(interaction: ChatInputCommandInteraction) {
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "создать") {
    const character = await createCharacter(
      {
        userId: user.id,
        slot: interaction.options.getInteger("слот", true),
        staticId: interaction.options.getString("статик", true),
        name: interaction.options.getString("имя", true),
      },
      auditFromInteraction(interaction),
    );
    await interaction.reply(ephemeral(`Персонаж **${character.name}** создан. Статик: **${character.staticId}**.`));
    return;
  }

  const characters = await listCharacters(user.id);
  await interaction.reply(
    ephemeral(
      characters.length === 0
        ? "Персонажей пока нет."
        : characters
            .map(
              (character) =>
                `${character.slot}. **${character.name}** · статик ${character.staticId}${character.tokens[0] ? ` · нашивка ${character.tokens[0].number}` : ""}`,
            )
            .join("\n"),
    ),
  );
}

async function handleToken(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "remove") {
    const identity = await loadIdentity(interaction.user.id, ctx);
    if (!canManageModules(identity)) {
      await interaction.reply(ephemeral("Отозвать нашивку могут только администраторы."));
      return;
    }
    await revokeToken(interaction.options.getString("номер", true), auditFromInteraction(interaction));
    await interaction.reply(ephemeral("Нашивка отозвана."));
    return;
  }

  const character = await getCharacterForUser(user.id, interaction.options.getString("статик", true));
  if (!character) {
    await interaction.reply(ephemeral("Персонаж с таким статиком не найден в вашем профиле."));
    return;
  }
  if (subcommand === "get") {
    const token = character.tokens[0];
    await interaction.reply(ephemeral(token ? `Номер нашивки: **${token.number}**.` : "У персонажа ещё нет нашивки."));
    return;
  }
  const token = await issueToken(character.id, auditFromInteraction(interaction));
  await interaction.reply(ephemeral(`Выдан номер нашивки: **${token.number}**.`));
}

/** Validates a slash attachment as an image ≤ 10 MB and stores it in media_files. */
async function storeImageAttachment(
  interaction: ChatInputCommandInteraction,
  attachment: Attachment,
  createdById: string,
) {
  const contentType = attachment.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error("Приложите изображение PNG, JPEG, WEBP или GIF.");
  }
  if (attachment.size > MAX_MEDIA_BYTES) throw new Error("Файл превышает лимит 10 МБ.");
  return storeMediaFromUrl(
    attachment.url,
    { originalName: attachment.name, createdById, allowedContentTypes: IMAGE_CONTENT_TYPES },
    auditFromInteraction(interaction),
  );
}

async function archiveOrphanMedia(interaction: ChatInputCommandInteraction, ids: string[], ctx: SlashHandlerContext) {
  for (const id of ids) {
    await archiveMediaFile(id, auditFromInteraction(interaction)).catch((error: unknown) =>
      ctx.log.warn({ err: error, mediaFileId: id }, "failed to archive orphan media"),
    );
  }
}

async function handleRegistration(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const character = await getCharacterForUser(user.id, interaction.options.getString("статик", true));
  if (!character) {
    await interaction.editReply("Персонаж с таким статиком не найден в вашем профиле.");
    return;
  }

  const isVehicle = interaction.commandName === "регистрация-тс";
  const model = isVehicle ? await resolveVehicleModelName(interaction.options.getString("модель", true)) : null;
  const plate = isVehicle ? normalizePlate(interaction.options.getString("госномер", true)) : undefined;
  const photo = await storeImageAttachment(interaction, interaction.options.getAttachment("фото", true), user.id);
  try {
    const registration = await createRegistration(
      {
        kind: isVehicle ? RegistrationKind.VEHICLE : RegistrationKind.UNIFORM,
        characterId: character.id,
        payload: isVehicle ? { model } : { description: interaction.options.getString("описание", true) },
        plate,
        evidenceFileIds: [photo.id],
      },
      auditFromInteraction(interaction),
    );
    await interaction.editReply(
      `Заявка на регистрацию ${isVehicle ? `ТС **${plate}**` : "униформы"} создана и отправлена на рассмотрение (\`${registration.id}\`).`,
    );
  } catch (error) {
    await archiveOrphanMedia(interaction, [photo.id], ctx);
    throw error;
  }
}

async function handleTransfer(interaction: ChatInputCommandInteraction) {
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const character = await getCharacterForUser(user.id, interaction.options.getString("статик", true));
  if (!character) {
    await interaction.reply(ephemeral("Персонаж с таким статиком не найден в вашем профиле."));
    return;
  }
  const documents = (interaction.options.getString("документы") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const transfer = await createTransfer(
    {
      characterId: character.id,
      fromFactionCode: interaction.options.getString("из", true),
      toFactionCode: interaction.options.getString("в", true),
      fromRank: interaction.options.getInteger("с_ранга", true),
      toRank: interaction.options.getInteger("на_ранг", true),
      documentFileIds: documents,
      createdByDiscordId: interaction.user.id,
    },
    auditFromInteraction(interaction),
  );
  await interaction.reply(ephemeral(`Заявка на перевод **${transfer.id}** создана. Требуется одобрение обеих фракций.`));
}

async function handleWebhookRequest(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  if (!interaction.inGuild()) {
    await interaction.reply(ephemeral("Команда работает только на сервере."));
    return;
  }
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canPostDocument(identity)) {
    await interaction.reply(ephemeral("Запрос webhook доступен сотрудникам фракций и администраторам."));
    return;
  }
  const channel = interaction.options.getChannel("канал", true);
  const request = await createWebhookRequest(
    {
      requesterDiscordId: interaction.user.id,
      guildDiscordId: interaction.guildId,
      channelDiscordId: channel.id,
      description: interaction.options.getString("описание", true),
    },
    auditFromInteraction(interaction),
  );
  await interaction.reply(ephemeral(`Запрос webhook **${request.id}** принят админами.`));
}

async function handleIcBlacklist(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canManageModules(identity) && !hasFactionMembership(identity, "GOV")) {
    await interaction.reply(ephemeral("IC чёрным списком могут управлять только GOV и администраторы."));
    return;
  }
  if (interaction.commandName === "чс-снять") {
    await revokeIcBlacklistByStatic(
      interaction.options.getString("статик", true),
      interaction.user.id,
      auditFromInteraction(interaction),
    );
    await interaction.reply(ephemeral("Запись снята с IC чёрного списка."));
    return;
  }
  const rawExpiresAt = interaction.options.getString("срок");
  const expiresAt = rawExpiresAt ? new Date(rawExpiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Срок должен быть датой ISO.");
  const entry = await createIcBlacklistEntry(
    {
      staticId: interaction.options.getString("статик", true),
      fullName: interaction.options.getString("фио", true),
      reason: interaction.options.getString("причина", true),
      expiresAt,
      createdByDiscordId: interaction.user.id,
      evidenceFileIds: [],
    },
    auditFromInteraction(interaction),
  );
  await interaction.reply(ephemeral(`Гражданин добавлен в IC чёрный список. Запись: **${entry.id}**.`));
}

async function handlePost(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  if (!canPostDocument(identity)) {
    await interaction.editReply("Недостаточно прав: нужна фракция или уровень администратора.");
    return;
  }

  const factionCode = await requireActiveFaction(interaction.options.getString("фракция", true));
  const number = interaction.options.getString("номер", true);
  const description = interaction.options.getString("описание", true);
  const notifiedPerson = interaction.options.getString("уведомляемое_лицо", true);
  const forumLink = interaction.options.getString("ссылка_на_форум", true);
  const leaderText = interaction.options.getString("ответственный_лидер", true);
  const deputyText = interaction.options.getString("ответственный_зам", true);
  const subject = description.slice(0, 256);

  const doc = await createDocument(
    {
      number,
      factionCode,
      authorDiscordId: interaction.user.id,
      subject,
      content: description,
      notifiedPerson,
      forumLink,
      leaderText,
      deputyText,
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
  const personalFile = interaction.options.getString("личное_дело", true);
  const video = interaction.options.getString("видеофиксация", true);
  const content = interaction.options.getString("комментарий", true);

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
      personalFile,
      video,
      content,
    },
    auditFromInteraction(interaction),
  );
  const sourceGuildDiscordId = interaction.guildId;
  await enqueueDocumentResponseSend(result.response.id, result.document.id, {
    sourceGuildDiscordId,
  });
  // Legacy dual delivery: GOV documents + documents of the guild where /ответ was used.
  const govTarget = await resolveDocumentResponseDelivery();
  const localTarget = await resolveDocumentResponseLocalDelivery(sourceGuildDiscordId);
  const lines = [`Ответ на **${result.document.number}** сохранён.`];
  lines.push(`GOV: ${deliveryDeferredMessage(govTarget)}`);
  if (localTarget.kind !== "unconfigured" && !sameDeliveryChannel(govTarget, localTarget)) {
    lines.push(`Фракция (сервер команды): ${deliveryDeferredMessage(localTarget)}`);
  } else if (localTarget.kind === "unconfigured" && sourceGuildDiscordId) {
    lines.push(localTarget.reason);
  }
  await interaction.editReply(lines.join("\n"));
}

async function handleWantedCreate(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = await loadIdentity(interaction.user.id, ctx);
  const wantedDenied = await assertWantedCommandAllowed(interaction, identity);
  if (wantedDenied) {
    await interaction.editReply(wantedDenied);
    return;
  }

  const wanted = await createWanted(
    {
      number: interaction.options.getString("номер", true),
      characterName: interaction.options.getString("фио", true),
      staticId: interaction.options.getString("паспорт", true),
      reason: interaction.options.getString("статья", true),
      termText: interaction.options.getString("срок", true),
      forumLink: interaction.options.getString("ссылка_на_форум", true),
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
  const wantedDenied = await assertWantedCommandAllowed(interaction, identity);
  if (wantedDenied) {
    await interaction.editReply(wantedDenied);
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

  const factionCode = await requireActiveFaction(interaction.options.getString("фракция", true));

  const fine = await createFine(
    {
      number: interaction.options.getString("номер", true),
      characterName: interaction.options.getString("фио", true),
      staticId: interaction.options.getString("паспорт", true),
      reason: interaction.options.getString("статья", true),
      amount: interaction.options.getInteger("сумма", true),
      paymentDeadlineText: interaction.options.getString("срок_оплаты", true),
      issuedByDiscordId: interaction.user.id,
      factionCode,
    },
    auditFromInteraction(interaction),
  );
  await enqueueFinePublish(fine.id);
  const target = await resolveFineDelivery(factionCode);
  await interaction.editReply(
    `Штраф **${fine.number}** на ${formatMoney(fine.amount)} создан.\n${deliveryDeferredMessage(target)}`,
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
  const target = await resolveFinePaidDelivery();
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
  const fromRank = interaction.options.getInteger("с_ранга");
  const toRank = interaction.options.getInteger("на_ранг");

  const factionRaw = interaction.options.getString("фракция") ?? primaryFactionCode(identity);
  if (!factionRaw) {
    await interaction.editReply(
      "Укажите фракцию (параметр «фракция») или получите фракционную роль.",
    );
    return;
  }
  const factionCode = await requireActiveFaction(factionRaw);
  if (!canPersonnel(identity, factionCode)) {
    await interaction.editReply("Недостаточно прав: лидер/зам фракции или администратор.");
    return;
  }

  if (type === "promotion" && (fromRank == null || toRank == null)) {
    await interaction.editReply("Для типа «Повышение» укажите «с_ранга» и «на_ранг».");
    return;
  }

  let details: Record<string, unknown>;
  try {
    details = buildPersonnelDetails(type, detailsRaw, { fromRank, toRank });
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
