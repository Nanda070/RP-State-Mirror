/**
 * Bot slash commands: registration and builder helpers.
 *
 * Commands are registered globally on ready.
 * All user-visible strings are in Russian (МСК context).
 */
import {
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

// ──────────────────────────────────────────────────────────────
// /пост  – отправить документ во фракцию
// ──────────────────────────────────────────────────────────────

export const postCommand = new SlashCommandBuilder()
  .setName("пост")
  .setDescription("Отправить документ в фракцию через её вебхук")
  .addStringOption((o) =>
    o.setName("фракция").setDescription("Код фракции-получателя").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("тема").setDescription("Тема документа").setRequired(true).setMaxLength(256),
  )
  .addStringOption((o) =>
    o.setName("содержание").setDescription("Текст документа").setRequired(true).setMaxLength(3900),
  );

// ──────────────────────────────────────────────────────────────
// /ответ  – ответить на документ
// ──────────────────────────────────────────────────────────────

export const replyCommand = new SlashCommandBuilder()
  .setName("ответ")
  .setDescription("Ответить на документ по его номеру")
  .addStringOption((o) =>
    o.setName("номер").setDescription("Номер документа, например LSPD-042").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("содержание").setDescription("Текст ответа").setRequired(true).setMaxLength(3900),
  );

// ──────────────────────────────────────────────────────────────
// /объявить-розыск
// ──────────────────────────────────────────────────────────────

export const wantedCommand = new SlashCommandBuilder()
  .setName("объявить-розыск")
  .setDescription("Объявить федеральный розыск на гражданина")
  .addStringOption((o) =>
    o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) =>
    o.setName("имя").setDescription("ФИО персонажа").setRequired(true).setMaxLength(128),
  )
  .addStringOption((o) =>
    o.setName("основание").setDescription("Основание для розыска").setRequired(true).setMaxLength(1000),
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
    o.setName("доказательства")
    .setDescription("Ссылка или описание доказательств")
    .setRequired(true)
    .setMaxLength(1000),
  );

// ──────────────────────────────────────────────────────────────
// /штраф
// ──────────────────────────────────────────────────────────────

export const fineCommand = new SlashCommandBuilder()
  .setName("штраф")
  .setDescription("Наложить штраф на гражданина")
  .addStringOption((o) =>
    o.setName("статик").setDescription("Статик персонажа").setRequired(true).setMaxLength(32),
  )
  .addStringOption((o) =>
    o.setName("имя").setDescription("ФИО персонажа").setRequired(true).setMaxLength(128),
  )
  .addIntegerOption((o) =>
    o.setName("сумма").setDescription("Сумма штрафа (целое число > 0)").setRequired(true).setMinValue(1),
  )
  .addStringOption((o) =>
    o.setName("основание").setDescription("Основание штрафа").setRequired(true).setMaxLength(1000),
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

export const personnelCommand = new SlashCommandBuilder()
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
