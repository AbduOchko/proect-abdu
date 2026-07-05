import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, isAdminId } from './config.js';

// ---- Инициализация файла БД ----
const dir = path.dirname(config.dbPath);
if (dir && dir !== '.' && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Unicode-aware нижний регистр (SQLite LIKE/LOWER не работают с кириллицей).
// Используется для регистронезависимого поиска.
db.function('lower_u', { deterministic: true }, (s) => (s == null ? '' : String(s).toLowerCase()));

// ---- Схема ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  photo_url     TEXT,
  balance       REAL    DEFAULT 0,
  rating_sum    INTEGER DEFAULT 0,
  rating_count  INTEGER DEFAULT 0,
  deals_count   INTEGER DEFAULT 0,
  bio           TEXT    DEFAULT '',
  is_admin      INTEGER DEFAULT 0,
  is_banned     INTEGER DEFAULT 0,
  created_at    INTEGER
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL,
  category     TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  description  TEXT    DEFAULT '',
  price        REAL    DEFAULT 0,
  status       TEXT    DEFAULT 'active',
  views        INTEGER DEFAULT 0,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category, status);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id     INTEGER NOT NULL,
  category     TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  description  TEXT    DEFAULT '',
  budget       REAL    DEFAULT 0,
  status       TEXT    DEFAULT 'active',
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_requests_cat ON requests(category, status);
CREATE INDEX IF NOT EXISTS idx_requests_buyer ON requests(buyer_id);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id        INTEGER NOT NULL,
  b_id        INTEGER NOT NULL,
  product_id  INTEGER DEFAULT 0,
  last_text   TEXT    DEFAULT '',
  last_at     INTEGER DEFAULT 0,
  created_at  INTEGER,
  UNIQUE(a_id, b_id, product_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  sender_id   INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  created_at  INTEGER,
  read_at     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);

CREATE TABLE IF NOT EXISTS deals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER,
  title       TEXT,
  category    TEXT,
  buyer_id    INTEGER NOT NULL,
  seller_id   INTEGER NOT NULL,
  amount      REAL    DEFAULT 0,
  status      TEXT    DEFAULT 'pending',
  created_at  INTEGER,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON deals(buyer_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller_id);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT    NOT NULL,     -- deposit|hold|release|refund|withdraw_hold|withdraw_done|withdraw_refund
  amount        REAL    NOT NULL,     -- знак: + пополнение, - списание
  balance_after REAL    NOT NULL,
  deal_id       INTEGER,
  note          TEXT    DEFAULT '',
  created_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  amount       REAL    NOT NULL,
  status       TEXT    DEFAULT 'pending',  -- pending|approved|rejected
  requisites   TEXT    DEFAULT '',
  created_at   INTEGER,
  processed_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, id);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     INTEGER,
  buyer_id    INTEGER NOT NULL,
  seller_id   INTEGER NOT NULL,
  product_id  INTEGER DEFAULT 0,
  stars       INTEGER NOT NULL,
  comment     TEXT    NOT NULL,
  created_at  INTEGER,
  UNIQUE(deal_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id, id);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     INTEGER NOT NULL,
  product_id  INTEGER NOT NULL,
  created_at  INTEGER,
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_product ON favorites(product_id);
`);

// ---- Миграции: добавляем новые колонки, если их нет ----
function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
ensureColumn('products', 'genres', "TEXT DEFAULT '[]'");        // тематики канала (JSON-массив)
ensureColumn('products', 'subscribers', 'INTEGER DEFAULT 0');    // подписчики
ensureColumn('products', 'reach24', 'INTEGER DEFAULT 0');        // охват поста за 24ч
ensureColumn('products', 'avg_age', "TEXT DEFAULT ''");          // средний возраст аудитории
ensureColumn('products', 'screenshots', "TEXT DEFAULT '[]'");    // скриншоты статистики (JSON-массив URL)
ensureColumn('products', 'avatar', "TEXT DEFAULT ''");           // аватар/логотип товара (URL)
ensureColumn('deals', 'deadline_at', 'INTEGER DEFAULT 0');       // дедлайн текущего этапа сделки
ensureColumn('users', 'email', "TEXT DEFAULT ''");               // email, указанный при регистрации в приложении
ensureColumn('users', 'phone', "TEXT DEFAULT ''");               // телефон, указанный при регистрации в приложении
ensureColumn('users', 'login', "TEXT DEFAULT ''");               // логин, придуманный пользователем
ensureColumn('users', 'login_key', "TEXT DEFAULT ''");           // логин в нижнем регистре — для проверки уникальности
// Пароль не используется для входа (авторизация всегда идёт через Telegram initData) —
// он лишь запрашивается и сохраняется как часть анкеты регистрации.
ensureColumn('users', 'password_hash', "TEXT DEFAULT ''");
ensureColumn('users', 'registered', 'INTEGER DEFAULT 0');        // прошёл ли обязательную регистрацию
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_key ON users(login_key) WHERE login_key != ''`);

