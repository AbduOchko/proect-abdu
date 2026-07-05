# 🛒 Маркет цифровых товаров — Telegram Mini App

Телеграм-бот с Mini App: маркетплейс цифровых товаров (каналы, боты, скрипты, чаты, коды и др.).
После команды `/start` бот присылает сообщение с инлайн-кнопкой, открывающей приложение.

## ✨ Возможности

**Mini App — 5 главных разделов:**
- 🛍 **Каталог** — товары продавцов (поиск, категории, сортировка, создание объявлений)
- 📊 **Биржа** — заявки покупателей «хочу купить»
- 💬 **Чаты** — встроенный мессенджер между покупателями и продавцами
- 🤝 **Сделки** — история покупок/продаж с жизненным циклом (ожидание → оплачено → завершена, отмена, спор, оценка продавца)
- 👤 **Профиль** — данные пользователя, рейтинг, «О себе», мои товары и заявки

**Бот:**
- `/start` — приветствие + кнопка открытия Mini App
- `/admin` — открывает **админ-панель** (отдельный Web App), доступна **только администраторам** из `ADMIN_IDS`
- `/help` — помощь

**Админ-панель (`/admin`):**
- 📊 Статистика (пользователи, товары, заявки, сделки, оборот)
- 👥 Пользователи — поиск, блокировка/разблокировка
- 🛍 Товары — скрыть/показать/удалить
- 📥 Заявки — удаление
- 🤝 Сделки — просмотр и смена статуса

## 🧱 Стек

- **Backend:** Node.js 20, Express, [grammy](https://grammy.dev) (Telegram Bot API, long polling)
- **БД:** PostgreSQL (`pg`)
- **Frontend:** ванильный JS + [Telegram WebApp SDK](https://core.telegram.org/bots/webapps) (без сборки)
- **Авторизация:** проверка подписи `initData` по HMAC-SHA256 (официальный алгоритм Telegram)

## 📁 Структура

```
src/
  index.js     — запуск Express + бота
  config.js    — переменные окружения, категории
  db.js        — PostgreSQL: схема и запросы
  auth.js      — проверка Telegram initData, middleware
  bot.js       — команды бота (/start, /admin)
  api.js       — REST API (/api/*)
public/
  index.html, css/style.css, js/app.js   — Mini App
  admin/                                  — админ-панель
```

## 🚀 Деплой на Railway

1. Залейте проект на GitHub (уже сделано).
2. На [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → выберите этот репозиторий.
3. Добавьте базу данных: в проекте **+ New → Database → Add PostgreSQL**.
   Railway создаст сервис Postgres со своим постоянным диском и переменной `DATABASE_URL`.
4. В сервисе с кодом (`web`) откройте **Variables** и добавьте ссылку на базу:
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (подставьте фактическое имя сервиса Postgres,
   если оно отличается — Railway подсказывает переменные при вводе `${{`).
5. Там же задайте остальные переменные:
   - `BOT_TOKEN` — токен бота от [@BotFather](https://t.me/BotFather)
   - `ADMIN_IDS` — ваш Telegram ID (узнать: [@userinfobot](https://t.me/userinfobot)); несколько — через запятую
6. Включите публичный домен: **Settings → Networking → Generate Domain**.
   Переменная `WEBAPP_URL` подставится автоматически из `RAILWAY_PUBLIC_DOMAIN`
   (или задайте её вручную = адрес домена, напр. `https://your-app.up.railway.app`).
7. **Важно (сохранность загруженных изображений):** сама база данных теперь переживает
   передеплой автоматически (её диск отдельный от сервиса `web`). Но скриншоты/аватарки
   товаров сохраняются на диск сервиса `web`, который передеплой обнуляет — если это важно,
   подключите **отдельный** Volume к сервису `web` (Settings → Volumes, например в `/data`)
   и задайте `UPLOADS_DIR=/data/uploads`.
8. Дождитесь деплоя. Откройте бота в Telegram → `/start`.

### Настройка бота в @BotFather (по желанию)
- `/setmenubutton` — приложение уже само ставит кнопку меню при старте, но можно задать и вручную.
- `/mybots → Bot Settings → Menu Button` — указать URL Mini App.

## 💻 Локальный запуск

Нужен локальный PostgreSQL (например, `brew install postgresql@16` на Mac, или Docker:
`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).

```bash
npm install
cp .env.example .env      # заполните BOT_TOKEN, ADMIN_IDS и DATABASE_URL
npm start
```

Открыть Mini App вне Telegram (для отладки) можно с dev-авторизацией:
```bash
ALLOW_DEV_AUTH=1 ADMIN_IDS=777000 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm start
# затем http://localhost:3000/?devUserId=777000
#        http://localhost:3000/admin?devUserId=777000
```
> `ALLOW_DEV_AUTH` — **только для локальной разработки**. В проде оставьте `0`.

## 🔐 Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `BOT_TOKEN` | да | Токен бота от @BotFather |
| `ADMIN_IDS` | да | Telegram ID админов через запятую |
| `DATABASE_URL` | да | Строка подключения PostgreSQL (на Railway — `${{Postgres.DATABASE_URL}}`) |
| `WEBAPP_URL` | авто на Railway | Публичный HTTPS-адрес приложения |
| `PORT` | нет | Порт (Railway задаёт сам, локально 3000) |
| `UPLOADS_DIR` | нет | Папка для загруженных изображений (по умолчанию `./data/uploads`) |
| `PGSSL` | нет | `1` — включить SSL для подключения к Postgres (нужно для внешних провайдеров вроде Supabase/Neon; для Railway/локально не требуется) |
| `ALLOW_DEV_AUTH` | нет | `1` — вход без Telegram (только локально!) |
| `SEED_DEMO` | нет | `1` — при старте наполнить **пустую** БД демо-данными |

## 🌱 Демо-данные (20 товаров и 20 объявлений)

Наполнить каталог и биржу тестовыми данными по всем категориям:

```bash
npm run seed            # добавит, только если БД пустая
npm run seed -- --force # добавить принудительно (даже если данные есть)
```

На Railway можно добавить переменную `SEED_DEMO=1` — тогда демо-данные
подставятся автоматически при первом запуске с пустой базой.

## 🔌 REST API (кратко)

Все запросы к `/api/*` требуют заголовок `X-Telegram-Init-Data` (initData из Telegram WebApp).

`GET /api/me` · `PATCH /api/me` · `GET/POST /api/products` · `GET/POST /api/requests` ·
`GET/POST /api/chats` · `GET/POST /api/chats/:id/messages` · `GET/POST/PATCH /api/deals` ·
`GET /api/admin/*` (только для админов).
