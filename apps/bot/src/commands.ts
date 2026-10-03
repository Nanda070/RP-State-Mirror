/**
 * Bot slash commands: registration and builder helpers.
 *
 * Commands are registered globally on ready.
 * All user-visible strings are in Russian (МСК context).
 * Field names match the legacy Python bot where applicable.
 */
import {
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
    o.setName("фио").setDescription("ФИО гражданина").setRequired(true).setMaxLength(128),
  )
  .addStringOption((o) =>
    o.setName("паспорт").setDescription("Номер паспорта / статик").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) =>
    o.setName("статья").setDescription("Статья / основание").setRequired(true).setMaxLength(1000),
  )
  .addIntegerOption((o) =>
    o.setName("сумма").setDescription("Сумма штрафа (целое число > 0)").setRequired(true).setMinValue(1),
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
    .addStringOption((o) =>
      o.setName("детали").setDescription("Детали события (JSON или произвольный текст)").setMaxLength(500),
    ),
  { required: false, description: "Код фракции (если не из вашей роли)" },
);

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
];

// ──────────────────────────────────────────────────────────────
// Registration helper
// ──────────────────────────────────────────────────────────────

export async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: ALL_COMMANDS });
}
