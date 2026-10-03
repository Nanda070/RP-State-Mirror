/**
 * Slash command interaction handlers for Stage 3 modules.
 * Mutations go through core APIs; Discord delivery is enqueued as jobs.
 */
import {
  PermissionFlagsBits,
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
  canFindTokens,
  canManageIcBlacklist,
  canManageModules,
  canSearchIcBlacklist,
  closeWanted,
  createCharacter,
  createRegistration,
  createTransfer,
  createWebhookRequest,
  createIcBlacklistEntry,
  findActiveIcBlacklist,
  findTokens,
  formatTokenDisplay,
  listActiveIcBlacklistForStatics,
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
  updateCharacterStaticId,
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

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
  if (!interaction.member || typeof interaction.member === "string") return [];
  return Array.isArray(interaction.member.roles)
    ? interaction.member.roles
    : [...interaction.member.roles.cache.keys()];
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
  if (focused.name !== "фракция" && focused.name !== "из" && focused.name !== "в") {
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
        await handleCharacter(interaction, ctx);
        break;
      case "token":
        await handleToken(interaction, ctx);
        break;
      case "регистрация-тс":
      case "регистрация-формы":
        await handleRegistration(interaction, ctx);
        break;
      case "перевод-фракции":
        await handleTransfer(interaction, ctx);
        break;
      case "создать-webhook":
        await handleWebhookRequest(interaction, ctx);
        break;
      case "чс-добавить":
      case "чс-снять":
      case "чс-найти":
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

async function handleCharacter(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
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
  if (subcommand === "статик") {
    const identity = await loadIdentity(interaction.user.id, ctx);
    if (!canManageModules(identity)) {
      await interaction.reply(ephemeral("Изменить статик могут только администраторы."));
      return;
    }
    const updated = await updateCharacterStaticId(
      {
        currentStaticId: interaction.options.getString("текущий", true),
        newStaticId: interaction.options.getString("новый", true),
      },
      auditFromInteraction(interaction),
    );
    await interaction.reply(ephemeral(`Статик персонажа **${updated.name}** изменён на **${updated.staticId}**.`));
    return;
  }

  const characters = await listCharacters(user.id);
  const flagged = await listActiveIcBlacklistForStatics(characters.map((c) => c.staticId));
  await interaction.reply(
    ephemeral(
      characters.length === 0
        ? "Персонажей пока нет."
        : characters
            .map((character) => {
              const token = character.tokens[0];
              const bl = flagged.get(character.staticId);
              return [
                `${character.slot}. **${character.name}** · статик ${character.staticId}`,
                token ? `нашивка ${token.number}` : null,
                bl ? "⚠ в IC чёрном списке" : null,
              ]
                .filter(Boolean)
                .join(" · ");
            })
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
  if (subcommand === "find") {
    const identity = await loadIdentity(interaction.user.id, ctx);
    const finderRoleIds = await getSetting("tokens.finderRoleIds");
    const roleIds = interactionRoleIds(interaction);
    if (!canFindTokens(identity, roleIds, finderRoleIds)) {
      await interaction.reply(ephemeral("Поиск нашивок доступен ролям ОГП/Юстиция и администраторам."));
      return;
    }
    const results = await findTokens(interaction.options.getString("запрос", true));
    if (results.length === 0) {
      await interaction.reply(ephemeral("Ничего не найдено."));
      return;
    }
    await interaction.reply(
      ephemeral(
        results
          .map(
            (item) =>
              `**${item.display}**\nПерсонаж: ${item.character.name} · статик ${item.character.staticId}\nВладелец: <@${item.ownerDiscordId}> (\`${item.ownerDiscordId}\`)`,
          )
          .join("\n\n"),
      ),
    );
    return;
  }

  const character = await getCharacterForUser(user.id, interaction.options.getString("статик", true));
  if (!character) {
    await interaction.reply(ephemeral("Персонаж с таким статиком не найден в вашем профиле."));
    return;
  }
  if (subcommand === "get") {
    const token = character.tokens[0];
    await interaction.reply(
      ephemeral(
        token
          ? `Нашивка: **${formatTokenDisplay({
              factionCode: character.factionCode,
              department: character.department,
              number: token.number,
            })}**`
          : "У персонажа ещё нет нашивки.",
      ),
    );
    return;
  }
  const token = await issueToken(character.id, auditFromInteraction(interaction));
  await interaction.reply(
    ephemeral(
      `Выдан номер нашивки: **${formatTokenDisplay({
        factionCode: character.factionCode,
        department: character.department,
        number: token.number,
      })}**.`,
    ),
  );
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

async function handleTransfer(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const character = await getCharacterForUser(user.id, interaction.options.getString("статик", true));
  if (!character) {
    await interaction.editReply("Персонаж с таким статиком не найден в вашем профиле.");
    return;
  }
  const fromFactionCode = await requireActiveFaction(interaction.options.getString("из", true));
  const toFactionCode = await requireActiveFaction(interaction.options.getString("в", true));
  const identity = await loadIdentity(interaction.user.id, ctx);
  const memberOfFrom = identity.factions.some((f) => f.code.toUpperCase() === fromFactionCode);
  if (!memberOfFrom && !canManageModules(identity)) {
    await interaction.editReply(`Вы должны быть участником фракции **${fromFactionCode}**, чтобы подать перевод из неё.`);
    return;
  }
  const photo = await storeImageAttachment(interaction, interaction.options.getAttachment("документы", true), user.id);
  try {
    const transfer = await createTransfer(
      {
        characterId: character.id,
        fromFactionCode,
        toFactionCode,
        fromRank: interaction.options.getInteger("с_ранга", true),
        toRank: interaction.options.getInteger("на_ранг", true),
        documentFileIds: [photo.id],
        createdByDiscordId: interaction.user.id,
      },
      auditFromInteraction(interaction),
    );
    await interaction.editReply(
      `Заявка на перевод **${fromFactionCode} → ${toFactionCode}** создана (\`${transfer.id}\`). Нужно одобрение обеих фракций.`,
    );
  } catch (error) {
    await archiveOrphanMedia(interaction, [photo.id], ctx);
    throw error;
  }
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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channelRef = interaction.options.getChannel("канал", true);
  const description = interaction.options.getString("описание", true);
  const channel = await interaction.client.channels.fetch(channelRef.id);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !("createWebhook" in channel)) {
    await interaction.editReply("Укажите текстовый канал сервера, в котором бот может создать webhook.");
    return;
  }
  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
    await interaction.editReply("У бота нет права **Manage Webhooks** в этом канале.");
    return;
  }

  let created: { id: string; url: string };
  try {
    const webhook = await channel.createWebhook({
      name: "Mirror form",
      reason: `Запрос формы от ${interaction.user.tag}: ${description.slice(0, 200)}`,
    });
    created = { id: webhook.id, url: webhook.url };
  } catch (error) {
    ctx.log.warn({ err: error, channelId: channel.id }, "discord webhook create failed");
    await interaction.editReply("Не удалось создать webhook в Discord. Проверьте права бота и лимит вебхуков канала.");
    return;
  }

  try {
    const request = await createWebhookRequest(
      {
        requesterDiscordId: interaction.user.id,
        guildDiscordId: interaction.guildId,
        channelDiscordId: channel.id,
        description,
        webhookUrl: created.url,
      },
      auditFromInteraction(interaction),
    );

    const notifyChannelId = await getSetting("webhooks.notifyChannelId");
    if (notifyChannelId) {
      try {
        const notify = await interaction.client.channels.fetch(notifyChannelId);
        if (notify?.isTextBased() && !notify.isDMBased() && "send" in notify) {
          await notify.send({
            content: [
              "**Новый запрос формы** — нужно собрать форму в конструкторе.",
              `Заявитель: <@${interaction.user.id}>`,
              `Канал: <#${channel.id}>`,
              `Описание: ${description.slice(0, 500)}`,
              `ID запроса: \`${request.id}\``,
              `Webhook Discord ID: \`${created.id}\` (URL сохранён в системе).`,
            ].join("\n"),
            allowedMentions: { parse: [], users: [interaction.user.id] },
          });
        }
      } catch (error) {
        ctx.log.warn({ err: error, notifyChannelId }, "webhook request admin notify failed");
      }
    }

    await interaction.editReply(
      notifyChannelId
        ? `Webhook создан в <#${channel.id}>, запрос \`${request.id}\` отправлен админам. Форму соберут в дашборде.`
        : `Webhook создан в <#${channel.id}>, запрос \`${request.id}\` сохранён. Настройте \`webhooks.notifyChannelId\`, чтобы админы получали уведомления.`,
    );
  } catch (error) {
    // Best-effort cleanup so a failed DB write does not leave an orphan Discord webhook.
    await interaction.client
      .fetchWebhook(created.id)
      .then((hook) => hook.delete("Откат: не удалось сохранить запрос Mirror"))
      .catch((cleanupError: unknown) =>
        ctx.log.warn({ err: cleanupError, webhookId: created.id }, "failed to delete orphan discord webhook"),
      );
    throw error;
  }
}

async function handleIcBlacklist(interaction: ChatInputCommandInteraction, ctx: SlashHandlerContext) {
  const identity = await loadIdentity(interaction.user.id, ctx);
  const roleIds = interactionRoleIds(interaction);
  const [managerRoleIds, searchRoleIds] = await Promise.all([
    getSetting("icBlacklist.managerRoleIds"),
    getSetting("icBlacklist.searchRoleIds"),
  ]);

  if (interaction.commandName === "чс-найти") {
    if (!canSearchIcBlacklist(identity, roleIds, managerRoleIds, searchRoleIds)) {
      await interaction.reply(ephemeral("Поиск по IC чёрному списку недоступен для вашей роли."));
      return;
    }
    const entry = await findActiveIcBlacklist(interaction.options.getString("статик", true));
    if (!entry) {
      await interaction.reply(ephemeral("Активных записей по этому статику нет."));
      return;
    }
    const until = entry.expiresAt
      ? entry.expiresAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })
      : "бессрочно";
    await interaction.reply(
      ephemeral(
        [
          `**${entry.fullName}** · статик \`${entry.staticId}\``,
          `Причина: ${entry.reason}`,
          `Срок: ${until}`,
          `Добавил: <@${entry.createdByDiscordId}>`,
          entry.evidenceFileIds.length > 0 ? `Доказательства: ${entry.evidenceFileIds.length} файл(ов)` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
    return;
  }

  if (!canManageIcBlacklist(identity, roleIds, managerRoleIds)) {
    await interaction.reply(
      ephemeral("Добавлять и снимать IC чёрный список могут администраторы и роли из настроек дашборда."),
    );
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawExpiresAt = interaction.options.getString("срок");
  const expiresAt = rawExpiresAt ? new Date(rawExpiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Срок должен быть датой ISO.");
  const { user } = await ensureUserByDiscordId(interaction.user.id);
  const evidence = interaction.options.getAttachment("доказательства");
  const evidenceIds: string[] = [];
  if (evidence) {
    evidenceIds.push((await storeImageAttachment(interaction, evidence, user.id)).id);
  }
  try {
    const entry = await createIcBlacklistEntry(
      {
        staticId: interaction.options.getString("статик", true),
        fullName: interaction.options.getString("фио", true),
        reason: interaction.options.getString("причина", true),
        expiresAt,
        createdByDiscordId: interaction.user.id,
        evidenceFileIds: evidenceIds,
      },
      auditFromInteraction(interaction),
    );
    await interaction.editReply(`Гражданин добавлен в IC чёрный список. Запись: \`${entry.id}\`.`);
  } catch (error) {
    await archiveOrphanMedia(interaction, evidenceIds, ctx);
    throw error;
  }
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
