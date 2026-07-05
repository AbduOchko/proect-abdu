import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authMiddleware, adminOnly } from './auth.js';
import { config, CATEGORY_KEYS, CATEGORIES, isAdminId } from './config.js';
import * as db from './db.js';
import { notifyUser } from './notify.js';

export const api = express.Router();

// ---- helpers ----
const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const validCat = (c) => CATEGORY_KEYS.includes(c);
const fmtMoney = (n) => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
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
// Помечает товары флагом is_favorite для текущего пользователя
function withFavorites(items, userId) {
  const favIds = db.getFavoriteIds(userId);
  const arr = Array.isArray(items) ? items : [items];
  for (const p of arr) if (p) p.is_favorite = favIds.has(p.id);
  return items;
}

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
  res.json(withFavorites(items, req.user.id));
});

// Кол-во активных товаров по категориям (для счётчиков на чипах каталога)
api.get('/products/counts', (req, res) => {
  res.json(db.productCategoryCounts(str(req.query.q, 100)));
});

api.get('/products/mine', (req, res) => {
  res.json(db.listProducts({ sellerId: req.user.id, status: 'all', limit: 100 }));
});

api.get('/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  db.incProductViews(p.id);
  res.json(withFavorites(p, req.user.id));
});

// ============ FAVORITES (избранное) ============
api.get('/favorites', (req, res) => {
  res.json(withFavorites(db.listFavoriteProducts(req.user.id), req.user.id));
});

api.post('/products/:id/favorite', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const favorited = db.toggleFavorite(req.user.id, p.id);
  res.json({ favorited });
});

// Разбор и валидация полей товара (общая для создания и редактирования)
function parseProductBody(body) {
  const category = str(body.category, 20);
  const title = str(body.title, 120);
  const description = str(body.description, 4000);
  const price = num(body.price);
  if (!validCat(category)) return { error: 'Некорректная категория' };
  if (title.length < 3) return { error: 'Слишком короткое название' };
  if (price < 0) return { error: 'Цена не может быть отрицательной' };
  const isChannel = category === 'channel'; // доп. поля храним только для каналов
  const genres = isChannel && Array.isArray(body.genres)
    ? body.genres.map((g) => str(g, 30)).filter(Boolean).slice(0, 12) : [];
  const screenshots = isChannel && Array.isArray(body.screenshots)
    ? body.screenshots.filter((u) => typeof u === 'string' && u.startsWith('/uploads/')).slice(0, 8) : [];
  const avatar = typeof body.avatar === 'string' && body.avatar.startsWith('/uploads/') ? body.avatar : '';
  return { fields: {
    category, title, description, price, genres,
    subscribers: isChannel ? Math.max(0, num(body.subscribers)) : 0,
    reach24: isChannel ? Math.max(0, num(body.reach24)) : 0,
    avg_age: isChannel ? str(body.avg_age, 40) : '',
    screenshots, avatar,
  } };
}

api.post('/products', (req, res) => {
  const r = parseProductBody(req.body);
  if (r.error) return bad(res, r.error);
  res.status(201).json(db.createProduct({ seller_id: req.user.id, ...r.fields }));
});

// Редактирование товара (только владелец)
api.put('/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const r = parseProductBody(req.body);
  if (r.error) return bad(res, r.error);
  res.json(db.updateProduct(p.id, r.fields));
});

