# Mirror · GTA5RP

Discord-бот и веб-дашборд для государственных фракций сервера GTA5RP: документы, розыск, штрафы, нашивки, регистрации транспорта и униформы, переводы между фракциями, кадровый аудит, IC чёрный список, формы и обращения.

| Документ | О чём |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | что система делает и что осталось сделать (раздел 16) |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | как система устроена: база, очередь, бот, дашборд, права, тесты |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | установка на сервер, домен, обновление, резервные копии |
| [docs/DEVLOG.md](docs/DEVLOG.md) | журнал разработки и принятых решений |

## Состав

```text
apps/bot          Discord-бот (discord.js)
apps/dashboard    дашборд и API (Next.js)
packages/core     доменная логика, аудит, настройки, очередь задач
packages/db       схема базы и миграции (Prisma, PostgreSQL)
deploy            установка, обновление, домен, резервные копии
```

## Запуск для разработки

Нужны Node.js 22.9+, pnpm 11+ и Docker.

```bash
cp .env.example .env            # вписать DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
docker compose up -d            # PostgreSQL :5432, хранилище файлов :9000, резервные копии
pnpm install
pnpm db:generate
pnpm db:deploy                  # миграции
pnpm build
pnpm db:seed                    # фракции, настройки по умолчанию, главные администраторы
pnpm bot:start                  # бот
pnpm dashboard:dev              # http://localhost:3000
```

В Discord Developer Portal: включить **Server Members Intent** у бота и добавить в OAuth2 → Redirects адрес `http://localhost:3000/api/auth/callback/discord`.

Всё, кроме секретов и адреса сайта, настраивается в дашборде: серверы, роли, каналы, сроки. Идентификаторов Discord в коде и в `.env` нет.

## Проверки

```bash
docker compose -f docker-compose.test.yml up -d   # тестовая база :55432
pnpm check                                        # типы
pnpm lint                                         # ESLint
pnpm test                                         # тесты (нужна тестовая база)
```

## Сервер

```bash
sudo bash deploy/setup.sh       # первая установка
sudo bash deploy/update.sh      # обновление одной командой
```

Подробности, привязка домена и восстановление из копии — в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
