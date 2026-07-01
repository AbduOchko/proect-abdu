import express from 'express';
import { authMiddleware, adminOnly } from './auth.js';
import { CATEGORY_KEYS, CATEGORIES, isAdminId } from './config.js';
import * as db from './db.js';

export const api = express.Router();

// ---- helpers ----
const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const validCat = (c) => CATEGORY_KEYS.includes(c);
function bad(res, msg) {
  return res.status(400).json({ error: 'bad_request', message: msg });
}

// Все /api маршруты требуют авторизации Telegram
api.use(authMiddleware);

// ============ CONFIG / ME ============
api.get('/config', (req, res) => {
  res.json({ categories: CATEGORIES });
});

api.get('/me', (req, res) => {
  const u = db.getUser(req.user.id);
  res.json({
    ...u,
    is_admin: isAdminId(u.id) ? 1 : 0,
    unread: db.countUnread(u.id),
  });
});

api.patch('/me', (req, res) => {
  const bio = str(req.body.bio, 500);
  const u = db.updateProfile(req.user.id, { bio });
  res.json(u);
});

api.get('/users/:id', (req, res) => {
  const u = db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const products = db.listProducts({ sellerId: u.id, status: 'active', limit: 50 });
  res.json({ user: { id: u.id, username: u.username, first_name: u.first_name, photo_url: u.photo_url, bio: u.bio, rating: u.rating, rating_count: u.rating_count, deals_count: u.deals_count, created_at: u.created_at }, products });
});

// ============ CATALOG (products) ============
api.get('/products', (req, res) => {
  const { category, q, sort, sellerId } = req.query;
  const items = db.listProducts({
    category: validCat(category) ? category : undefined,
    q: str(q, 100),
    sort: str(sort, 20) || 'new',
    sellerId: sellerId ? num(sellerId) : undefined,
    minPrice: req.query.minPrice != null && req.query.minPrice !== '' ? num(req.query.minPrice) : undefined,
    maxPrice: req.query.maxPrice != null && req.query.maxPrice !== '' ? num(req.query.maxPrice) : undefined,
    status: 'active',
    limit: Math.min(num(req.query.limit) || 50, 100),
    offset: num(req.query.offset),
  });
  res.json(items);
});

api.get('/products/mine', (req, res) => {
  res.json(db.listProducts({ sellerId: req.user.id, status: 'all', limit: 100 }));
});

api.get('/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  db.incProductViews(p.id);
  res.json(p);
});

api.post('/products', (req, res) => {
  const category = str(req.body.category, 20);
  const title = str(req.body.title, 120);
  const description = str(req.body.description, 4000);
  const price = num(req.body.price);
  if (!validCat(category)) return bad(res, 'Некорректная категория');
  if (title.length < 3) return bad(res, 'Слишком короткое название');
  if (price < 0) return bad(res, 'Цена не может быть отрицательной');
  const p = db.createProduct({ seller_id: req.user.id, category, title, description, price });
  res.status(201).json(p);
});

api.patch('/products/:id/status', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const status = str(req.body.status, 20);
  if (!['active', 'hidden'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(db.updateProductStatus(p.id, status));
});

api.delete('/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.deleteProduct(p.id);
  res.json({ ok: true });
});

// ============ EXCHANGE (requests) ============
api.get('/requests', (req, res) => {
  const { category, q } = req.query;
  res.json(
    db.listRequests({
      category: validCat(category) ? category : undefined,
      q: str(q, 100),
      status: 'active',
      limit: Math.min(num(req.query.limit) || 50, 100),
      offset: num(req.query.offset),
    })
  );
});

api.get('/requests/mine', (req, res) => {
  res.json(db.listRequests({ buyerId: req.user.id, status: 'all', limit: 100 }));
});

api.get('/requests/:id', (req, res) => {
  const r = db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});

api.post('/requests', (req, res) => {
  const category = str(req.body.category, 20);
  const title = str(req.body.title, 120);
  const description = str(req.body.description, 4000);
  const budget = num(req.body.budget);
  if (!validCat(category)) return bad(res, 'Некорректная категория');
  if (title.length < 3) return bad(res, 'Слишком короткое название');
  if (budget < 0) return bad(res, 'Бюджет не может быть отрицательным');
  const r = db.createRequest({ buyer_id: req.user.id, category, title, description, budget });
  res.status(201).json(r);
});

api.patch('/requests/:id/status', (req, res) => {
  const r = db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.buyer_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const status = str(req.body.status, 20);
  if (!['active', 'closed'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(db.setRequestStatus(r.id, status));
});

api.delete('/requests/:id', (req, res) => {
  const r = db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.buyer_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.deleteRequest(r.id);
  res.json({ ok: true });
});

// ============ CHATS ============
api.get('/chats', (req, res) => {
  res.json(db.listChats(req.user.id));
});

api.get('/unread', (req, res) => {
  res.json({ unread: db.countUnread(req.user.id) });
});

// Открыть/создать чат с пользователем
api.post('/chats', (req, res) => {
  const targetId = num(req.body.targetId);
  const productId = num(req.body.productId);
  if (!targetId) return bad(res, 'Не указан собеседник');
  if (targetId === req.user.id) return bad(res, 'Нельзя написать самому себе');
  const target = db.getUser(targetId);
  if (!target) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const chat = db.getOrCreateChat(req.user.id, targetId, productId);
  res.json({
    id: chat.id,
    product_id: chat.product_id,
    other: { id: target.id, username: target.username, first_name: target.first_name, photo_url: target.photo_url },
  });
});

function chatMeta(chat, uid) {
  const otherId = chat.a_id === uid ? chat.b_id : chat.a_id;
  const other = db.getUser(otherId) || { id: otherId, first_name: 'Пользователь' };
  let product = null;
  if (chat.product_id) product = db.getProduct(chat.product_id) || null;
  return {
    id: chat.id,
    product,
    other: { id: other.id, username: other.username, first_name: other.first_name, photo_url: other.photo_url },
  };
}

api.get('/chats/:id/messages', (req, res) => {
  const chat = db.getChatById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!db.isChatMember(chat, req.user.id)) return res.status(403).json({ error: 'forbidden' });
  const sinceId = num(req.query.sinceId);
  const messages = db.listMessages(chat.id, sinceId);
  db.markRead(chat.id, req.user.id);
  res.json({ chat: chatMeta(chat, req.user.id), messages });
});

api.post('/chats/:id/messages', (req, res) => {
  const chat = db.getChatById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!db.isChatMember(chat, req.user.id)) return res.status(403).json({ error: 'forbidden' });
  const text = str(req.body.text, 4000);
  if (!text) return bad(res, 'Пустое сообщение');
  const msg = db.sendMessage(chat.id, req.user.id, text);
  res.status(201).json(msg);
});

