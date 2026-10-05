/**
 * Bot slash commands: registration and builder helpers.
 *
 * Commands are registered globally on ready.
 * All user-visible strings are in Russian (МСК context).
 * Field names match the legacy Python bot where applicable.
 */
import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from "discord.js";

type SlashBuilder = SlashCommandBuilder | ReturnType<SlashCommandBuilder["addStringOption"]>;

function factionOption<T extends SlashBuilder>(
  builder: T,
  opts: { required: boolean; description: string },
) {
  return builder.addStringOption((o) =>
    o
      .setName("фракция")
      .setDescription(opts.description)
      .setRequired(opts.required)
      .setAutocomplete(true)
      .setMaxLength(32),
  );
}

// ──────────────────────────────────────────────────────────────
// /пост  – отправить документ во фракцию
// ──────────────────────────────────────────────────────────────

export const postCommand = factionOption(
  new SlashCommandBuilder().setName("пост").setDescription("Опубликовать документ"),
  { required: true, description: "Фракция-получатель" },
)
  .addStringOption((o) =>
    o
      .setName("номер")
      .setDescription("Номер документа, например LSPD-042")
      .setRequired(true)
      .setMaxLength(64),
  )
  .addStringOption((o) =>
    o.setName("описание").setDescription("Краткое описание документа").setRequired(true).setMaxLength(3900),
  )
  .addStringOption((o) =>
    o
      .setName("уведомляемое_лицо")
      .setDescription("Уведомляемое лицо")
      .setRequired(true)
      .setMaxLength(256),
  )
  .addStringOption((o) =>
    o
      .setName("ссылка_на_форум")
      .setDescription("Ссылка на форум")
      .setRequired(true)
      .setMaxLength(1000),
  )
  .addStringOption((o) =>
    o
      .setName("ответственный_лидер")
      .setDescription("Ответственный лидер")
      .setRequired(true)
      .setMaxLength(256),
  )
  .addStringOption((o) =>
    o
      .setName("ответственный_зам")
      .setDescription("Ответственный зам")
      .setRequired(true)
      .setMaxLength(256),
  );

// ──────────────────────────────────────────────────────────────
// /ответ  – ответить на документ
// ──────────────────────────────────────────────────────────────

export const replyCommand = new SlashCommandBuilder()
  .setName("ответ")
  .setDescription("Ответить на документ")
  .addStringOption((o) =>
    o.setName("номер").setDescription("Номер документа, например LSPD-042").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("личное_дело").setDescription("Личное дело").setRequired(true).setMaxLength(1000),
  )
  .addStringOption((o) =>
    o.setName("видеофиксация").setDescription("Видеофиксация").setRequired(true).setMaxLength(1000),
  )
  .addStringOption((o) =>
    o.setName("комментарий").setDescription("Комментарий").setRequired(true).setMaxLength(3900),
  );

// ──────────────────────────────────────────────────────────────
// /объявить-розыск
// ──────────────────────────────────────────────────────────────

export const wantedCommand = new SlashCommandBuilder()
  .setName("объявить-розыск")
  .setDescription("Объявить федеральный розыск")
  .addStringOption((o) =>
    o
      .setName("номер")
      .setDescription("Номер розыска, например W-042")
      .setRequired(true)
      .setMaxLength(64),
  )
  .addStringOption((o) =>
    o.setName("фио").setDescription("ФИО разыскиваемого").setRequired(true).setMaxLength(128),
  )
  .addStringOption((o) =>
    o.setName("паспорт").setDescription("Номер паспорта / статик").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) =>
    o.setName("статья").setDescription("Обвинения / статья").setRequired(true).setMaxLength(1000),
  )
  .addStringOption((o) =>
    o.setName("срок").setDescription("Срок заключения").setRequired(true).setMaxLength(256),
  )
  .addStringOption((o) =>
    o
      .setName("ссылка_на_форум")
      .setDescription("Ссылка на форум")
      .setRequired(true)
      .setMaxLength(1000),
  );

