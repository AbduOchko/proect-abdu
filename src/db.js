import pg from 'pg';
import { config, isAdminId } from './config.js';

const { Pool } = pg;

// node-postgres возвращает BIGINT как строку (защита от потери точности за пределами
// Number.MAX_SAFE_INTEGER). Telegram id и метки времени в мс всегда далеко в пределах
// безопасного диапазона, а весь код (сравнения id, JSON для клиента) ждёт число —
// как это было с better-sqlite3. Поэтому парсим int8 (OID 20) как обычное число.
pg.types.setTypeParser(20, (val) => parseInt(val, 10));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.pgSsl ? { rejectUnauthorized: false } : false,
});

// Выполняет функцию в одной транзакции на выделенном подключении.
// Внутри fn(client) все запросы должны идти через переданный client, а не через pool.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
class DealError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// ---- Схема ----
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGINT PRIMARY KEY,
      username      TEXT,
      first_name    TEXT,
      last_name     TEXT,
      photo_url     TEXT,
      balance       DOUBLE PRECISION DEFAULT 0,
      rating_sum    INTEGER DEFAULT 0,
      rating_count  INTEGER DEFAULT 0,
      deals_count   INTEGER DEFAULT 0,
      bio           TEXT    DEFAULT '',
      is_admin      INTEGER DEFAULT 0,
      is_banned     INTEGER DEFAULT 0,
      created_at    BIGINT
    );

    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      seller_id    BIGINT  NOT NULL,
      category     TEXT    NOT NULL,
      title        TEXT    NOT NULL,
      description  TEXT    DEFAULT '',
      price        DOUBLE PRECISION DEFAULT 0,
      status       TEXT    DEFAULT 'active',
      views        INTEGER DEFAULT 0,
      created_at   BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category, status);
    CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);

    CREATE TABLE IF NOT EXISTS requests (
      id           SERIAL PRIMARY KEY,
      buyer_id     BIGINT  NOT NULL,
      category     TEXT    NOT NULL,
      title        TEXT    NOT NULL,
      description  TEXT    DEFAULT '',
      budget       DOUBLE PRECISION DEFAULT 0,
      status       TEXT    DEFAULT 'active',
      created_at   BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_requests_cat ON requests(category, status);
    CREATE INDEX IF NOT EXISTS idx_requests_buyer ON requests(buyer_id);

    CREATE TABLE IF NOT EXISTS chats (
      id          SERIAL PRIMARY KEY,
      a_id        BIGINT  NOT NULL,
      b_id        BIGINT  NOT NULL,
      product_id  INTEGER DEFAULT 0,
      last_text   TEXT    DEFAULT '',
      last_at     BIGINT  DEFAULT 0,
      created_at  BIGINT,
      UNIQUE(a_id, b_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          SERIAL PRIMARY KEY,
      chat_id     INTEGER NOT NULL,
      sender_id   BIGINT  NOT NULL,
      text        TEXT    NOT NULL,
      created_at  BIGINT,
      read_at     BIGINT  DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);

    CREATE TABLE IF NOT EXISTS deals (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER,
      title       TEXT,
      category    TEXT,
      buyer_id    BIGINT  NOT NULL,
      seller_id   BIGINT  NOT NULL,
      amount      DOUBLE PRECISION DEFAULT 0,
      status      TEXT    DEFAULT 'pending',
      created_at  BIGINT,
      updated_at  BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_deals_buyer ON deals(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id            SERIAL PRIMARY KEY,
      user_id       BIGINT  NOT NULL,
      type          TEXT    NOT NULL,
      amount        DOUBLE PRECISION NOT NULL,
      balance_after DOUBLE PRECISION NOT NULL,
      deal_id       INTEGER,
      note          TEXT    DEFAULT '',
      created_at    BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);

    CREATE TABLE IF NOT EXISTS withdrawals (
      id           SERIAL PRIMARY KEY,
      user_id      BIGINT  NOT NULL,
      amount       DOUBLE PRECISION NOT NULL,
      status       TEXT    DEFAULT 'pending',
      requisites   TEXT    DEFAULT '',
      created_at   BIGINT,
      processed_at BIGINT  DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, id);

    CREATE TABLE IF NOT EXISTS reviews (
      id          SERIAL PRIMARY KEY,
      deal_id     INTEGER,
      buyer_id    BIGINT  NOT NULL,
      seller_id   BIGINT  NOT NULL,
      product_id  INTEGER DEFAULT 0,
      stars       INTEGER NOT NULL,
      comment     TEXT    NOT NULL,
      created_at  BIGINT,
      UNIQUE(deal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id, id);

    CREATE TABLE IF NOT EXISTS favorites (
      user_id     BIGINT  NOT NULL,
      product_id  INTEGER NOT NULL,
      created_at  BIGINT,
      PRIMARY KEY (user_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_product ON favorites(product_id);
  `);

  // ---- Миграции: добавляем новые колонки, если их нет ----
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS genres TEXT DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS subscribers INTEGER DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS reach24 INTEGER DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_age TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS screenshots TEXT DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS deadline_at BIGINT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_key TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS registered INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS seq_id INTEGER;
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_key ON users(login_key) WHERE login_key != ''`
  );

  // Порядковый номер пользователя (1, 2, 3...) — показывается вместо телеграм-id, который
  // остаётся внутренним первичным ключом (на него ссылаются products/deals/chats и т.д.)
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS users_seq_id_seq`);
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int n FROM users WHERE seq_id IS NULL');
  if (n > 0) {
    await pool.query(`
      UPDATE users SET seq_id = sub.rn FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn FROM users WHERE seq_id IS NULL
      ) sub WHERE users.id = sub.id
    `);
  }
  const { rows: [{ m }] } = await pool.query('SELECT COALESCE(MAX(seq_id), 0)::int m FROM users');
  if (m > 0) await pool.query('SELECT setval($1::regclass, $2)', ['users_seq_id_seq', m]);
  else await pool.query(`SELECT setval('users_seq_id_seq', 1, false)`);
  await pool.query(`ALTER TABLE users ALTER COLUMN seq_id SET DEFAULT nextval('users_seq_id_seq')`);
}

const schemaReady = ensureSchema();
// Экспортируется, чтобы index.js мог дождаться готовности схемы перед стартом сервера.
export function ready() { return schemaReady; }

const now = () => Date.now();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Экранирует спецсимволы LIKE/ILIKE (% и _ — подстановочные знаки, \ — сам символ экранирования)
// в пользовательском поисковом запросе, иначе, например, поиск по "_" вёл бы себя как "любой символ".
const escLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');

// Тайминги сделок (эскроу)
export const DEAL_MS = {
  confirm: 24 * 60 * 60 * 1000, // продавцу на подтверждение
  deliver: 24 * 60 * 60 * 1000, // продавцу на передачу товара
  review: 7 * 24 * 60 * 60 * 1000, // покупателю на проверку -> автозавершение
};

// Разворачивает JSON-поля товара в массивы
function hydrateProduct(p) {
  if (!p) return p;
  try { p.genres = JSON.parse(p.genres || '[]'); } catch { p.genres = []; }
  try { p.screenshots = JSON.parse(p.screenshots || '[]'); } catch { p.screenshots = []; }
  return p;
}

// ================= USERS =================
export async function upsertUser(tg, executor = pool) {
  const id = Number(tg.id);
  const admin = isAdminId(id) ? 1 : 0;
  const existing = await executor.query('SELECT id FROM users WHERE id = $1', [id]);
  if (existing.rowCount > 0) {
    await executor.query(
      `UPDATE users SET username=$1, first_name=$2, last_name=$3, photo_url=$4, is_admin=$5 WHERE id=$6`,
      [tg.username || null, tg.first_name || null, tg.last_name || null, tg.photo_url || null, admin, id]
    );
  } else {
    await executor.query(
      `INSERT INTO users (id, username, first_name, last_name, photo_url, is_admin, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, tg.username || null, tg.first_name || null, tg.last_name || null, tg.photo_url || null, admin, now()]
    );
  }
  return getUser(id, executor);
}

export async function getUser(id, executor = pool) {
  const r = await executor.query('SELECT * FROM users WHERE id = $1', [Number(id)]);
  const u = r.rows[0];
  if (u) {
    u.rating = u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0;
    delete u.password_hash;
    delete u.login_key;
  }
  return u;
}

export async function updateProfile(id, { bio }) {
  await pool.query('UPDATE users SET bio=$1 WHERE id=$2', [bio ?? '', Number(id)]);
  return getUser(id);
}

// ================= РЕГИСТРАЦИЯ (обязательная анкета при первом входе) =================
export async function registerUser(id, { email, phone, login, passwordHash }) {
  const uid = Number(id);
  try {
    await pool.query(
      `UPDATE users SET email=$1, phone=$2, login=$3, login_key=$4, password_hash=$5, registered=1 WHERE id=$6`,
      [email, phone, login, login.toLowerCase(), passwordHash, uid]
    );
  } catch (e) {
    if (e.code === '23505') throw Object.assign(new Error('Этот логин уже занят'), { code: 'login_taken' });
    throw e;
  }
  return getUser(uid);
}

export async function setBanned(id, banned) {
  await pool.query('UPDATE users SET is_banned=$1 WHERE id=$2', [banned ? 1 : 0, Number(id)]);
  return getUser(id);
}

export async function addRating(userId, stars, executor = pool) {
  const s = Math.round(Math.max(1, Math.min(5, Number(stars) || 0)));
  await executor.query(
    'UPDATE users SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id=$2',
    [s, Number(userId)]
  );
}

export async function listUsers({ q = '', limit = 50, offset = 0 } = {}) {
  const like = `%${escLike(q)}%`;
  const r = await pool.query(
    `SELECT * FROM users
     WHERE ($1 = '' OR username ILIKE $2 OR first_name ILIKE $3 OR id::text LIKE $4)
     ORDER BY created_at DESC LIMIT $5 OFFSET $6`,
    [q, like, like, like, limit, offset]
  );
  return r.rows.map((u) => {
    const row = { ...u, rating: u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0 };
    delete row.password_hash;
    delete row.login_key;
    return row;
  });
}

// ================= PRODUCTS =================
export async function createProduct({ seller_id, category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar }) {
  const r = await pool.query(
    `INSERT INTO products (seller_id, category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      Number(seller_id), category, title, description || '', Number(price) || 0,
      JSON.stringify(Array.isArray(genres) ? genres.slice(0, 12) : []),
      Number(subscribers) || 0, Number(reach24) || 0, String(avg_age || '').slice(0, 40),
      JSON.stringify(Array.isArray(screenshots) ? screenshots.slice(0, 8) : []),
      String(avatar || ''),
      now(),
    ]
  );
  return getProduct(r.rows[0].id);
}

const productSelect = `
  SELECT p.*, u.username AS seller_username, u.first_name AS seller_name,
         u.photo_url AS seller_photo, u.login AS seller_login,
         CASE WHEN u.rating_count>0 THEN u.rating_sum::float8/u.rating_count ELSE 0 END AS seller_rating,
         u.rating_count AS seller_review_count,
         u.deals_count AS seller_deals
  FROM products p JOIN users u ON u.id = p.seller_id`;

export async function getProduct(id, executor = pool) {
  const r = await executor.query(`${productSelect} WHERE p.id = $1`, [Number(id)]);
  return hydrateProduct(r.rows[0]);
}

// Кол-во активных товаров по каждой категории (учитывает поисковый запрос) — для счётчиков на чипах каталога
export async function productCategoryCounts(q = '') {
  const r = q
    ? await pool.query(
        `SELECT category, COUNT(*)::int n FROM products
         WHERE status='active' AND (title ILIKE $1 OR description ILIKE $1)
         GROUP BY category`,
        [`%${escLike(q)}%`]
      )
    : await pool.query(`SELECT category, COUNT(*)::int n FROM products WHERE status='active' GROUP BY category`);
  const out = {};
  let total = 0;
  for (const row of r.rows) { out[row.category] = row.n; total += row.n; }
  out.all = total;
  return out;
}

// Средняя оценка по всем отзывам сервиса — «приор» для байесовского рейтинга.
// Используется, чтобы товары новых продавцов не улетали в топ по одному 5★.
async function globalMeanRating() {
  const r = await pool.query('SELECT SUM(rating_sum) s, SUM(rating_count) c FROM users WHERE rating_count > 0');
  const row = r.rows[0];
  return row && row.c ? row.s / row.c : 4.5;
}
const RATING_SMOOTH = 5; // сколько «виртуальных» отзывов по средней оценке добавляем каждому продавцу
// Буст видимости для новых объявлений/новичков (даёт шанс на первые продажи).
// Действует только пока объявление свежее и затухает к 0 за FRESH_DAYS.
const FRESH_DAYS = 14;
const FRESH_MS = FRESH_DAYS * 24 * 60 * 60 * 1000;
const FRESH_BASE = 0.4;      // прибавка (в «звёздах») любому свежему объявлению
const NEWCOMER_EXTRA = 0.6;  // доп. прибавка новичкам (мало отзывов), пока объявление свежее
const NEWCOMER_REVIEWS = 5;  // после стольких отзывов «новичковая» добавка исчезает

export async function listProducts({ category, q = '', sellerId, status = 'active', sort = 'new', minPrice, maxPrice, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (status && status !== 'all') clauses.push(`p.status = ${p(status)}`);
  if (category) clauses.push(`p.category = ${p(category)}`);
  if (sellerId) clauses.push(`p.seller_id = ${p(Number(sellerId))}`);
  if (q) { const ph = p(`%${escLike(q)}%`); clauses.push(`(p.title ILIKE ${ph} OR p.description ILIKE ${ph})`); }
  if (minPrice != null && minPrice !== '') clauses.push(`p.price >= ${p(Number(minPrice))}`);
  if (maxPrice != null && maxPrice !== '') clauses.push(`p.price <= ${p(Number(maxPrice))}`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let order = 'p.created_at DESC';
  if (sort === 'cheap') order = 'p.price ASC';
  else if (sort === 'expensive') order = 'p.price DESC';
  else if (sort === 'popular') order = 'p.views DESC';
  else if (sort === 'top') {
    // Качество: байесовский рейтинг продавца (учитывает и среднюю оценку, и число отзывов).
    const prior = (RATING_SMOOTH * (await globalMeanRating())).toFixed(4);
    const bayes = `((u.rating_sum + ${prior}) / (u.rating_count + ${RATING_SMOOTH}))`;
    // Буст: freshFactor (свежесть объявления 1→0) * (база + доп. для новичков).
    const freshF = `greatest(0.0, 1.0 - (${now()} - p.created_at)::float8/${FRESH_MS})`;
    const newF = `greatest(0.0, 1.0 - u.rating_count::float8/${NEWCOMER_REVIEWS})`;
    const boost = `(${freshF}) * (${FRESH_BASE} + ${NEWCOMER_EXTRA} * (${newF}))`;
    order = `(${bayes} + ${boost}) DESC, u.deals_count DESC, p.views DESC, p.created_at DESC`;
  }
  const limitPh = p(limit);
  const offsetPh = p(offset);
  const r = await pool.query(`${productSelect} ${where} ORDER BY ${order} LIMIT ${limitPh} OFFSET ${offsetPh}`, params);
  return r.rows.map(hydrateProduct);
}

export async function updateProductStatus(id, status) {
  await pool.query('UPDATE products SET status=$1 WHERE id=$2', [status, Number(id)]);
  return getProduct(id);
}

export async function updateProduct(id, { category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar }) {
  await pool.query(
    `UPDATE products SET category=$1, title=$2, description=$3, price=$4, genres=$5, subscribers=$6, reach24=$7, avg_age=$8, screenshots=$9, avatar=$10 WHERE id=$11`,
    [
      category, title, description || '', Number(price) || 0,
      JSON.stringify(Array.isArray(genres) ? genres.slice(0, 12) : []),
      Number(subscribers) || 0, Number(reach24) || 0, String(avg_age || '').slice(0, 40),
      JSON.stringify(Array.isArray(screenshots) ? screenshots.slice(0, 8) : []),
      String(avatar || ''), Number(id),
    ]
  );
  return getProduct(id);
}

// Атомарная условная проверка: нельзя удалить товар, который в этот момент резервируется
// под сделку (защита от гонки с одновременной покупкой), не полагаясь на отдельное чтение статуса.
export async function deleteProduct(id) {
  const r = await pool.query("DELETE FROM products WHERE id=$1 AND status != 'reserved' RETURNING id", [Number(id)]);
  return r.rowCount > 0;
}

export async function incProductViews(id) {
  await pool.query('UPDATE products SET views = views + 1 WHERE id=$1', [Number(id)]);
}

// ================= REQUESTS (Биржа) =================
export async function createRequest({ buyer_id, category, title, description, budget }) {
  const r = await pool.query(
    `INSERT INTO requests (buyer_id, category, title, description, budget, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [Number(buyer_id), category, title, description || '', Number(budget) || 0, now()]
  );
  return getRequest(r.rows[0].id);
}

const requestSelect = `
  SELECT r.*, u.username AS buyer_username, u.first_name AS buyer_name, u.photo_url AS buyer_photo,
         CASE WHEN u.rating_count>0 THEN u.rating_sum::float8/u.rating_count ELSE 0 END AS buyer_rating
  FROM requests r JOIN users u ON u.id = r.buyer_id`;

export async function getRequest(id) {
  const r = await pool.query(`${requestSelect} WHERE r.id = $1`, [Number(id)]);
  return r.rows[0];
}

export async function listRequests({ category, q = '', buyerId, status = 'active', limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (status && status !== 'all') clauses.push(`r.status = ${p(status)}`);
  if (category) clauses.push(`r.category = ${p(category)}`);
  if (buyerId) clauses.push(`r.buyer_id = ${p(Number(buyerId))}`);
  if (q) { const ph = p(`%${escLike(q)}%`); clauses.push(`(r.title ILIKE ${ph} OR r.description ILIKE ${ph})`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitPh = p(limit);
  const offsetPh = p(offset);
  const r = await pool.query(`${requestSelect} ${where} ORDER BY r.created_at DESC LIMIT ${limitPh} OFFSET ${offsetPh}`, params);
  return r.rows;
}

export async function setRequestStatus(id, status) {
  await pool.query('UPDATE requests SET status=$1 WHERE id=$2', [status, Number(id)]);
  return getRequest(id);
}

export async function deleteRequest(id) {
  await pool.query('DELETE FROM requests WHERE id=$1', [Number(id)]);
}

// ================= CHATS / MESSAGES =================
export async function getOrCreateChat(userX, userY, productId = 0) {
  const a = Math.min(Number(userX), Number(userY));
  const b = Math.max(Number(userX), Number(userY));
  const pid = Number(productId) || 0;
  const existing = await pool.query('SELECT * FROM chats WHERE a_id=$1 AND b_id=$2 AND product_id=$3', [a, b, pid]);
  if (existing.rows[0]) return existing.rows[0];
  try {
    const r = await pool.query(
      'INSERT INTO chats (a_id, b_id, product_id, created_at, last_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [a, b, pid, now(), now()]
    );
    return r.rows[0];
  } catch (e) {
    if (e.code !== '23505') throw e;
    // Гонка: тот же чат уже создал параллельный запрос между SELECT и INSERT — возвращаем его
    const r2 = await pool.query('SELECT * FROM chats WHERE a_id=$1 AND b_id=$2 AND product_id=$3', [a, b, pid]);
    return r2.rows[0];
  }
}

export async function getChatById(id) {
  const r = await pool.query('SELECT * FROM chats WHERE id=$1', [Number(id)]);
  return r.rows[0];
}

export function isChatMember(chat, userId) {
  const u = Number(userId);
  return chat && (Number(chat.a_id) === u || Number(chat.b_id) === u);
}

// Список чатов пользователя с данными собеседника и кол-вом непрочитанных
export async function listChats(userId) {
  const uid = Number(userId);
  const r = await pool.query(
    `SELECT c.*,
            CASE WHEN c.a_id = $1 THEN c.b_id ELSE c.a_id END AS other_id
     FROM chats c
     WHERE (c.a_id = $1 OR c.b_id = $1) AND c.last_at > 0
     ORDER BY c.last_at DESC`,
    [uid]
  );
  const out = [];
  for (const c of r.rows) {
    const other = (await getUser(c.other_id)) || { id: c.other_id, first_name: 'Пользователь' };
    const unreadRes = await pool.query(
      'SELECT COUNT(*)::int n FROM messages WHERE chat_id=$1 AND sender_id<>$2 AND read_at=0',
      [c.id, uid]
    );
    out.push({
      id: c.id,
      product_id: c.product_id,
      last_text: c.last_text,
      last_at: Number(c.last_at),
      unread: unreadRes.rows[0].n,
      other: {
        id: other.id,
        username: other.username,
        first_name: other.first_name,
        photo_url: other.photo_url,
      },
    });
  }
  return out;
}

export async function sendMessage(chatId, senderId, text) {
  const t = String(text).slice(0, 4000);
  const r = await pool.query(
    'INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES ($1,$2,$3,$4) RETURNING *',
    [Number(chatId), Number(senderId), t, now()]
  );
  await pool.query('UPDATE chats SET last_text=$1, last_at=$2 WHERE id=$3', [t, now(), Number(chatId)]);
  return r.rows[0];
}

export async function listMessages(chatId, sinceId = 0) {
  const r = await pool.query(
    'SELECT * FROM messages WHERE chat_id=$1 AND id > $2 ORDER BY id ASC LIMIT 500',
    [Number(chatId), Number(sinceId) || 0]
  );
  return r.rows;
}

export async function markRead(chatId, userId) {
  await pool.query(
    'UPDATE messages SET read_at=$1 WHERE chat_id=$2 AND sender_id<>$3 AND read_at=0',
    [now(), Number(chatId), Number(userId)]
  );
}

export async function countUnread(userId) {
  const uid = Number(userId);
  const r = await pool.query(
    `SELECT COUNT(*)::int n FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE (c.a_id=$1 OR c.b_id=$1) AND m.sender_id<>$1 AND m.read_at=0`,
    [uid]
  );
  return r.rows[0].n;
}

// ================= BALANCE / TRANSACTIONS =================
export async function getBalance(userId, executor = pool) {
  const r = await executor.query('SELECT balance FROM users WHERE id=$1', [Number(userId)]);
  return r.rows[0] ? round2(r.rows[0].balance) : 0;
}

// Изменение баланса + запись в леджер. delta со знаком (+ пополнение / - списание).
// Списание — один атомарный UPDATE с проверкой достаточности средств прямо в WHERE,
// чтобы под конкурентными запросами баланс не мог уйти в минус (гонка read-then-write).
export async function balanceTx(userId, delta, type, { dealId = null, note = '' } = {}, executor = pool) {
  const uid = Number(userId);
  const d = round2(delta);
  const sql = d < 0
    ? 'UPDATE users SET balance = round((balance + $1)::numeric, 2)::float8 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance'
    : 'UPDATE users SET balance = round((balance + $1)::numeric, 2)::float8 WHERE id = $2 RETURNING balance';
  const res = await executor.query(sql, [d, uid]);
  if (res.rowCount === 0) throw new DealError('insufficient_funds');
  const next = Number(res.rows[0].balance);
  await executor.query(
    'INSERT INTO transactions (user_id, type, amount, balance_after, deal_id, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uid, type, d, next, dealId, note, now()]
  );
  return next;
}

export async function deposit(userId, amount, note = 'Пополнение баланса') {
  return balanceTx(userId, Math.abs(round2(amount)), 'deposit', { note });
}

export async function listTransactions(userId, limit = 50) {
  const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT $2', [Number(userId), limit]);
  return r.rows;
}

// ================= DEALS (эскроу) =================
const dealSelect = `
  SELECT d.*,
         b.username AS buyer_username, b.first_name AS buyer_name, b.photo_url AS buyer_photo,
         s.username AS seller_username, s.first_name AS seller_name, s.photo_url AS seller_photo
  FROM deals d
  JOIN users b ON b.id = d.buyer_id
  JOIN users s ON s.id = d.seller_id`;

function enrichDeal(d) {
  if (!d) return d;
  d.overdue = ['created', 'in_progress', 'review'].includes(d.status) && d.deadline_at > 0 && now() > Number(d.deadline_at);
  return d;
}

export async function getDeal(id, executor = pool) {
  const r = await executor.query(`${dealSelect} WHERE d.id = $1`, [Number(id)]);
  return enrichDeal(r.rows[0]);
}

export async function listDeals(userId, role = 'all') {
  const uid = Number(userId);
  let where = '(d.buyer_id = $1 OR d.seller_id = $1)';
  let params = [uid];
  if (role === 'buyer') { where = 'd.buyer_id = $1'; }
  else if (role === 'seller') { where = 'd.seller_id = $1'; }
  const r = await pool.query(`${dealSelect} WHERE ${where} ORDER BY d.created_at DESC`, params);
  return r.rows.map(enrichDeal);
}

// Покупка: замораживаем средства покупателя и создаём сделку (status=created)
export async function createEscrowDeal(product, buyerId) {
  const buyer = Number(buyerId);
  try {
    const dealId = await withTransaction(async (client) => {
      // Атомарно резервируем товар (compare-and-swap через WHERE) — так его нельзя продать дважды.
      // RETURNING * — берём АКТУАЛЬНУЮ цену/заголовок/категорию на момент резервирования, а не
      // переданный снимок product (его могли успеть отредактировать между просмотром и покупкой).
      const reserve = await client.query(
        "UPDATE products SET status='reserved' WHERE id=$1 AND status='active' RETURNING *",
        [product.id]
      );
      if (reserve.rowCount === 0) throw new DealError('unavailable');
      const fresh = reserve.rows[0];
      const price = round2(fresh.price);
      if (!price || price <= 0) throw new DealError('unavailable'); // цену успели сделать договорной/нулевой
      const ins = await client.query(
        `INSERT INTO deals (product_id, title, category, buyer_id, seller_id, amount, status, created_at, updated_at, deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6,'created',$7,$8,$9) RETURNING id`,
        [fresh.id, fresh.title, fresh.category, buyer, Number(fresh.seller_id), price, now(), now(), now() + DEAL_MS.confirm]
      );
      const id = ins.rows[0].id;
      await balanceTx(buyer, -price, 'hold', { dealId: id, note: `Оплата сделки #${id}: ${fresh.title}` }, client);
      return id;
    });
    return { deal: await getDeal(dealId) };
  } catch (e) {
    if (e.code === 'unavailable') return { error: 'unavailable' };
    if (e.code === 'insufficient_funds') return { error: 'insufficient' };
    throw e;
  }
}

// Продавец подтвердил -> В процессе (24ч на передачу)
// CAS-условие WHERE status='created' — без него конкурентный спор (disputeDeal), открытый
// между чтением статуса в api.js и этим UPDATE, тихо перезаписывался бы обратно в 'in_progress'.
export async function sellerConfirmDeal(id) {
  const upd = await pool.query(
    "UPDATE deals SET status='in_progress', deadline_at=$1, updated_at=$2 WHERE id=$3 AND status='created' RETURNING id",
    [now() + DEAL_MS.deliver, now(), Number(id)]
  );
  return { applied: upd.rowCount > 0, deal: await getDeal(id) };
}

// Продавец передал -> На проверке (7 дней до автозавершения)
// Тот же CAS-принцип: WHERE status='in_progress', иначе спор, открытый в этот момент,
// можно было бы молча вернуть в 'review' и позже автозавершить в обход решения администратора.
export async function sellerDeliverDeal(id) {
  const upd = await pool.query(
    "UPDATE deals SET status='review', deadline_at=$1, updated_at=$2 WHERE id=$3 AND status='in_progress' RETURNING id",
    [now() + DEAL_MS.review, now(), Number(id)]
  );
  return { applied: upd.rowCount > 0, deal: await getDeal(id) };
}

// Завершение: деньги продавцу
// Статус меняется первым же атомарным UPDATE с условием на текущий статус (compare-and-swap) —
// это и есть блокировка строки: конкурентный вызов либо ждёт эту транзакцию, либо, увидев уже
// изменённый статус, не находит подходящую строку (rowCount=0) и безопасно не делает повторную выплату/возврат.
// allowFromDisputed=true только для админского resolveDispute — обычные действия покупателя/
// продавца и фоновый таймаут-свип НЕ должны трогать сделку, по которой уже открыт спор.
// Возвращает {applied, deal}: applied=false значит запрос опоздал (сделку уже закрыл кто-то
// другой) — вызывающий код обязан не слать уведомление/не добавлять отзыв в этом случае.
export async function completeDeal(id, { rating, allowFromDisputed = false } = {}) {
  return withTransaction(async (client) => {
    const excluded = allowFromDisputed ? "('completed','cancelled')" : "('completed','cancelled','disputed')";
    const upd = await client.query(
      `UPDATE deals SET status='completed', deadline_at=0, updated_at=$1
       WHERE id=$2 AND status NOT IN ${excluded} RETURNING *`,
      [now(), Number(id)]
    );
    if (upd.rowCount === 0) return { applied: false, deal: await getDeal(id, client) };
    const d = upd.rows[0];
    await balanceTx(d.seller_id, d.amount, 'release', { dealId: d.id, note: `Выплата по сделке #${d.id}` }, client);
    await client.query('UPDATE users SET deals_count = deals_count + 1 WHERE id IN ($1,$2)', [d.buyer_id, d.seller_id]);
    if (d.product_id) await client.query("UPDATE products SET status='sold' WHERE id=$1", [d.product_id]);
    if (rating) await addRating(d.seller_id, rating, client);
    return { applied: true, deal: await getDeal(id, client) };
  });
}

// Отмена: возврат покупателю (penalizeSeller — штрафной 1★ продавцу)
export async function cancelDeal(id, { penalizeSeller = false, note = '', allowFromDisputed = false } = {}) {
  return withTransaction(async (client) => {
    const excluded = allowFromDisputed ? "('completed','cancelled')" : "('completed','cancelled','disputed')";
    const upd = await client.query(
      `UPDATE deals SET status='cancelled', deadline_at=0, updated_at=$1
       WHERE id=$2 AND status NOT IN ${excluded} RETURNING *`,
      [now(), Number(id)]
    );
    if (upd.rowCount === 0) return { applied: false, deal: await getDeal(id, client) };
    const d = upd.rows[0];
    await balanceTx(d.buyer_id, d.amount, 'refund', { dealId: d.id, note: note || `Возврат по сделке #${d.id}` }, client);
    // Возвращаем зарезервированный товар в продажу
    if (d.product_id) await client.query("UPDATE products SET status='active' WHERE id=$1 AND status='reserved'", [d.product_id]);
    if (penalizeSeller) await addRating(d.seller_id, 1, client);
    return { applied: true, deal: await getDeal(id, client) };
  });
}

export async function disputeDeal(id) {
  const r = await pool.query(
    `UPDATE deals SET status='disputed', updated_at=$1 WHERE id=$2 AND status IN ('created','in_progress','review') RETURNING id`,
    [now(), Number(id)]
  );
  if (r.rowCount === 0) throw new DealError('invalid_state');
  return getDeal(id);
}

// Решение спора админом: 'release' — продавцу, 'refund' — покупателю.
// allowFromDisputed:true — единственный легитимный способ закрыть сделку из статуса 'disputed'.
export async function resolveDispute(id, outcome) {
  if (outcome === 'release') return completeDeal(id, { allowFromDisputed: true });
  return cancelDeal(id, { allowFromDisputed: true, note: `Спор решён в пользу покупателя (#${id})` });
}

// Фоновая обработка дедлайнов. Возвращает список событий для уведомлений — только для
// сделок, которые ЭТОТ вызов реально закрыл (applied=true), иначе можно разослать
// уведомление о результате, который на самом деле определил кто-то другой (спор, ручное действие).
export async function processDealTimeouts() {
  const t = now();
  const events = [];
  const overdueCreated = await pool.query(
    "SELECT id FROM deals WHERE status='created' AND deadline_at>0 AND deadline_at < $1", [t]
  );
  for (const r of overdueCreated.rows) {
    const { applied, deal } = await cancelDeal(r.id, { penalizeSeller: true, note: 'Продавец не подтвердил сделку вовремя' });
    if (applied) events.push({ type: 'auto_cancel', deal });
  }
  const overdueReview = await pool.query(
    "SELECT id FROM deals WHERE status='review' AND deadline_at>0 AND deadline_at < $1", [t]
  );
  for (const r of overdueReview.rows) {
    const { applied, deal } = await completeDeal(r.id, {});
    if (applied) events.push({ type: 'auto_complete', deal });
  }
  return events;
}

// ================= WITHDRAWALS (вывод) =================
export async function createWithdrawal(userId, amount, requisites = '') {
  const uid = Number(userId);
  const amt = round2(amount);
  if (amt <= 0) return { error: 'amount' };
  try {
    const withdrawalId = await withTransaction(async (client) => {
      await balanceTx(uid, -amt, 'withdraw_hold', { note: 'Заявка на вывод средств' }, client);
      const ins = await client.query(
        'INSERT INTO withdrawals (user_id, amount, status, requisites, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [uid, amt, 'pending', String(requisites || '').slice(0, 200), now()]
      );
      return ins.rows[0].id;
    });
    return { withdrawal: await getWithdrawal(withdrawalId) };
  } catch (e) {
    if (e.code === 'insufficient_funds') return { error: 'insufficient' };
    throw e;
  }
}

export async function getWithdrawal(id, executor = pool) {
  const r = await executor.query('SELECT * FROM withdrawals WHERE id=$1', [Number(id)]);
  return r.rows[0];
}
export async function listUserWithdrawals(userId) {
  const r = await pool.query('SELECT * FROM withdrawals WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [Number(userId)]);
  return r.rows;
}
export async function listWithdrawals(status = 'all') {
  const r = (status && status !== 'all')
    ? await pool.query('SELECT w.*, u.first_name, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status=$1 ORDER BY w.id DESC LIMIT 200', [status])
    : await pool.query('SELECT w.*, u.first_name, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200');
  return r.rows;
}
// {applied, withdrawal}: applied=false значит заявку уже обработал кто-то другой (например,
// два админа одновременно нажали «Одобрить»/«Отклонить») — вызывающий код не должен слать
// уведомление о результате, который на самом деле не он определил.
export async function approveWithdrawal(id) {
  const upd = await pool.query(
    "UPDATE withdrawals SET status='approved', processed_at=$1 WHERE id=$2 AND status='pending' RETURNING *",
    [now(), Number(id)]
  );
  if (upd.rowCount > 0) return { applied: true, withdrawal: upd.rows[0] };
  return { applied: false, withdrawal: await getWithdrawal(id) };
}
export async function rejectWithdrawal(id) {
  return withTransaction(async (client) => {
    const upd = await client.query(
      "UPDATE withdrawals SET status='rejected', processed_at=$1 WHERE id=$2 AND status='pending' RETURNING *",
      [now(), Number(id)]
    );
    if (upd.rowCount === 0) return { applied: false, withdrawal: await getWithdrawal(id, client) };
    const w = upd.rows[0];
    await balanceTx(w.user_id, w.amount, 'withdraw_refund', { note: `Вывод отклонён #${id}` }, client);
    return { applied: true, withdrawal: w };
  });
}

// ================= REVIEWS (отзывы) =================
export async function addReview({ dealId, buyerId, sellerId, productId, stars, comment }) {
  const s = Math.round(Math.max(1, Math.min(5, Number(stars) || 0)));
  const existing = await pool.query('SELECT id FROM reviews WHERE deal_id=$1', [Number(dealId)]);
  if (existing.rows[0]) {
    const r = await pool.query('SELECT * FROM reviews WHERE id=$1', [existing.rows[0].id]);
    return r.rows[0];
  }
  try {
    const ins = await pool.query(
      'INSERT INTO reviews (deal_id, buyer_id, seller_id, product_id, stars, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [Number(dealId), Number(buyerId), Number(sellerId), Number(productId) || 0, s, String(comment).slice(0, 1000), now()]
    );
    await addRating(sellerId, s); // обновляем агрегированный рейтинг продавца
    const r = await pool.query('SELECT * FROM reviews WHERE id=$1', [ins.rows[0].id]);
    return r.rows[0];
  } catch (e) {
    if (e.code !== '23505') throw e;
    // Гонка: отзыв на эту сделку уже вставил параллельный запрос — возвращаем его, не дублируя рейтинг
    const r = await pool.query('SELECT * FROM reviews WHERE deal_id=$1', [Number(dealId)]);
    return r.rows[0];
  }
}

export async function getReviewByDeal(dealId) {
  const r = await pool.query('SELECT * FROM reviews WHERE deal_id=$1', [Number(dealId)]);
  return r.rows[0];
}

export async function listSellerReviews(sellerId, limit = 20) {
  const r = await pool.query(
    `SELECT r.*, u.first_name AS buyer_name, u.username AS buyer_username, u.photo_url AS buyer_photo
     FROM reviews r JOIN users u ON u.id = r.buyer_id
     WHERE r.seller_id = $1 ORDER BY r.id DESC LIMIT $2`,
    [Number(sellerId), limit]
  );
  return r.rows;
}

// ================= FAVORITES (избранное) =================
export async function toggleFavorite(userId, productId) {
  const uid = Number(userId), pid = Number(productId);
  const existing = await pool.query('SELECT 1 FROM favorites WHERE user_id=$1 AND product_id=$2', [uid, pid]);
  if (existing.rowCount > 0) {
    await pool.query('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2', [uid, pid]);
    return false;
  }
  try {
    await pool.query('INSERT INTO favorites (user_id, product_id, created_at) VALUES ($1,$2,$3)', [uid, pid, now()]);
  } catch (e) {
    // Гонка: два быстрых тапа/повтор запроса — кто-то уже добавил этот же товар между SELECT и INSERT.
    // PRIMARY KEY(user_id, product_id) откинул наш INSERT, но конечный результат тот же — считаем «добавлено».
    if (e.code !== '23505') throw e;
  }
  return true;
}

export async function getFavoriteIds(userId) {
  const r = await pool.query('SELECT product_id FROM favorites WHERE user_id=$1', [Number(userId)]);
  return new Set(r.rows.map((row) => row.product_id));
}

export async function listFavoriteProducts(userId) {
  const r = await pool.query(
    `${productSelect} JOIN favorites f ON f.product_id = p.id WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
    [Number(userId)]
  );
  return r.rows.map(hydrateProduct);
}

// ================= ADMIN STATS =================
export async function adminStats() {
  const val = async (sql) => {
    const row = (await pool.query(sql)).rows[0];
    return 'n' in row ? row.n : row.v;
  };
  return {
    users: await val('SELECT COUNT(*)::int n FROM users'),
    banned: await val('SELECT COUNT(*)::int n FROM users WHERE is_banned=1'),
    products: await val('SELECT COUNT(*)::int n FROM products'),
    productsActive: await val("SELECT COUNT(*)::int n FROM products WHERE status='active'"),
    requests: await val('SELECT COUNT(*)::int n FROM requests'),
    requestsActive: await val("SELECT COUNT(*)::int n FROM requests WHERE status='active'"),
    deals: await val('SELECT COUNT(*)::int n FROM deals'),
    dealsCompleted: await val("SELECT COUNT(*)::int n FROM deals WHERE status='completed'"),
    dealsActive: await val("SELECT COUNT(*)::int n FROM deals WHERE status IN ('created','in_progress','review')"),
    dealsDisputed: await val("SELECT COUNT(*)::int n FROM deals WHERE status='disputed'"),
    volume: await val("SELECT COALESCE(SUM(amount),0)::float8 v FROM deals WHERE status='completed'"),
    escrow: await val("SELECT COALESCE(SUM(amount),0)::float8 v FROM deals WHERE status IN ('created','in_progress','review','disputed')"),
    balances: await val('SELECT COALESCE(SUM(balance),0)::float8 v FROM users'),
    withdrawPending: await val("SELECT COUNT(*)::int n FROM withdrawals WHERE status='pending'"),
    withdrawPendingSum: await val("SELECT COALESCE(SUM(amount),0)::float8 v FROM withdrawals WHERE status='pending'"),
    messages: await val('SELECT COUNT(*)::int n FROM messages'),
  };
}

// Все сделки для админ-панели (со сведениями о покупателе/продавце)
export async function listAllDeals(limit = 200) {
  const r = await pool.query(
    `SELECT d.*, b.first_name AS buyer_name, b.username AS buyer_username,
            s.first_name AS seller_name, s.username AS seller_username
     FROM deals d JOIN users b ON b.id=d.buyer_id JOIN users s ON s.id=d.seller_id
     ORDER BY d.created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}