// Порядковый номер пользователя (1, 2, 3...) — показывается вместо телеграм-id, который
// остаётся внутренним первичным ключом (на него ссылаются products/deals/chats и т.д.)
ensureColumn('users', 'seq_id', 'INTEGER');
if (db.prepare('SELECT COUNT(*) c FROM users WHERE seq_id IS NULL').get().c > 0) {
  const rows = db.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC').all();
  const setSeq = db.prepare('UPDATE users SET seq_id=? WHERE id=?');
  db.transaction((list) => { list.forEach((r, i) => setSeq.run(i + 1, r.id)); })(rows);
}

const now = () => Date.now();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
export function upsertUser(tg) {
  const id = Number(tg.id);
  const admin = isAdminId(id) ? 1 : 0;
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (existing) {
    db.prepare(
      `UPDATE users SET username=?, first_name=?, last_name=?, photo_url=?, is_admin=? WHERE id=?`
    ).run(
      tg.username || null,
      tg.first_name || null,
      tg.last_name || null,
      tg.photo_url || null,
      admin,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO users (id, seq_id, username, first_name, last_name, photo_url, is_admin, created_at)
       VALUES (?, (SELECT COALESCE(MAX(seq_id),0)+1 FROM users), ?,?,?,?,?,?)`
    ).run(
      id,
      tg.username || null,
      tg.first_name || null,
      tg.last_name || null,
      tg.photo_url || null,
      admin,
      now()
    );
  }
  return getUser(id);
}

export function getUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (u) {
    u.rating = u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0;
    delete u.password_hash;
    delete u.login_key;
  }
  return u;
}

export function updateProfile(id, { bio }) {
  db.prepare('UPDATE users SET bio=? WHERE id=?').run(bio ?? '', Number(id));
  return getUser(id);
}

// ================= РЕГИСТРАЦИЯ (обязательная анкета при первом входе) =================
export function registerUser(id, { email, phone, login, passwordHash }) {
  const uid = Number(id);
  try {
    db.prepare(
      `UPDATE users SET email=?, phone=?, login=?, login_key=?, password_hash=?, registered=1 WHERE id=?`
    ).run(email, phone, login, login.toLowerCase(), passwordHash, uid);
  } catch (e) {
    if (/UNIQUE/.test(e.message || '')) throw Object.assign(new Error('Этот логин уже занят'), { code: 'login_taken' });
    throw e;
  }
  return getUser(uid);
}

export function setBanned(id, banned) {
  db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(banned ? 1 : 0, Number(id));
  return getUser(id);
}

export function addRating(userId, stars) {
  const s = Math.round(Math.max(1, Math.min(5, Number(stars) || 0)));
  db.prepare('UPDATE users SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id=?').run(
    s,
    Number(userId)
  );
}

export function listUsers({ q = '', limit = 50, offset = 0 } = {}) {
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT * FROM users
       WHERE (? = '' OR lower_u(username) LIKE lower_u(?) OR lower_u(first_name) LIKE lower_u(?) OR CAST(id AS TEXT) LIKE ?)
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(q, like, like, like, limit, offset)
    .map((u) => {
      const r = { ...u, rating: u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0 };
      delete r.password_hash;
      delete r.login_key;
      return r;
    });
}

// ================= PRODUCTS =================
export function createProduct({ seller_id, category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar }) {
  const info = db
    .prepare(
      `INSERT INTO products (seller_id, category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      Number(seller_id), category, title, description || '', Number(price) || 0,
      JSON.stringify(Array.isArray(genres) ? genres.slice(0, 12) : []),
      Number(subscribers) || 0, Number(reach24) || 0, String(avg_age || '').slice(0, 40),
      JSON.stringify(Array.isArray(screenshots) ? screenshots.slice(0, 8) : []),
      String(avatar || ''),
      now()
    );
  return getProduct(info.lastInsertRowid);
}

const productSelect = `
  SELECT p.*, u.username AS seller_username, u.first_name AS seller_name,
         u.photo_url AS seller_photo,
         CASE WHEN u.rating_count>0 THEN ROUND(CAST(u.rating_sum AS REAL)/u.rating_count,2) ELSE 0 END AS seller_rating,
         u.deals_count AS seller_deals
  FROM products p JOIN users u ON u.id = p.seller_id`;

export function getProduct(id) {
  return hydrateProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(Number(id)));
}

// Кол-во активных товаров по каждой категории (учитывает поисковый запрос) — для счётчиков на чипах каталога
export function productCategoryCounts(q = '') {
  const rows = q
    ? db.prepare(
        `SELECT category, COUNT(*) n FROM products
         WHERE status='active' AND (lower_u(title) LIKE lower_u(?) OR lower_u(description) LIKE lower_u(?))
         GROUP BY category`
      ).all(`%${q}%`, `%${q}%`)
    : db.prepare(`SELECT category, COUNT(*) n FROM products WHERE status='active' GROUP BY category`).all();
  const out = {};
  let total = 0;
  for (const r of rows) { out[r.category] = r.n; total += r.n; }
  out.all = total;
  return out;
}

// Средняя оценка по всем отзывам сервиса — «приор» для байесовского рейтинга.
// Используется, чтобы товары новых продавцов не улетали в топ по одному 5★.
function globalMeanRating() {
  const r = db.prepare('SELECT SUM(rating_sum) s, SUM(rating_count) c FROM users WHERE rating_count > 0').get();
  return r && r.c ? r.s / r.c : 4.5;
}
const RATING_SMOOTH = 5; // сколько «виртуальных» отзывов по средней оценке добавляем каждому продавцу
// Буст видимости для новых объявлений/новичков (даёт шанс на первые продажи).
// Действует только пока объявление свежее и затухает к 0 за FRESH_DAYS.
const FRESH_DAYS = 14;
const FRESH_MS = FRESH_DAYS * 24 * 60 * 60 * 1000;
const FRESH_BASE = 0.4;      // прибавка (в «звёздах») любому свежему объявлению
const NEWCOMER_EXTRA = 0.6;  // доп. прибавка новичкам (мало отзывов), пока объявление свежее
const NEWCOMER_REVIEWS = 5;  // после стольких отзывов «новичковая» добавка исчезает

export function listProducts({ category, q = '', sellerId, status = 'active', sort = 'new', minPrice, maxPrice, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status && status !== 'all') { clauses.push('p.status = ?'); params.push(status); }
  if (category) { clauses.push('p.category = ?'); params.push(category); }
  if (sellerId) { clauses.push('p.seller_id = ?'); params.push(Number(sellerId)); }
  if (q) { clauses.push('(lower_u(p.title) LIKE lower_u(?) OR lower_u(p.description) LIKE lower_u(?))'); params.push(`%${q}%`, `%${q}%`); }
  if (minPrice != null && minPrice !== '') { clauses.push('p.price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice != null && maxPrice !== '') { clauses.push('p.price <= ?'); params.push(Number(maxPrice)); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let order = 'p.created_at DESC';
  if (sort === 'cheap') order = 'p.price ASC';
  else if (sort === 'expensive') order = 'p.price DESC';
  else if (sort === 'popular') order = 'p.views DESC';
  else if (sort === 'top') {
    // Качество: байесовский рейтинг продавца (учитывает и среднюю оценку, и число отзывов).
    const prior = (RATING_SMOOTH * globalMeanRating()).toFixed(4);
    const bayes = `((u.rating_sum + ${prior}) / (u.rating_count + ${RATING_SMOOTH}))`;
    // Буст: freshFactor (свежесть объявления 1→0) * (база + доп. для новичков).
    const freshF = `max(0.0, 1.0 - CAST(${now()} - p.created_at AS REAL)/${FRESH_MS})`;
    const newF = `max(0.0, 1.0 - CAST(u.rating_count AS REAL)/${NEWCOMER_REVIEWS})`;
    const boost = `(${freshF}) * (${FRESH_BASE} + ${NEWCOMER_EXTRA} * (${newF}))`;
    order = `(${bayes} + ${boost}) DESC, u.deals_count DESC, p.views DESC, p.created_at DESC`;
  }
  params.push(limit, offset);
  return db.prepare(`${productSelect} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params).map(hydrateProduct);
}

export function updateProductStatus(id, status) {
  db.prepare('UPDATE products SET status=? WHERE id=?').run(status, Number(id));
  return getProduct(id);
}

export function updateProduct(id, { category, title, description, price, genres, subscribers, reach24, avg_age, screenshots, avatar }) {
  db.prepare(
    `UPDATE products SET category=?, title=?, description=?, price=?, genres=?, subscribers=?, reach24=?, avg_age=?, screenshots=?, avatar=? WHERE id=?`
  ).run(
    category, title, description || '', Number(price) || 0,
    JSON.stringify(Array.isArray(genres) ? genres.slice(0, 12) : []),
    Number(subscribers) || 0, Number(reach24) || 0, String(avg_age || '').slice(0, 40),
    JSON.stringify(Array.isArray(screenshots) ? screenshots.slice(0, 8) : []),
    String(avatar || ''), Number(id)
  );
  return getProduct(id);
}

export function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id=?').run(Number(id));
}

export function incProductViews(id) {
  db.prepare('UPDATE products SET views = views + 1 WHERE id=?').run(Number(id));
}

// ================= REQUESTS (Биржа) =================
export function createRequest({ buyer_id, category, title, description, budget }) {
  const info = db
    .prepare(
      `INSERT INTO requests (buyer_id, category, title, description, budget, created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(Number(buyer_id), category, title, description || '', Number(budget) || 0, now());
  return getRequest(info.lastInsertRowid);
}

const requestSelect = `
  SELECT r.*, u.username AS buyer_username, u.first_name AS buyer_name, u.photo_url AS buyer_photo,
         CASE WHEN u.rating_count>0 THEN ROUND(CAST(u.rating_sum AS REAL)/u.rating_count,2) ELSE 0 END AS buyer_rating
  FROM requests r JOIN users u ON u.id = r.buyer_id`;

export function getRequest(id) {
  return db.prepare(`${requestSelect} WHERE r.id = ?`).get(Number(id));
}

export function listRequests({ category, q = '', buyerId, status = 'active', limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status && status !== 'all') { clauses.push('r.status = ?'); params.push(status); }
  if (category) { clauses.push('r.category = ?'); params.push(category); }
  if (buyerId) { clauses.push('r.buyer_id = ?'); params.push(Number(buyerId)); }
  if (q) { clauses.push('(lower_u(r.title) LIKE lower_u(?) OR lower_u(r.description) LIKE lower_u(?))'); params.push(`%${q}%`, `%${q}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(`${requestSelect} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).all(...params);
}

export function setRequestStatus(id, status) {
  db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, Number(id));
  return getRequest(id);
}

export function deleteRequest(id) {
  db.prepare('DELETE FROM requests WHERE id=?').run(Number(id));
}

// ================= CHATS / MESSAGES =================
export function getOrCreateChat(userX, userY, productId = 0) {
  const a = Math.min(Number(userX), Number(userY));
  const b = Math.max(Number(userX), Number(userY));
  const pid = Number(productId) || 0;
  let chat = db.prepare('SELECT * FROM chats WHERE a_id=? AND b_id=? AND product_id=?').get(a, b, pid);
  if (!chat) {
    const info = db
      .prepare('INSERT INTO chats (a_id, b_id, product_id, created_at, last_at) VALUES (?,?,?,?,?)')
      .run(a, b, pid, now(), now());
    chat = db.prepare('SELECT * FROM chats WHERE id=?').get(info.lastInsertRowid);
  }
  return chat;
}

export function getChatById(id) {
  return db.prepare('SELECT * FROM chats WHERE id=?').get(Number(id));
}

export function isChatMember(chat, userId) {
  const u = Number(userId);
  return chat && (chat.a_id === u || chat.b_id === u);
}

// Список чатов пользователя с данными собеседника и кол-вом непрочитанных
export function listChats(userId) {
  const uid = Number(userId);
  const rows = db
    .prepare(
      `SELECT c.*,
              CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END AS other_id
       FROM chats c
       WHERE (c.a_id = ? OR c.b_id = ?) AND c.last_at > 0
       ORDER BY c.last_at DESC`
    )
    .all(uid, uid, uid);
  return rows.map((c) => {
    const other = getUser(c.other_id) || { id: c.other_id, first_name: 'Пользователь' };
    const unread = db
      .prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND sender_id<>? AND read_at=0')
      .get(c.id, uid).n;
    return {
      id: c.id,
      product_id: c.product_id,
      last_text: c.last_text,
      last_at: c.last_at,
      unread,
      other: {
        id: other.id,
        username: other.username,
        first_name: other.first_name,
        photo_url: other.photo_url,
      },
    };
  });
}

export function sendMessage(chatId, senderId, text) {
  const t = String(text).slice(0, 4000);
  const info = db
    .prepare('INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES (?,?,?,?)')
    .run(Number(chatId), Number(senderId), t, now());
  db.prepare('UPDATE chats SET last_text=?, last_at=? WHERE id=?').run(t, now(), Number(chatId));
  return db.prepare('SELECT * FROM messages WHERE id=?').get(info.lastInsertRowid);
}

export function listMessages(chatId, sinceId = 0) {
  return db
    .prepare('SELECT * FROM messages WHERE chat_id=? AND id > ? ORDER BY id ASC LIMIT 500')
    .all(Number(chatId), Number(sinceId) || 0);
}

export function markRead(chatId, userId) {
  db.prepare('UPDATE messages SET read_at=? WHERE chat_id=? AND sender_id<>? AND read_at=0').run(
    now(),
    Number(chatId),
    Number(userId)
  );
}

export function countUnread(userId) {
  const uid = Number(userId);
  return db
    .prepare(
      `SELECT COUNT(*) n FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE (c.a_id=? OR c.b_id=?) AND m.sender_id<>? AND m.read_at=0`
    )
    .get(uid, uid, uid).n;
}

// ================= BALANCE / TRANSACTIONS =================
export function getBalance(userId) {
  const u = db.prepare('SELECT balance FROM users WHERE id=?').get(Number(userId));
  return u ? round2(u.balance) : 0;
}

// Изменение баланса + запись в леджер. delta со знаком (+ пополнение / - списание).
export function balanceTx(userId, delta, type, { dealId = null, note = '' } = {}) {
  const uid = Number(userId);
  const next = round2(getBalance(uid) + Number(delta));
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(next, uid);
  db.prepare(
    'INSERT INTO transactions (user_id, type, amount, balance_after, deal_id, note, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(uid, type, round2(delta), next, dealId, note, now());
  return next;
}

export function deposit(userId, amount, note = 'Пополнение баланса') {
  return balanceTx(userId, Math.abs(round2(amount)), 'deposit', { note });
}

export function listTransactions(userId, limit = 50) {
  return db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT ?').all(Number(userId), limit);
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
  d.overdue = ['created', 'in_progress', 'review'].includes(d.status) && d.deadline_at > 0 && now() > d.deadline_at;
  return d;
}

export function getDeal(id) {
  return enrichDeal(db.prepare(`${dealSelect} WHERE d.id = ?`).get(Number(id)));
}

export function listDeals(userId, role = 'all') {
  const uid = Number(userId);
  let where = '(d.buyer_id = ? OR d.seller_id = ?)';
  let params = [uid, uid];
  if (role === 'buyer') { where = 'd.buyer_id = ?'; params = [uid]; }
  else if (role === 'seller') { where = 'd.seller_id = ?'; params = [uid]; }
  return db.prepare(`${dealSelect} WHERE ${where} ORDER BY d.created_at DESC`).all(...params).map(enrichDeal);
}

// Покупка: замораживаем средства покупателя и создаём сделку (status=created)
export function createEscrowDeal(product, buyerId) {
  const buyer = Number(buyerId);
  const price = round2(product.price);
  return db.transaction(() => {
    // Атомарно перепроверяем и резервируем товар, чтобы его нельзя было продать дважды
    const row = db.prepare('SELECT status FROM products WHERE id=?').get(product.id);
    if (!row || row.status !== 'active') return { error: 'unavailable' };
    if (getBalance(buyer) < price) return { error: 'insufficient' };
    db.prepare("UPDATE products SET status='reserved' WHERE id=?").run(product.id);
    const info = db.prepare(
      `INSERT INTO deals (product_id, title, category, buyer_id, seller_id, amount, status, created_at, updated_at, deadline_at)
       VALUES (?,?,?,?,?,?, 'created', ?, ?, ?)`
    ).run(product.id, product.title, product.category, buyer, Number(product.seller_id), price, now(), now(), now() + DEAL_MS.confirm);
    const dealId = info.lastInsertRowid;
    balanceTx(buyer, -price, 'hold', { dealId, note: `Оплата сделки #${dealId}: ${product.title}` });
    return { deal: getDeal(dealId) };
  })();
}

// Продавец подтвердил -> В процессе (24ч на передачу)
export function sellerConfirmDeal(id) {
  db.prepare('UPDATE deals SET status=?, deadline_at=?, updated_at=? WHERE id=?')
    .run('in_progress', now() + DEAL_MS.deliver, now(), Number(id));
  return getDeal(id);
}

// Продавец передал -> На проверке (7 дней до автозавершения)
export function sellerDeliverDeal(id) {
  db.prepare('UPDATE deals SET status=?, deadline_at=?, updated_at=? WHERE id=?')
    .run('review', now() + DEAL_MS.review, now(), Number(id));
  return getDeal(id);
}

// Завершение: деньги продавцу
export function completeDeal(id, { rating } = {}) {
  return db.transaction(() => {
    const d = getDeal(id);
    if (!d || d.status === 'completed' || d.status === 'cancelled') return d;
    balanceTx(d.seller_id, d.amount, 'release', { dealId: d.id, note: `Выплата по сделке #${d.id}` });
    db.prepare('UPDATE deals SET status=?, deadline_at=0, updated_at=? WHERE id=?').run('completed', now(), d.id);
    db.prepare('UPDATE users SET deals_count = deals_count + 1 WHERE id IN (?,?)').run(d.buyer_id, d.seller_id);
    if (d.product_id) db.prepare("UPDATE products SET status='sold' WHERE id=?").run(d.product_id);
    if (rating) addRating(d.seller_id, rating);
    return getDeal(id);
  })();
}

// Отмена: возврат покупателю (penalizeSeller — штрафной 1★ продавцу)
export function cancelDeal(id, { penalizeSeller = false, note = '' } = {}) {
  return db.transaction(() => {
    const d = getDeal(id);
    if (!d || d.status === 'completed' || d.status === 'cancelled') return d;
    balanceTx(d.buyer_id, d.amount, 'refund', { dealId: d.id, note: note || `Возврат по сделке #${d.id}` });
    db.prepare('UPDATE deals SET status=?, deadline_at=0, updated_at=? WHERE id=?').run('cancelled', now(), d.id);
    // Возвращаем зарезервированный товар в продажу
    if (d.product_id) db.prepare("UPDATE products SET status='active' WHERE id=? AND status='reserved'").run(d.product_id);
    if (penalizeSeller) addRating(d.seller_id, 1);
    return getDeal(id);
  })();
}

export function disputeDeal(id) {
  db.prepare('UPDATE deals SET status=?, updated_at=? WHERE id=?').run('disputed', now(), Number(id));
  return getDeal(id);
}

// Решение спора админом: 'release' — продавцу, 'refund' — покупателю
export function resolveDispute(id, outcome) {
  if (outcome === 'release') return completeDeal(id);
  return cancelDeal(id, { note: `Спор решён в пользу покупателя (#${id})` });
}

// Фоновая обработка дедлайнов. Возвращает список событий для уведомлений.
export function processDealTimeouts() {
  const t = now();
  const events = [];
  for (const r of db.prepare("SELECT id FROM deals WHERE status='created' AND deadline_at>0 AND deadline_at < ?").all(t)) {
    events.push({ type: 'auto_cancel', deal: cancelDeal(r.id, { penalizeSeller: true, note: 'Продавец не подтвердил сделку вовремя' }) });
  }
  for (const r of db.prepare("SELECT id FROM deals WHERE status='review' AND deadline_at>0 AND deadline_at < ?").all(t)) {
    events.push({ type: 'auto_complete', deal: completeDeal(r.id, {}) });
  }
  return events;
}

// ================= WITHDRAWALS (вывод) =================
export function createWithdrawal(userId, amount, requisites = '') {
  const uid = Number(userId);
  const amt = round2(amount);
  return db.transaction(() => {
    if (amt <= 0) return { error: 'amount' };
    if (getBalance(uid) < amt) return { error: 'insufficient' };
    balanceTx(uid, -amt, 'withdraw_hold', { note: 'Заявка на вывод средств' });
    const info = db.prepare(
      'INSERT INTO withdrawals (user_id, amount, status, requisites, created_at) VALUES (?,?,?,?,?)'
    ).run(uid, amt, 'pending', String(requisites || '').slice(0, 200), now());
    return { withdrawal: getWithdrawal(info.lastInsertRowid) };
  })();
}

export function getWithdrawal(id) { return db.prepare('SELECT * FROM withdrawals WHERE id=?').get(Number(id)); }
export function listUserWithdrawals(userId) {
  return db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50').all(Number(userId));
}
export function listWithdrawals(status = 'all') {
  return (status && status !== 'all')
    ? db.prepare('SELECT w.*, u.first_name, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status=? ORDER BY w.id DESC LIMIT 200').all(status)
    : db.prepare('SELECT w.*, u.first_name, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200').all();
}
export function approveWithdrawal(id) {
  const w = getWithdrawal(id);
  if (!w || w.status !== 'pending') return w;
  db.prepare("UPDATE withdrawals SET status='approved', processed_at=? WHERE id=?").run(now(), Number(id));
  return getWithdrawal(id);
}
export function rejectWithdrawal(id) {
  return db.transaction(() => {
    const w = getWithdrawal(id);
    if (!w || w.status !== 'pending') return w;
    balanceTx(w.user_id, w.amount, 'withdraw_refund', { note: `Вывод отклонён #${id}` });
    db.prepare("UPDATE withdrawals SET status='rejected', processed_at=? WHERE id=?").run(now(), Number(id));
    return getWithdrawal(id);
  })();
}

// ================= REVIEWS (отзывы) =================
export function addReview({ dealId, buyerId, sellerId, productId, stars, comment }) {
  const s = Math.round(Math.max(1, Math.min(5, Number(stars) || 0)));
  const existing = db.prepare('SELECT id FROM reviews WHERE deal_id=?').get(Number(dealId));
  if (existing) return db.prepare('SELECT * FROM reviews WHERE id=?').get(existing.id);
  const info = db.prepare(
    'INSERT INTO reviews (deal_id, buyer_id, seller_id, product_id, stars, comment, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(Number(dealId), Number(buyerId), Number(sellerId), Number(productId) || 0, s, String(comment).slice(0, 1000), now());
  addRating(sellerId, s); // обновляем агрегированный рейтинг продавца
  return db.prepare('SELECT * FROM reviews WHERE id=?').get(info.lastInsertRowid);
}

export function getReviewByDeal(dealId) {
  return db.prepare('SELECT * FROM reviews WHERE deal_id=?').get(Number(dealId));
}

export function listSellerReviews(sellerId, limit = 20) {
  return db.prepare(
    `SELECT r.*, u.first_name AS buyer_name, u.username AS buyer_username, u.photo_url AS buyer_photo
     FROM reviews r JOIN users u ON u.id = r.buyer_id
     WHERE r.seller_id = ? ORDER BY r.id DESC LIMIT ?`
  ).all(Number(sellerId), limit);
}

// ================= FAVORITES (избранное) =================
export function toggleFavorite(userId, productId) {
  const uid = Number(userId), pid = Number(productId);
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?').get(uid, pid);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND product_id=?').run(uid, pid);
    return false;
  }
  db.prepare('INSERT INTO favorites (user_id, product_id, created_at) VALUES (?,?,?)').run(uid, pid, now());
  return true;
}

export function getFavoriteIds(userId) {
  return new Set(
    db.prepare('SELECT product_id FROM favorites WHERE user_id=?').all(Number(userId)).map((r) => r.product_id)
  );
}

export function listFavoriteProducts(userId) {
  return db
    .prepare(`${productSelect} JOIN favorites f ON f.product_id = p.id WHERE f.user_id = ? ORDER BY f.created_at DESC`)
    .all(Number(userId))
    .map(hydrateProduct);
}

// ================= ADMIN STATS =================
export function adminStats() {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    users: one('SELECT COUNT(*) n FROM users').n,
    banned: one('SELECT COUNT(*) n FROM users WHERE is_banned=1').n,
    products: one('SELECT COUNT(*) n FROM products').n,
    productsActive: one("SELECT COUNT(*) n FROM products WHERE status='active'").n,
    requests: one('SELECT COUNT(*) n FROM requests').n,
    requestsActive: one("SELECT COUNT(*) n FROM requests WHERE status='active'").n,
    deals: one('SELECT COUNT(*) n FROM deals').n,
    dealsCompleted: one("SELECT COUNT(*) n FROM deals WHERE status='completed'").n,
    dealsActive: one("SELECT COUNT(*) n FROM deals WHERE status IN ('created','in_progress','review')").n,
    dealsDisputed: one("SELECT COUNT(*) n FROM deals WHERE status='disputed'").n,
    volume: one("SELECT COALESCE(SUM(amount),0) v FROM deals WHERE status='completed'").v,
    escrow: one("SELECT COALESCE(SUM(amount),0) v FROM deals WHERE status IN ('created','in_progress','review','disputed')").v,
    balances: one('SELECT COALESCE(SUM(balance),0) v FROM users').v,
    withdrawPending: one("SELECT COUNT(*) n FROM withdrawals WHERE status='pending'").n,
    withdrawPendingSum: one("SELECT COALESCE(SUM(amount),0) v FROM withdrawals WHERE status='pending'").v,
    messages: one('SELECT COUNT(*) n FROM messages').n,
  };
}
