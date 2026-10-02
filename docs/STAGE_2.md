# Mirror: дашборд-основа (этап 2)

Статус: **этап 2 закрыт** (2026-10-03) после правок по ревью: доступ к системным настройкам только у главного админа, CI без Discord-секретов, безопасный `next`, атомарные guild settings.

## 1. Что сделано

- Next.js App Router в `apps/dashboard` (порт 3000);
- Discord OAuth через Auth.js (`next-auth` v5), JWT-сессии;
- после входа: upsert `User`, `resolveIdentity`, блокировка не-суперадминов пока не выбран главный сервер;
- системные настройки (главный / ЧП, привязки ролей) — только `SUPER_ADMIN` (как в PLAN: старший без системных настроек); `ADMIN_LEVEL=SUPER_ADMIN` маппинги тоже только главному;
- профиль: аватар, статус-бейдж, список серверов из снимка;
- юридические страницы `/terms`, `/privacy`, `/cookies` и баннер cookie;
- единая тёмная тема (glass + оранжевый акцент), Outfit/Manrope, Framer Motion; без переключателя тем и без пресетов светлых тем;
- заготовки: колокольчик уведомлений, Ctrl+K по разделам навигации.

## 2. Переменные окружения дашборда

Схема `dashboardEnvSchema` в `packages/core/src/env.ts`:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth-приложение Discord |
| `OAUTH_REDIRECT_URL` | `http://localhost:3000/api/auth/callback/discord` |
| `SESSION_SECRET` | подпись JWT (мин. 16 символов) |
| `SUPER_ADMIN_USER_IDS` | bootstrap главных админов |

В Discord Developer Portal должен быть тот же redirect URL. `AUTH_SECRET` / `AUTH_URL` выставляются из этих переменных при старте.

## 3. Права (этап 2)

| Действие | Кто |
|---|---|
| Вход при незаданном главном сервере | только `SUPER_ADMIN_USER_IDS` |
| Обзор / профиль | любой вошедший |
| `/settings/*`, API guilds и role-mappings | только `SUPER_ADMIN` |

Старший админ, обычные админы и хелперы системные настройки не меняют (как в PLAN).

## 4. Привязки ролей

У `role_mappings` есть `status`. Удаление из UI архивирует запись (`ARCHIVED`), физически строки не стираются. `resolveIdentity` учитывает только `ACTIVE`.

## 5. Запуск локально

```powershell
Copy-Item .env.example .env   # если ещё нет; вписать CLIENT_ID/SECRET, SESSION_SECRET
# OAUTH_REDIRECT_URL=http://localhost:3000/api/auth/callback/discord
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm build
pnpm db:seed
pnpm bot:start                # снимок серверов для списков в настройках
pnpm dashboard:dev            # http://localhost:3000
```

## 6. Сознательно отложено

- полноценный глобальный поиск по статикам / нашивкам / документам;
- хранение Discord banner в БД и вкладки профиля (персонажи, штрафы…);
- редактируемые юридические тексты из дашборда;
- матрица прав в UI, уведомления в личку Discord;
- Tailwind / shadcn (сейчас своя CSS-система токенов).