// ============ DEALS ============
api.get('/deals', (req, res) => {
  const role = ['buyer', 'seller', 'all'].includes(req.query.role) ? req.query.role : 'all';
  res.json(db.listDeals(req.user.id, role));
});

api.get('/deals/:id', (req, res) => {
  const d = db.getDeal(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (d.buyer_id !== req.user.id && d.seller_id !== req.user.id)
    return res.status(403).json({ error: 'forbidden' });
  res.json(d);
});

api.post('/deals', (req, res) => {
  const productId = num(req.body.productId);
  const p = db.getProduct(productId);
  if (!p) return res.status(404).json({ error: 'not_found', message: 'Товар не найден' });
  if (p.seller_id === req.user.id) return bad(res, 'Нельзя купить свой товар');
  if (p.status !== 'active') return bad(res, 'Товар недоступен');
  const deal = db.createDeal({ product: p, buyer_id: req.user.id });
  // Автоматически открываем чат с продавцом по этому товару
  db.getOrCreateChat(req.user.id, p.seller_id, p.id);
  res.status(201).json(deal);
});

// Разрешённые переходы статусов и кто их может делать
const DEAL_TRANSITIONS = {
  paid: { from: ['pending'], roles: ['buyer'] },
  completed: { from: ['pending', 'paid'], roles: ['buyer'] },
  cancelled: { from: ['pending', 'paid'], roles: ['buyer', 'seller'] },
  disputed: { from: ['pending', 'paid'], roles: ['buyer', 'seller'] },
};

api.patch('/deals/:id', (req, res) => {
  const d = db.getDeal(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const role = d.buyer_id === req.user.id ? 'buyer' : d.seller_id === req.user.id ? 'seller' : null;
  if (!role) return res.status(403).json({ error: 'forbidden' });

  const status = str(req.body.status, 20);
  const rule = DEAL_TRANSITIONS[status];
  if (!rule) return bad(res, 'Недопустимый статус');
  if (!rule.roles.includes(role)) return res.status(403).json({ error: 'forbidden', message: 'Нет прав на это действие' });
  if (!rule.from.includes(d.status)) return bad(res, `Нельзя перейти из «${d.status}» в «${status}»`);

  const updated = db.updateDealStatus(d.id, status);
  // Оценка продавца при завершении сделки
  if (status === 'completed' && role === 'buyer' && req.body.rating) {
    db.addRating(d.seller_id, num(req.body.rating));
  }
  res.json(updated);
});

// ============ ADMIN ============
const admin = express.Router();
admin.use(adminOnly);

admin.get('/stats', (req, res) => res.json(db.adminStats()));

admin.get('/users', (req, res) => {
  res.json(db.listUsers({ q: str(req.query.q, 100), limit: Math.min(num(req.query.limit) || 100, 200), offset: num(req.query.offset) }));
});

admin.post('/users/:id/ban', (req, res) => {
  const banned = req.body.banned ? 1 : 0;
  const u = db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json(db.setBanned(u.id, banned));
});

admin.get('/products', (req, res) => {
  res.json(db.listProducts({ q: str(req.query.q, 100), status: str(req.query.status, 20) || 'all', limit: Math.min(num(req.query.limit) || 100, 200), offset: num(req.query.offset) }));
});

admin.patch('/products/:id/status', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const status = str(req.body.status, 20);
  if (!['active', 'hidden', 'sold'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(db.updateProductStatus(p.id, status));
});

admin.delete('/products/:id', (req, res) => {
  db.deleteProduct(req.params.id);
  res.json({ ok: true });
});

admin.get('/requests', (req, res) => {
  res.json(db.listRequests({ q: str(req.query.q, 100), status: str(req.query.status, 20) || 'all', limit: 200 }));
});

admin.delete('/requests/:id', (req, res) => {
  db.deleteRequest(req.params.id);
  res.json({ ok: true });
});

admin.get('/deals', (req, res) => {
  // Все сделки для админа
  const rows = db.db
    .prepare(
      `SELECT d.*, b.first_name AS buyer_name, b.username AS buyer_username,
              s.first_name AS seller_name, s.username AS seller_username
       FROM deals d JOIN users b ON b.id=d.buyer_id JOIN users s ON s.id=d.seller_id
       ORDER BY d.created_at DESC LIMIT 200`
    )
    .all();
  res.json(rows);
});

admin.patch('/deals/:id', (req, res) => {
  const status = str(req.body.status, 20);
  if (!['pending', 'paid', 'completed', 'cancelled', 'disputed'].includes(status))
    return bad(res, 'Недопустимый статус');
  const d = db.updateDealStatus(req.params.id, status);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json(d);
});

api.use('/admin', admin);
