/**
 * Bot slash commands: registration and builder helpers.
 *
 * Commands are registered globally on ready.
 * All user-visible strings are in Russian (МСК context).
 * Field names match the legacy Python bot where applicable.
 */
import {
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
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

export const characterCommand = new SlashCommandBuilder()
  .setName("персонаж")
  .setDescription("Управление своими персонажами")
  .addSubcommand((sub) =>
    sub
      .setName("создать")
      .setDescription("Добавить персонажа")
      .addIntegerOption((o) => o.setName("слот").setDescription("Слот от 1 до 3").setRequired(true).setMinValue(1).setMaxValue(3))
      .addStringOption((o) => o.setName("статик").setDescription("Уникальный статик персонажа").setRequired(true).setMaxLength(32))
      .addStringOption((o) => o.setName("имя").setDescription("Имя персонажа").setRequired(true).setMaxLength(128)),
  )
  .addSubcommand((sub) => sub.setName("список").setDescription("Показать своих персонажей"));

export const tokenCommand = new SlashCommandBuilder()
  .setName("token")
  .setDescription("Управление номерами нашивок")
  .addSubcommand((sub) =>
    sub
      .setName("receive")
      .setDescription("Получить номер нашивки для своего персонажа")
      .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("get")
      .setDescription("Показать номер нашивки")
      .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Отозвать номер нашивки (только администратор)")
      .addStringOption((o) => o.setName("номер").setDescription("Номер нашивки").setRequired(true).setMaxLength(16)),
  );

export const vehicleRegistrationCommand = new SlashCommandBuilder()
  .setName("регистрация-тс")
  .setDescription("Подать заявку на регистрацию транспортного средства")
  .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("модель").setDescription("Модель из каталога разрешённых ТС").setRequired(true).setMaxLength(128).setAutocomplete(true))
  .addStringOption((o) => o.setName("госномер").setDescription("Государственный номер").setRequired(true).setMaxLength(16))
  .addAttachmentOption((o) => o.setName("фото").setDescription("Фото ТС (изображение до 10 МБ)").setRequired(true));

export const uniformRegistrationCommand = new SlashCommandBuilder()
  .setName("регистрация-формы")
  .setDescription("Подать заявку на регистрацию униформы")
  .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("описание").setDescription("Описание комплекта униформы").setRequired(true).setMaxLength(1000))
  .addAttachmentOption((o) => o.setName("фото").setDescription("Фото униформы (изображение до 10 МБ)").setRequired(true));

export const transferCommand = new SlashCommandBuilder()
  .setName("перевод-фракции")
  .setDescription("Подать заявку на перевод между фракциями")
  .addStringOption((o) => o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("из").setDescription("Текущая фракция").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("в").setDescription("Принимающая фракция").setRequired(true).setMaxLength(32))
  .addIntegerOption((o) => o.setName("с_ранга").setDescription("Текущий ранг").setRequired(true).setMinValue(0).setMaxValue(100))
  .addIntegerOption((o) => o.setName("на_ранг").setDescription("Новый ранг").setRequired(true).setMinValue(0).setMaxValue(100))
  .addStringOption((o) => o.setName("документы").setDescription("Ссылки на документы через запятую").setMaxLength(2000));

export const webhookRequestCommand = new SlashCommandBuilder()
  .setName("создать-webhook")
  .setDescription("Запросить webhook для будущей формы")
  .addChannelOption((o) => o.setName("канал").setDescription("Канал для webhook").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
  .addStringOption((o) => o.setName("описание").setDescription("Для чего нужна форма").setRequired(true).setMaxLength(2000));

export const blacklistAddCommand = new SlashCommandBuilder()
  .setName("чс-добавить")
  .setDescription("Добавить гражданина в IC чёрный список GOV")
  .addStringOption((o) => o.setName("статик").setDescription("Статик гражданина").setRequired(true).setMaxLength(32))
  .addStringOption((o) => o.setName("фио").setDescription("ФИО").setRequired(true).setMaxLength(128))
  .addStringOption((o) => o.setName("причина").setDescription("Причина").setRequired(true).setMaxLength(2000))
  .addStringOption((o) => o.setName("срок").setDescription("Дата окончания ISO или пусто для бессрочного").setMaxLength(32));

export const blacklistRemoveCommand = new SlashCommandBuilder()
  .setName("чс-снять")
  .setDescription("Снять запись гражданина с IC чёрного списка")
  .addStringOption((o) => o.setName("статик").setDescription("Статик гражданина").setRequired(true).setMaxLength(32));

// ──────────────────────────────────────────────────────────────
// Collect all commands for registration
// ──────────────────────────────────────────────────────────────

export const ALL_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  postCommand.toJSON(),
  replyCommand.toJSON(),
  wantedCommand.toJSON(),
  wantedCloseCommand.toJSON(),
  fineCommand.toJSON(),
  finePaidCommand.toJSON(),
  personnelCommand.toJSON(),
  characterCommand.toJSON(),
  tokenCommand.toJSON(),
  vehicleRegistrationCommand.toJSON(),
  uniformRegistrationCommand.toJSON(),
  transferCommand.toJSON(),
  webhookRequestCommand.toJSON(),
  blacklistAddCommand.toJSON(),
  blacklistRemoveCommand.toJSON(),
];

// ──────────────────────────────────────────────────────────────
// Registration helper
// ──────────────────────────────────────────────────────────────

export async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: ALL_COMMANDS });
}
