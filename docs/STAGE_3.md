# Mirror: этап 3 — базовые модули бота

Статус: **в работе** (2026-10-03). Slash-обработчики, jobs доставки и реестры дашборда подняты; каналы/вебхуки и полноценный embed UI — дальше.

## Цель этапа

1. Embed-менеджер и движок кнопок (фундамент для всех исходящих сообщений).
2. Документы — **только отправка и реестр**, без шаблонов и генерации.
3. Розыск, штрафы, кадровый аудит.
4. Заготовки синхронизации ЧП и утилит.
5. Разделы в дашборде под каждый модуль (свои страницы настроек/реестров).

## Что уже есть

| Слой | Содержимое |
|---|---|
| Prisma | `message_designs`, `sent_messages`, `button_actions`, `documents`, `document_responses`, `wanteds`, `fines`, `personnel_events`, `sent_message_links` |
| Core | `documents`, `wanted`, `fines`, `personnel`, `embeds`, `message-designs`, `delivery`, `module-jobs` + access gates |
| Settings | `fines.dueDays`, `fines.channelId`, `wanted.enabled`, `wanted.channelId`, `cp.syncEnabled` |
| Bot | slash-команды + handlers: `/пост`, `/ответ`, `/объявить-розыск`, `/розыск-исполнено`, `/штраф`, `/штраф-оплачено`, `/кадровый-аудит` |
| Jobs | `document.send`, `document.response.send`, `wanted.publish`, `wanted.edit_closed`, `fine.publish`, `fine.edit_paid`, `personnel.publish` |
| Dashboard | реестры `/documents`, `/wanted`, `/fines` (canViewModules); stubs настроек модулей |

Номера документов (`LSPD-001`), розысков (`W-001`) и штрафов (`F-001`) выделяются **внутри** аудируемой транзакции.

Доставка в Discord идёт через очередь jobs. Если канал/вебхук ещё не настроен — запись в БД сохраняется, ephemeral-ответ сообщает об отложенной отправке; job завершается как `deferred` без ретраев.

## Документы — границы модуля

- Входит: отправка документа во фракцию, ответ, реестр, TTL/`EXPIRED`.
- Не входит: шаблоны документов, генерация текстов, конструктор бланков.

## Конфиг доставки (без хардкода ID)

- Фракция `settings` JSON: `documentsChannelId`, `personnelChannelId`, опционально webhook URL.
- Система: `wanted.channelId` + `fines.channelId` на сервере ЧП (`core.incidentGuildId`).

## Следующие шаги

1. UI настройки каналов/вебхуков фракций и ЧП.
2. Persist button actions → Discord Components.
3. Синхронизация ЧП по `cp.syncEnabled`.
4. Редактирование/закрытие записей из реестров дашборда.
