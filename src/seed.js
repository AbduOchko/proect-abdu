// Демо-данные: 20 товаров и 20 объявлений по всем категориям.
// Запуск вручную:  npm run seed        (только если БД пустая)
//                  npm run seed -- --force   (добавить в любом случае)
// Или автоматически на старте, если задать SEED_DEMO=1 (сидирует пустую БД).
import { fileURLToPath } from 'node:url';
import { pool, ready, upsertUser, createProduct, createRequest, addRating } from './db.js';

// Фейковые пользователи (id в отдельном диапазоне, чтобы не пересекаться с реальными)
const U = [
  { id: 900000001, first_name: 'Артём', username: 'artem_deals' },
  { id: 900000002, first_name: 'Мария', username: 'maria_shop' },
  { id: 900000003, first_name: 'Дмитрий', username: 'dmitry_tg' },
  { id: 900000004, first_name: 'Елена', username: 'elena_media' },
  { id: 900000005, first_name: 'Иван', username: 'ivan_dev' },
  { id: 900000006, first_name: 'Ольга', username: 'olga_smm' },
  { id: 900000007, first_name: 'Никита', username: 'nikita_code' },
  { id: 900000008, first_name: 'Светлана', username: 'sveta_market' },
  { id: 900000009, first_name: 'Павел', username: 'pavel_bots' },
  { id: 900000010, first_name: 'Анна', username: 'anna_channels' },
];
const id = (i) => U[i].id;

const PRODUCTS = [
  // ===== Каналы =====
  { s: 0, category: 'channel', title: 'Крипто-сигналы | Trading Pro', price: 120000, description: 'Авторский канал с торговыми сигналами. Высокая вовлечённость, без ботов. Передача на официальную почту.', genres: ['Крипта', 'Бизнес'], subscribers: 45200, reach24: 16800, avg_age: '25–34' },
  { s: 9, category: 'channel', title: 'Новости 24/7 — СНГ', price: 260000, description: 'Крупный новостной канал. Живая аудитория, стабильный охват, монетизация налажена.', genres: ['Новости', 'Политика'], subscribers: 128000, reach24: 41000, avg_age: '25–44' },
  { s: 3, category: 'channel', title: 'Мемный движ', price: 95000, description: 'Развлекательный канал с мемами. Молодая активная аудитория, много репостов.', genres: ['Юмор'], subscribers: 82000, reach24: 30500, avg_age: '18–24' },
  { s: 5, category: 'channel', title: 'GameZone — игры и гайды', price: 54000, description: 'Игровой канал: новости, гайды, розыгрыши. Вовлечённая аудитория геймеров.', genres: ['Игры', 'Технологии'], subscribers: 31000, reach24: 12000, avg_age: '18–24' },
  { s: 1, category: 'channel', title: 'Бизнес по-русски', price: 70000, description: 'Канал о предпринимательстве и маркетинге. Платёжеспособная аудитория.', genres: ['Бизнес', 'Образование'], subscribers: 26500, reach24: 9800, avg_age: '25–34' },

  // ===== Боты =====
  { s: 8, category: 'bot', title: 'Бот рассылок (Python, исходники)', price: 5000, description: 'Готовый бот массовых рассылок. Исходники на Python + инструкция по запуску.' },
  { s: 8, category: 'bot', title: 'Магазин-бот под ключ', price: 15000, description: 'Телеграм-магазин: каталог, корзина, оплата, админ-панель. Настрою под вас.' },
  { s: 4, category: 'bot', title: 'Бот-квиз с админкой', price: 4000, description: 'Викторина с вопросами, рейтингом и статистикой. Лёгкая кастомизация.' },
  { s: 8, category: 'bot', title: 'Бот автопостинга', price: 6500, description: 'Автопостинг в каналы по расписанию, поддержка медиа и кнопок.' },

  // ===== Скрипты =====
  { s: 6, category: 'script', title: 'Скрипт парсинга аудитории', price: 3500, description: 'Собирает участников из чатов и каналов. Python, экспорт в CSV.' },
  { s: 6, category: 'script', title: 'Userbot на Telethon', price: 8000, description: 'Многофункциональный юзербот: автоответы, инлайн-команды, модули.' },
  { s: 4, category: 'script', title: 'Скрипт автопрогрева аккаунтов', price: 5500, description: 'Имитация активности для новых аккаунтов. Настройка сценариев.' },

  // ===== Чаты =====
  { s: 1, category: 'chat', title: 'Чат-барахолка (5К участников)', price: 12000, description: 'Активный чат объявлений, живые люди, модерация настроена.' },
  { s: 0, category: 'chat', title: 'Приватный чат трейдеров', price: 30000, description: 'Закрытый чат по трейдингу. Платящая аудитория, высокая активность.' },
  { s: 3, category: 'chat', title: 'Чат по недвижимости (8К)', price: 18000, description: 'Тематический чат аренды и продажи. Регион — Москва и МО.' },

  // ===== Коды =====
  { s: 7, category: 'code', title: '1000 промокодов на подписки', price: 9000, description: 'Рабочие промокоды на популярные сервисы. Проверены, с гарантией.' },
  { s: 7, category: 'code', title: 'Ключи активации софта (50 шт)', price: 14000, description: 'Лицензионные ключи. Активация онлайн, замена невалидных.' },
  { s: 2, category: 'code', title: 'Аккаунты с подпиской Premium', price: 2500, description: 'Готовые аккаунты с активной подпиской. Выдача сразу после оплаты.' },

  // ===== Другое =====
  { s: 5, category: 'other', title: 'Готовый лендинг + домен', price: 20000, description: 'Продающий одностраничник, адаптив, подключённый домен и хостинг на год.' },
  { s: 2, category: 'other', title: 'NFT-коллекция (50 работ)', price: 40000, description: 'Авторская коллекция цифрового арта с полными правами.' },
];

