# Mirror: этап 3 — базовые модули бота

Статус: **✅ закрыт** (2026-10-03).

## Цель этапа

1. Embed-менеджер и движок кнопок (фундамент для всех исходящих сообщений).
2. Документы — **только отправка и реестр**, без шаблонов и генерации.
3. Розыск, штрафы, кадровый аудит.
4. Синхронизация ЧП (`cp.syncEnabled`) и заготовки утилит (slash утилит — этап 4/полировка).
5. Разделы в дашборде под каждый модуль (свои страницы настроек/реестров).

## Критерии закрытия

| Критерий | Статус |
|---|---|
| Embed manager: create/edit Classic + V2, preview, save, list, archive | ✅ |
| Send / resend через jobs в выбранный guild/channel (из снимка) | ✅ |
| Button engine: `button_actions`, `mirror:<action>:<id>`, role.toggle / callback | ✅ |
| `/settings/embeds` и `/settings/buttons` раздельно готовы (не stub) | ✅ |
| UI каналов/вебхуков фракций + wanted/fines channel pickers | ✅ |
| ЧП sync по `cp.syncEnabled`, исключения, аудит | ✅ |
| Реестр персонала | ✅ |
| Токены / регистрации / персонажи | «скоро» (этап 4) |

## Что есть

| Слой | Содержимое |
|---|---|
| Prisma | модули Stage 3 + `discord_channels` + legacy-поля |
| Core | documents, wanted, fines, personnel, embeds, message-designs, delivery, cp-sync, factions delivery |
| Settings | `documents.*`, `fines.*`, `wanted.*`, `cp.syncEnabled`, `cp.excludedRoleIds`, `cp.logChannelId` |
| Bot | 7 slash; jobs доставки модулей + message_design.send/resend; buttons; channel sync; CP reconcile |
| Dashboard | реестры documents/wanted/fines/personnel; настройки модулей, фракций, эмбедов, кнопок, ЧП |

Номера документов, розысков и штрафов задаёт пользователь (`номер` в `/пост`, `/объявить-розыск`, `/штраф`); уникальность проверяется в аудируемой транзакции.

Доставка документов: `/пост` → канал/вебхук документов целевой фракции; `/ответ` → канал/вебхук документов **GOV** (legacy `RESPONSE_WEBHOOK`) с пингом автора `/пост`.

Доставка в Discord идёт через очередь jobs. Если канал/вебхук ещё не настроен — запись в БД сохраняется, ephemeral-ответ сообщает об отложенной отправке; job завершается как `deferred` без ретраев.

## Конфиг доставки (без хардкода ID)

- Фракция: сервер + `documentsChannelId` / `personnelChannelId` (+ опциональные webhook URL) в дашборде `/settings/factions`.
- Система: `wanted.channelId` + `fines.channelId` на сервере ЧП; pickers из синхронизированных каналов.
- Каналы синхронизируются ботом в `discord_channels` (text / announcement).

## Синхронизация ЧП

- Источник: роли `FACTION_MEMBER` / `LEADER` / `DEPUTY` на серверах фракций.
- Цель: роли `FACTION_MEMBER` на сервере ЧП (по той же фракции).
- Без фракционных ролей — kick с ЧП (кроме `cp.excludedRoleIds`).
- Гейт: `cp.syncEnabled`. События join/update/remove + hourly reconcile. Аудит `cp.roles_updated` / `cp.member_kicked`.

## Документы — границы модуля

- Входит: отправка документа во фракцию, ответ, реестр, TTL/`EXPIRED`.
- Не входит: шаблоны документов, генерация текстов, конструктор бланков.

## Не входит в этап 3 (этап 4+)

- Токены, регистрации ТС/униформы, персонажи.
- Slash-утилиты `/проверить-фракции`, `/инвайт-админ`.
- Полный V2-редактор дерева (секции, файлы, select-меню) — базовый container+text+buttons есть.