// ──────────────────────────────────────────────────────────────
// /розыск-исполнено
// ──────────────────────────────────────────────────────────────

export const wantedCloseCommand = new SlashCommandBuilder()
  .setName("розыск-исполнено")
  .setDescription("Закрыть розыск — отметить как исполненный")
  .addStringOption((o) =>
    o.setName("номер").setDescription("Номер розыска, например W-042").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("доказательства")
      .setDescription("Ссылка или описание доказательств")
      .setRequired(true)
      .setMaxLength(1000),
  );

// ──────────────────────────────────────────────────────────────
// /штраф
// ──────────────────────────────────────────────────────────────

export const fineCommand = factionOption(
  new SlashCommandBuilder().setName("штраф").setDescription("Выписать штраф"),
  { required: true, description: "Уведомляемая фракция" },
)
  .addStringOption((o) =>
    o
      .setName("номер")
      .setDescription("Номер штрафа, например F-042")
      .setRequired(true)
      .setMaxLength(64),
  )
  .addStringOption((o) =>
    o.setName("фио").setDescription("ФИО гражданина").setRequired(true).setMaxLength(128),
  )
  .addStringOption((o) =>
    o.setName("паспорт").setDescription("Номер паспорта / статик").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) =>
    o.setName("статья").setDescription("Статья / основание").setRequired(true).setMaxLength(1000),
  )
  .addIntegerOption((o) =>
    o.setName("сумма").setDescription("Сумма штрафа в долларах (целое число > 0)").setRequired(true).setMinValue(1),
  )
  .addStringOption((o) =>
    o
      .setName("срок_оплаты")
      .setDescription("Срок оплаты: 1m, 24h или 14d")
      .setRequired(true)
      .setMaxLength(32),
  );

// ──────────────────────────────────────────────────────────────
// /штраф-оплачено
// ──────────────────────────────────────────────────────────────

export const finePaidCommand = new SlashCommandBuilder()
  .setName("штраф-оплачено")
  .setDescription("Отметить штраф как оплаченный")
  .addStringOption((o) =>
    o.setName("номер").setDescription("Номер штрафа, например F-042").setRequired(true),
  );

// ──────────────────────────────────────────────────────────────
// /кадровый-аудит
// ──────────────────────────────────────────────────────────────

