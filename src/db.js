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
`);

const now = () => Date.now();

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
      `INSERT INTO users (id, username, first_name, last_name, photo_url, is_admin, created_at)
       VALUES (?,?,?,?,?,?,?)`
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
  if (u) u.rating = u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0;
  return u;
}

export function updateProfile(id, { bio }) {
  db.prepare('UPDATE users SET bio=? WHERE id=?').run(bio ?? '', Number(id));
  return getUser(id);
}

export function setBanned(id, banned) {
  db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(banned ? 1 : 0, Number(id));
  return getUser(id);
}

export function addRating(userId, stars) {
  const s = Math.max(1, Math.min(5, Number(stars) || 0));
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
    .map((u) => ({ ...u, rating: u.rating_count ? +(u.rating_sum / u.rating_count).toFixed(2) : 0 }));
}

// ================= PRODUCTS =================
export function createProduct({ seller_id, category, title, description, price }) {
  const info = db
    .prepare(
      `INSERT INTO products (seller_id, category, title, description, price, created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(Number(seller_id), category, title, description || '', Number(price) || 0, now());
  return getProduct(info.lastInsertRowid);
}

const productSelect = `
  SELECT p.*, u.username AS seller_username, u.first_name AS seller_name,
         u.photo_url AS seller_photo,
         CASE WHEN u.rating_count>0 THEN ROUND(CAST(u.rating_sum AS REAL)/u.rating_count,2) ELSE 0 END AS seller_rating,
         u.deals_count AS seller_deals
  FROM products p JOIN users u ON u.id = p.seller_id`;

export function getProduct(id) {
  return db.prepare(`${productSelect} WHERE p.id = ?`).get(Number(id));
}

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
  params.push(limit, offset);
  return db.prepare(`${productSelect} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params);
}

export function updateProductStatus(id, status) {
  db.prepare('UPDATE products SET status=? WHERE id=?').run(status, Number(id));
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

// ================= DEALS =================
export function createDeal({ product, buyer_id }) {
  const info = db
    .prepare(
      `INSERT INTO deals (product_id, title, category, buyer_id, seller_id, amount, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?)`
    )
    .run(
      product.id,
      product.title,
      product.category,
      Number(buyer_id),
      Number(product.seller_id),
      Number(product.price) || 0,
      now(),
      now()
    );
  return getDeal(info.lastInsertRowid);
}

const dealSelect = `
  SELECT d.*,
         b.username AS buyer_username, b.first_name AS buyer_name, b.photo_url AS buyer_photo,
         s.username AS seller_username, s.first_name AS seller_name, s.photo_url AS seller_photo
  FROM deals d
  JOIN users b ON b.id = d.buyer_id
  JOIN users s ON s.id = d.seller_id`;

export function getDeal(id) {
  return db.prepare(`${dealSelect} WHERE d.id = ?`).get(Number(id));
}

export function listDeals(userId, role = 'all') {
  const uid = Number(userId);
  let where = '(d.buyer_id = ? OR d.seller_id = ?)';
  let params = [uid, uid];
  if (role === 'buyer') { where = 'd.buyer_id = ?'; params = [uid]; }
  else if (role === 'seller') { where = 'd.seller_id = ?'; params = [uid]; }
  return db.prepare(`${dealSelect} WHERE ${where} ORDER BY d.created_at DESC`).all(...params);
}

export function updateDealStatus(id, status) {
  const deal = getDeal(id);
  if (!deal) return null;
  db.prepare('UPDATE deals SET status=?, updated_at=? WHERE id=?').run(status, now(), Number(id));
  // При завершении сделки — засчитываем её обоим и помечаем товар проданным
  if (status === 'completed' && deal.status !== 'completed') {
    db.prepare('UPDATE users SET deals_count = deals_count + 1 WHERE id IN (?,?)').run(
      deal.buyer_id,
      deal.seller_id
    );
    if (deal.product_id) {
      db.prepare("UPDATE products SET status='sold' WHERE id=?").run(deal.product_id);
    }
  }
  return getDeal(id);
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
    dealsDisputed: one("SELECT COUNT(*) n FROM deals WHERE status='disputed'").n,
    volume: one("SELECT COALESCE(SUM(amount),0) v FROM deals WHERE status='completed'").v,
    messages: one('SELECT COUNT(*) n FROM messages').n,
  };
}
