# Mirror · GTA5RP

Discord-бот и веб-дашборд для государственных фракций. Проект развивается по плану в [docs/PLAN.md](docs/PLAN.md).

## Текущий статус

Этап 1 закрыт; фундамент этапа 2 (дашборд) готов:
- монорепозиторий, PostgreSQL, Prisma, S3, бот, аудит, очередь, снимок Discord;
- дашборд Next.js: Discord OAuth (Auth.js), профиль, настройки серверов/ролей, темы, юридические страницы.

Подробности этапа 2: [docs/STAGE_2.md](docs/STAGE_2.md). Старый Python-бот временно хранится как справочный слой и не запускается.

## Новый workspace

```text
apps/bot              Discord-бот
apps/dashboard        Next.js dashboard и API
packages/core         общая доменная логика
packages/db           Prisma-схема и клиент
docs/PLAN.md          полный план проекта
docs/TECHNICAL_FOUNDATION.md  технические решения этапа 1
docs/DEVLOG.md        журнал разработки
```

Требования: Node.js 22.9+, pnpm 11+ и Docker с Docker Compose.

```powershell
Copy-Item .env.example .env     # затем вписать DISCORD_BOT_TOKEN и прочие секреты
docker compose up -d            # PostgreSQL :5432, S3 (SeaweedFS) :9000
pnpm install
pnpm db:generate
pnpm db:deploy                  # применить миграции
pnpm build
pnpm db:seed                    # фракции, настройки по умолчанию, суперадмин
pnpm bot:start                  # снимок серверов для настроек дашборда
pnpm dashboard:dev              # http://localhost:3000
```

В Discord Developer Portal:
- включите **Server Members Intent** для бота;
- в OAuth2 → Redirects добавьте `http://localhost:3000/api/auth/callback/discord`;
- в `.env` те же `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` и `OAUTH_REDIRECT_URL` с этим callback.

Проверки и тесты:

```powershell
docker compose -f docker-compose.test.yml up -d   # PostgreSQL :55432, S3 :59000
pnpm lint
pnpm check
pnpm test
```

Все порты слушают только `127.0.0.1`.

Подробные решения этапа описаны в [docs/TECHNICAL_FOUNDATION.md](docs/TECHNICAL_FOUNDATION.md), история разработки ведётся в [docs/DEVLOG.md](docs/DEVLOG.md).

## Legacy Python-код

Разделы ниже описывают старого Python-бота и нужны только для сверки поведения при миграции. Python-файлы не удаляются до завершения всех этапов, переноса команд и финального аудита.

## Что умеет
- `/пост` — отправляет документ в нужную фракцию через её webhook
- `/ответ` — отправляет ответ на документ в отдельный Discord через webhook
- `/объявить-розыск` — публикует розыск в выделенный канал
- `/розыск-исполнено` — закрывает розыск, редактируя исходное сообщение webhook
- SQLite-база для хранения документов и розысков
- автоудаление записей `/пост` через 72 часа

## Структура
- `bot.py` — основной код бота
- `.env.example` — пример конфига
- `requirements.txt` — зависимости

## Установка legacy-бота
1. Установи Python 3.11+.
2. Создай папку проекта и скопируй туда файлы.
3. Создай виртуальное окружение:
   - Windows:
     ```bash
     py -3.11 -m venv .venv
     .venv\Scripts\activate
     ```
4. Установи зависимости:
   ```bash
   pip install -r requirements.txt
   ```
5. Создай `.env` на основе `.env.example`.
6. Вставь туда:
   - токен бота
   - все webhook URL
   - при необходимости `COMMAND_GUILD_IDS`
7. Запусти бота:
   ```bash
   python bot.py
   ```

## Важная настройка
### 1. Список лидеров и замов - Не актуально
Заполни его своими реальными вариантами. Они будут доступны в автодополнении slash-команды.

### 2. Права бота
Боту нужны права:
- Use Application Commands
- Send Messages
- Embed Links

### 3. Добавление бота
При создании бота в Discord Developer Portal включи:
- `applications.commands`
- `bot`

## Что хранится в базе
### Таблица `posts`
Хранит:
- номер документа
- автора документа
- фракцию
- сообщение webhook
- срок жизни 72 часа

### Таблица `wanted`
Хранит:
- номер розыска
- исходное webhook-сообщение
- статус active/closed
- кто закрыл розыск
- доказательства исполнения

## Как это работает
### `/пост`
- проверяет, нет ли уже такого номера
- отправляет embed в webhook нужной фракции
- сохраняет номер и автора в БД на 72 часа

### `/ответ`
- ищет номер документа в БД
- если номер найден, отправляет ответ в отдельный Discord
- тегает автора исходного документа

### `/объявить-розыск`
- работает только в одном указанном канале
- отправляет embed в webhook розыска
- сохраняет `message_id`, чтобы потом отредактировать сообщение

### `/розыск-исполнено`
- ищет розыск в БД
- редактирует исходное сообщение webhook
- перечёркивает старый розыск
- добавляет кто закрыл и доказательства

### `/Синхронизация`
- Проверяет наличие ролей на серверах фракции и обновляет/кикает из/в чп