export const personnelCommand = factionOption(
  new SlashCommandBuilder()
    .setName("кадровый-аудит")
    .setDescription("Зафиксировать кадровое событие фракции")
    .addStringOption((o) =>
      o
        .setName("тип")
        .setDescription("Тип события")
        .setRequired(true)
        .addChoices(
          { name: "Повышение", value: "promotion" },
          { name: "Увольнение", value: "dismissal" },
          { name: "Перевод по отделу", value: "transfer" },
          { name: "Восстановление", value: "reinstatement" },
          { name: "Назначение", value: "appointment" },
        ),
    )
    .addUserOption((o) =>
      o.setName("сотрудник").setDescription("Сотрудник, которого касается событие").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("с_ранга")
        .setDescription("Текущий ранг (для типа Повышение)")
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addIntegerOption((o) =>
      o
        .setName("на_ранг")
        .setDescription("Новый ранг (для типа Повышение)")
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addStringOption((o) =>
      o
        .setName("детали")
        .setDescription("Причина / детали (для Повышения — комментарий; иначе по типу)")
        .setMaxLength(500),
    ),
  { required: false, description: "Код фракции (если не из вашей роли)" },
);

export const tokenCommand = new SlashCommandBuilder()
  .setName("нашивка")
  .setDescription("Управление номерами нашивок")
  .addSubcommand((sub) =>
    sub
      .setName("получить")
      .setDescription("Получить нашивку по статику (персонаж создаётся при необходимости)")
      .addStringOption((o) =>
        o.setName("статик").setDescription("Статик — единственное поле; персонаж создаётся автоматически").setRequired(true).setMaxLength(32),
      ),
  )
  .addSubcommand((sub) => sub.setName("список").setDescription("Показать все ваши нашивки и даты получения"))
  .addSubcommand((sub) =>
    sub
      .setName("найти")
      .setDescription("Найти владельца нашивки (ОГП/Юстиция/админы)")
      .addStringOption((o) =>
        o.setName("запрос").setDescription("Номер нашивки, Discord ID или статик").setRequired(true).setMaxLength(64),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("снять")
      .setDescription("Отозвать номер нашивки (только администратор)")
      .addStringOption((o) => o.setName("номер").setDescription("Номер нашивки").setRequired(true).setMaxLength(16)),
  );

export const vehicleRegistrationCommand = new SlashCommandBuilder()
  .setName("регистрация-тс")
  .setDescription("Подать заявку на регистрацию транспортного средства")
  .addStringOption((o) => o.setName("статик").setDescription("Статик (данные заявки, без привязки к нашивке)").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("модель").setDescription("Название модели ТС").setRequired(true).setMaxLength(128))
  .addStringOption((o) => o.setName("госномер").setDescription("Государственный номер").setRequired(true).setMaxLength(16))
  .addAttachmentOption((o) => o.setName("фото").setDescription("Фото ТС (изображение до 10 МБ)").setRequired(true));

export const uniformRegistrationCommand = new SlashCommandBuilder()
  .setName("регистрация-формы")
  .setDescription("Подать заявку на регистрацию униформы")
  .addStringOption((o) => o.setName("статик").setDescription("Статик (данные заявки, без привязки к нашивке)").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("описание").setDescription("Описание комплекта униформы").setRequired(true).setMaxLength(1000))
  .addAttachmentOption((o) => o.setName("фото").setDescription("Фото униформы (изображение до 10 МБ)").setRequired(true));

function transferFactionOption<T extends SlashBuilder>(
  builder: T,
  name: "из" | "в",
  description: string,
) {
  // Same autocomplete wiring as factionOption («фракция»): ACTIVE factions from DB.
  return builder.addStringOption((o) =>
    o.setName(name).setDescription(description).setRequired(true).setAutocomplete(true).setMaxLength(32),
  );
}

export const transferCommand = transferFactionOption(
  transferFactionOption(
    new SlashCommandBuilder()
      .setName("перевод-фракции")
      .setDescription("Подать заявку на перевод между фракциями")
      .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32)),
    "из",
    "Текущая фракция",
  ),
  "в",
  "Принимающая фракция",
)
  .addIntegerOption((o) => o.setName("с_ранга").setDescription("Текущий ранг").setRequired(true).setMinValue(0).setMaxValue(100))
  .addIntegerOption((o) => o.setName("на_ранг").setDescription("Новый ранг (по таблице переводов)").setRequired(true).setMinValue(0).setMaxValue(100))
  .addAttachmentOption((o) => o.setName("документы").setDescription("Фото документов (изображение до 10 МБ)").setRequired(true));

export const webhookRequestCommand = new SlashCommandBuilder()
  .setName("создать-вебхук")
  .setDescription("Запросить вебхук для будущей формы")
  .addChannelOption((o) => o.setName("канал").setDescription("Канал для вебхука").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
  .addStringOption((o) => o.setName("описание").setDescription("Для чего нужна форма").setRequired(true).setMaxLength(2000));

export const vehicleRequestCommand = new SlashCommandBuilder()
  .setName("запрос-тс")
  .setDescription("Попросить администрацию заспавнить транспорт")
  .addStringOption((o) => o.setName("причина").setDescription("Зачем нужен транспорт").setRequired(true).setMaxLength(500))
  .addStringOption((o) =>
    o.setName("модель").setDescription("Модель: начните вводить название").setRequired(true).setAutocomplete(true).setMaxLength(40),
  )
  .addStringOption((o) =>
    o.setName("время").setDescription("Когда нужен транспорт, например «сегодня 20:00 МСК»").setRequired(true).setMaxLength(100),
  );

export const blacklistAddCommand = new SlashCommandBuilder()
  .setName("чс-гос")
  .setDescription("Добавить гражданина в IC чёрный список правительства штата")
  .addStringOption((o) => o.setName("фио").setDescription("Имя Фамилия").setRequired(true).setMaxLength(128))
  .addStringOption((o) =>
    o.setName("паспорт").setDescription("Номер паспорта").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) => o.setName("причина").setDescription("Причина").setRequired(true).setMaxLength(2000))
  .addStringOption((o) =>
    o
      .setName("ссылка_на_форум")
      .setDescription("Доказательства — ссылка на форум")
      .setRequired(true)
      .setMaxLength(1000),
  );

export const blacklistRemoveCommand = new SlashCommandBuilder()
  .setName("снятие-чс-гос")
  .setDescription("Снять запись с IC чёрного списка по номеру")
  .addStringOption((o) =>
    o.setName("номер").setDescription("Номер записи ЧС, например BL-001").setRequired(true).setMaxLength(64),
  )
  .addStringOption((o) =>
    o.setName("причина").setDescription("Причина снятия").setRequired(true).setMaxLength(2000),
  );

export const blacklistFindCommand = new SlashCommandBuilder()
  .setName("чс-найти")
  .setDescription("Найти гражданина в IC чёрном списке по паспорту")
  .addStringOption((o) =>
    o.setName("паспорт").setDescription("Номер паспорта / статик").setRequired(true).setMaxLength(32),
  );

export const checkFactionsCommand = new SlashCommandBuilder()
  .setName("проверить-фракции")
  .setDescription("Показать пересечения состава между фракциями (админ)");

export const adminInviteCommand = new SlashCommandBuilder()
  .setName("инвайт-админ")
  .setDescription("Создать временный инвайт на сервер из списка дашборда")
  .addStringOption((o) =>
    o.setName("сервер").setDescription("Сервер из списка invites.guildIds").setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((o) =>
    o.setName("срок_минут").setDescription("Срок жизни инвайта в минутах (по умолчанию из настроек)").setMinValue(1).setMaxValue(10080),
  )
  .addIntegerOption((o) =>
    o.setName("использований").setDescription("Максимум использований").setMinValue(1).setMaxValue(100),
  );

// ──────────────────────────────────────────────────────────────
// Collect all commands for registration
// ──────────────────────────────────────────────────────────────

/** One's own card: characters, unpaid fines, wanted orders, registrations. */
export const profileCommand = new SlashCommandBuilder()
  .setName("профиль")
  .setDescription("Ваши персонажи, штрафы, розыск и регистрации");

/** Right click on a member → «Приложения» → «Досье»: the same card about that member. */
export const dossierCommand = new ContextMenuCommandBuilder().setName("Досье").setType(ApplicationCommandType.User);

export const ALL_COMMANDS: Array<
  RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody
> = [
  postCommand.toJSON(),
  replyCommand.toJSON(),
  wantedCommand.toJSON(),
  wantedCloseCommand.toJSON(),
  fineCommand.toJSON(),
  finePaidCommand.toJSON(),
  personnelCommand.toJSON(),
  tokenCommand.toJSON(),
  vehicleRegistrationCommand.toJSON(),
  uniformRegistrationCommand.toJSON(),
  transferCommand.toJSON(),
  webhookRequestCommand.toJSON(),
  vehicleRequestCommand.toJSON(),
  blacklistAddCommand.toJSON(),
  blacklistRemoveCommand.toJSON(),
  blacklistFindCommand.toJSON(),
  checkFactionsCommand.toJSON(),
  adminInviteCommand.toJSON(),
  profileCommand.toJSON(),
  dossierCommand.toJSON(),
];

// ──────────────────────────────────────────────────────────────
// Registration helper
// ──────────────────────────────────────────────────────────────

export async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: ALL_COMMANDS });
}