// Загрузка изображения (data URL -> файл в /uploads)
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
api.post('/upload', (req, res) => {
  const dataUrl = String(req.body.image || '');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return bad(res, 'Некорректное изображение');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return bad(res, 'Пустой файл');
  if (buf.length > 3 * 1024 * 1024) return bad(res, 'Файл слишком большой (макс. 3 МБ)');
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${MIME_EXT[m[1]]}`;
  try {
    fs.writeFileSync(path.join(config.uploadsDir, name), buf);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'Не удалось сохранить файл' });
  }
  res.status(201).json({ url: '/uploads/' + name });
});

api.patch('/products/:id/status', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (p.status === 'reserved') return bad(res, 'Товар участвует в активной сделке');
  const status = str(req.body.status, 20);
  if (!['active', 'hidden'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(db.updateProductStatus(p.id, status));
});

api.delete('/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (p.status === 'reserved') return bad(res, 'Нельзя удалить товар с активной сделкой');
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

// ============ DEALS (эскроу) ============
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

// Помощник: загрузить сделку и определить роль текущего пользователя
function loadDeal(req, res) {
  const d = db.getDeal(req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return null; }
  const role = d.buyer_id === req.user.id ? 'buyer' : d.seller_id === req.user.id ? 'seller' : null;
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { d, role };
}

// Покупка: оплата с баланса (заморозка средств) -> сделка «Сделка создана»
api.post('/deals', (req, res) => {
  const p = db.getProduct(num(req.body.productId));
  if (!p) return res.status(404).json({ error: 'not_found', message: 'Товар не найден' });
  if (p.seller_id === req.user.id) return bad(res, 'Нельзя купить свой товар');
  if (p.status !== 'active') return bad(res, 'Товар недоступен');
  if (!p.price || p.price <= 0) return bad(res, 'У товара договорная цена — оформите сделку через продавца в чате');
  const r = db.createEscrowDeal(p, req.user.id);
  if (r.error === 'unavailable') return bad(res, 'Товар уже недоступен (продан или в сделке)');
  if (r.error === 'insufficient') {
    return res.status(400).json({ error: 'insufficient_funds', message: 'Недостаточно средств. Пополните баланс в профиле.' });
  }
  db.getOrCreateChat(req.user.id, p.seller_id, p.id);
  notifyUser(p.seller_id, `🛒 <b>Новая сделка</b> по «${p.title}» на ${fmtMoney(r.deal.amount)}.\nСредства покупателя заморожены. У вас <b>24 часа</b>, чтобы подтвердить сделку в приложении.`);
  res.status(201).json(r.deal);
});

// Продавец подтверждает сделку -> «В процессе»
api.post('/deals/:id/confirm', (req, res) => {
  const ld = loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'seller') return res.status(403).json({ error: 'forbidden', message: 'Только продавец' });
  if (d.status !== 'created') return bad(res, 'Сделку сейчас нельзя подтвердить');
  const updated = db.sellerConfirmDeal(d.id);
  notifyUser(d.buyer_id, `✅ Продавец подтвердил сделку по «${d.title}». Статус: «В процессе». У продавца <b>24 часа</b> на передачу товара.`);
  res.json(updated);
});

// Продавец передал товар -> «На проверке»
api.post('/deals/:id/deliver', (req, res) => {
  const ld = loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'seller') return res.status(403).json({ error: 'forbidden', message: 'Только продавец' });
  if (d.status !== 'in_progress') return bad(res, 'Сейчас нельзя передать на проверку');
  const updated = db.sellerDeliverDeal(d.id);
  notifyUser(d.buyer_id, `📦 Продавец передал товар по «${d.title}». Проверьте и нажмите «Подтвердить получение». Через <b>7 дней</b> сделка завершится автоматически.`);
  res.json(updated);
});

// Покупатель подтверждает получение -> «Завершена», деньги продавцу
api.post('/deals/:id/complete', (req, res) => {
  const ld = loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'buyer') return res.status(403).json({ error: 'forbidden', message: 'Только покупатель' });
  if (d.status !== 'review') return bad(res, 'Сейчас нельзя подтвердить получение');
  const rating = Math.max(0, Math.min(5, num(req.body.rating)));
  const comment = str(req.body.comment, 1000);
  if (!rating) return bad(res, 'Поставьте оценку от 1 до 5 звёзд');
  if (comment.length < 3) return bad(res, 'Напишите комментарий к отзыву (минимум 3 символа)');
  const updated = db.completeDeal(d.id, {}); // рейтинг добавит отзыв ниже
  db.addReview({ dealId: d.id, buyerId: d.buyer_id, sellerId: d.seller_id, productId: d.product_id, stars: rating, comment });
  notifyUser(d.seller_id, `🎉 Покупатель подтвердил получение по «${d.title}» и оставил отзыв (${rating}★). На баланс зачислено ${fmtMoney(d.amount)}.`);
  res.json(updated);
});

// Отзывы о продавце
api.get('/reviews', (req, res) => {
  const sellerId = num(req.query.sellerId);
  if (!sellerId) return res.json([]);
  res.json(db.listSellerReviews(sellerId, 20));
});

// Отмена сделки (правила из эскроу)
api.post('/deals/:id/cancel', (req, res) => {
  const ld = loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  let allowed = false;
  if (role === 'seller' && ['created', 'in_progress'].includes(d.status)) allowed = true;
  else if (role === 'buyer' && d.status === 'in_progress' && d.overdue) allowed = true;
  if (!allowed) {
    return bad(res, role === 'buyer'
      ? 'Отменить можно только после просрочки передачи товара, либо через спор.'
      : 'Сейчас отменить сделку нельзя.');
  }
  const updated = db.cancelDeal(d.id, { note: role === 'seller' ? 'Отменено продавцом' : 'Отменено покупателем (просрочка передачи)' });
  const other = role === 'seller' ? d.buyer_id : d.seller_id;
  notifyUser(other, `❌ Сделка по «${d.title}» отменена. Средства возвращены покупателю на баланс.`);
  res.json(updated);
});

// Открыть спор
api.post('/deals/:id/dispute', (req, res) => {
  const ld = loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (!['created', 'in_progress', 'review'].includes(d.status)) return bad(res, 'Спор сейчас открыть нельзя');
  const updated = db.disputeDeal(d.id);
  const other = role === 'buyer' ? d.seller_id : d.buyer_id;
  notifyUser(other, `⚠️ По сделке «${d.title}» открыт спор. Решение примет администратор.`);
  res.json(updated);
});

// ============ BALANCE / WITHDRAWALS ============
api.get('/transactions', (req, res) => res.json(db.listTransactions(req.user.id, 50)));

// Демо-пополнение баланса
api.post('/balance/topup', (req, res) => {
  const amount = Math.floor(num(req.body.amount));
  if (amount <= 0) return bad(res, 'Некорректная сумма');
  if (amount > 1000000) return bad(res, 'Слишком большая сумма (демо-лимит 1 000 000 ₽)');
  const balance = db.deposit(req.user.id, amount);
  res.json({ balance });
});

api.get('/withdrawals', (req, res) => res.json(db.listUserWithdrawals(req.user.id)));

api.post('/withdrawals', (req, res) => {
  const amount = Math.floor(num(req.body.amount));
  const requisites = str(req.body.requisites, 200);
  if (amount <= 0) return bad(res, 'Некорректная сумма');
  const r = db.createWithdrawal(req.user.id, amount, requisites);
  if (r.error === 'insufficient') return res.status(400).json({ error: 'insufficient_funds', message: 'Недостаточно средств на балансе' });
  if (r.error === 'amount') return bad(res, 'Некорректная сумма');
  res.status(201).json(r.withdrawal);
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

// Решение спора / принудительное закрытие сделки админом
admin.post('/deals/:id/resolve', (req, res) => {
  const outcome = str(req.body.outcome, 20); // 'release' -> продавцу, 'refund' -> покупателю
  if (!['release', 'refund'].includes(outcome)) return bad(res, 'Некорректное решение');
  const d = db.getDeal(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (!['disputed', 'created', 'in_progress', 'review'].includes(d.status)) return bad(res, 'Сделка уже закрыта');
  const updated = db.resolveDispute(d.id, outcome);
  const msg = outcome === 'release' ? 'в пользу продавца (выплата)' : 'возврат покупателю';
  notifyUser(d.buyer_id, `⚖️ Спор по «${d.title}» решён: ${msg}.`);
  notifyUser(d.seller_id, `⚖️ Спор по «${d.title}» решён: ${msg}.`);
  res.json(updated);
});

// Заявки на вывод
admin.get('/withdrawals', (req, res) => res.json(db.listWithdrawals(str(req.query.status, 20) || 'all')));

admin.post('/withdrawals/:id/approve', (req, res) => {
  const w = db.approveWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  notifyUser(w.user_id, `💸 Заявка на вывод ${fmtMoney(w.amount)} одобрена.`);
  res.json(w);
});

admin.post('/withdrawals/:id/reject', (req, res) => {
  const w = db.rejectWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  notifyUser(w.user_id, `↩️ Заявка на вывод ${fmtMoney(w.amount)} отклонена, средства возвращены на баланс.`);
  res.json(w);
});

// Корректировка баланса пользователя админом
admin.post('/users/:id/balance', (req, res) => {
  const u = db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const delta = num(req.body.delta);
  if (!delta) return bad(res, 'Укажите сумму (можно со знаком минус)');
  if (delta < 0 && db.getBalance(u.id) + delta < 0) return bad(res, 'Баланс не может стать отрицательным');
  const balance = db.balanceTx(u.id, delta, delta > 0 ? 'deposit' : 'withdraw_done', { note: 'Корректировка администратором' });
  res.json({ balance });
});

api.use('/admin', admin);