const REQUESTS = [
  // Каналы
  { b: 2, category: 'channel', title: 'Куплю крипто-канал от 20К', budget: 100000, description: 'Живая аудитория, без накрутки. Бюджет обсуждаем.' },
  { b: 3, category: 'channel', title: 'Ищу новостной канал СНГ', budget: 200000, description: 'Интересует крупный канал с хорошим охватом.' },
  { b: 5, category: 'channel', title: 'Нужен игровой канал', budget: 50000, description: 'Тематика — игры/киберспорт, аудитория 18–25.' },
  { b: 9, category: 'channel', title: 'Куплю канал по бизнесу', budget: 80000, description: 'Платёжеспособная аудитория, вовлечённость от 8%.' },

  // Боты
  { b: 1, category: 'bot', title: 'Ищу бота для интернет-магазина', budget: 12000, description: 'С корзиной, оплатой и админкой. Готовое решение.' },
  { b: 4, category: 'bot', title: 'Нужен бот массовых рассылок', budget: 6000, description: 'С исходниками, желательно на Python.' },
  { b: 7, category: 'bot', title: 'Куплю бот-квиз с админкой', budget: 4000, description: 'Викторина с рейтингом участников.' },

  // Скрипты
  { b: 6, category: 'script', title: 'Ищу скрипт парсинга Telegram', budget: 4000, description: 'Сбор участников из чатов/каналов, экспорт в файл.' },
  { b: 8, category: 'script', title: 'Нужен userbot на Telethon', budget: 9000, description: 'С модулями автоответов и командами.' },
  { b: 0, category: 'script', title: 'Куплю скрипт автопостинга', budget: 5000, description: 'Постинг по расписанию, поддержка медиа.' },

  // Чаты
  { b: 3, category: 'chat', title: 'Куплю активный чат от 5К', budget: 15000, description: 'Живые участники, любая тематика кроме NSFW.' },
  { b: 1, category: 'chat', title: 'Ищу чат трейдеров', budget: 25000, description: 'Закрытый чат с платящей аудиторией.' },
  { b: 5, category: 'chat', title: 'Нужен чат-барахолка', budget: 10000, description: 'Объявления, желательно по региону.' },

  // Коды
  { b: 7, category: 'code', title: 'Куплю промокоды оптом', budget: 8000, description: 'На подписки популярных сервисов, с гарантией.' },
  { b: 2, category: 'code', title: 'Ищу ключи активации Windows', budget: 12000, description: 'Лицензионные, с возможностью замены.' },
  { b: 4, category: 'code', title: 'Нужны аккаунты с Premium', budget: 3000, description: 'С активной подпиской, выдача сразу.' },

  // Другое
  { b: 0, category: 'other', title: 'Куплю готовый лендинг', budget: 18000, description: 'Продающая страница с доменом и хостингом.' },
  { b: 9, category: 'other', title: 'Ищу NFT-коллекцию', budget: 35000, description: 'Авторский арт с полными правами.' },
  { b: 6, category: 'other', title: 'Нужен сайт-визитка', budget: 15000, description: 'Адаптивный, с формой заявки.' },
  { b: 8, category: 'other', title: 'Куплю Telegram-стикерпак с правами', budget: 5000, description: 'Готовый набор стикеров с передачей прав.' },
];

// Немного рейтингов продавцам, чтобы отображались звёзды
const RATINGS = [
  [0, [5, 5, 4, 5]], [1, [5, 4, 5]], [2, [4, 4, 5]], [3, [5, 5]], [4, [4, 5, 5]],
  [5, [5, 4]], [6, [5, 5, 5]], [7, [4, 5]], [8, [5, 5, 4, 4]], [9, [5, 4, 5]],
];

export async function seedDemo({ force = false } = {}) {
  await ready();
  const { rows } = await pool.query('SELECT COUNT(*)::int n FROM products');
  if (rows[0].n > 0 && !force) {
    console.log('ℹ️  Демо-данные пропущены: в БД уже есть товары (запустите с --force, чтобы добавить принудительно).');
    return { skipped: true };
  }

  // Захардкоженные ID демо-продавцов/покупателей (900000001-900000010) технически попадают
  // в диапазон реальных Telegram id — если кто-то из настоящих пользователей уже успел
  // написать боту /start (это создаёт строку в users ещё до появления товаров), upsertUser
  // молча перезапишет его имя/username демо-данными. Проверяем коллизию заранее.
  const ids = U.map((u) => u.id);
  const collision = await pool.query('SELECT id FROM users WHERE id = ANY($1::bigint[])', [ids]);
  if (collision.rowCount > 0 && !force) {
    console.log(`⚠️  Сидирование отменено: ID демо-пользователей уже заняты в базе (${collision.rows.map((r) => r.id).join(', ')}) — похоже, это не пустая база. Запустите с --force, если это точно демо-окружение.`);
    return { skipped: true, collision: collision.rows.map((r) => r.id) };
  }

  for (const u of U) await upsertUser(u);
  for (const [i, arr] of RATINGS) for (const stars of arr) await addRating(id(i), stars);
  for (const p of PRODUCTS) await createProduct({ seller_id: id(p.s), ...p });
  for (const r of REQUESTS) await createRequest({ buyer_id: id(r.b), ...r });

  console.log(`✅ Демо-данные добавлены: ${PRODUCTS.length} товаров и ${REQUESTS.length} объявлений.`);
  return { products: PRODUCTS.length, requests: REQUESTS.length };
}

// Прямой запуск: node src/seed.js [--force]
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seedDemo({ force: process.argv.includes('--force') })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
