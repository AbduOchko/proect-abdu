import 'express-async-errors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authMiddleware, adminOnly } from './auth.js';
import { config, CATEGORY_KEYS, CATEGORIES, isAdminId } from './config.js';
import * as db from './db.js';
import { notifyUser, escHtml } from './notify.js';

export const api = express.Router();

// ---- helpers ----
const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Как num(), но для необязательных фильтров: некорректное значение отбрасывается (undefined),
// а не превращается в 0 — иначе, например, ?maxPrice=abc молча отфильтровал бы все товары с ценой.
const numOrUndef = (v) => {
  if (v == null || String(v).trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
// limit: отсутствующее/некорректное значение -> дефолт; явные 0 и отрицательные — не то же самое,
// что "не указано" (0 || def в JS дал бы def) — всегда клэмпим в [0, max], чтобы отрицательное
// значение не долетело до SQL LIMIT/OFFSET (Postgres иначе падает с ошибкой на весь запрос).
const clampLimit = (v, def, max) => {
  if (v == null || String(v).trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), max) : def;
};
const clampOffset = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(Math.floor(n), 0) : 0;
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

api.get('/me', async (req, res) => {
  const u = await db.getUser(req.user.id);
  res.json({
    ...u,
    is_admin: isAdminId(u.id) ? 1 : 0,
    unread: await db.countUnread(u.id),
  });
});

api.patch('/me', async (req, res) => {
  const bio = str(req.body.bio, 500);
  const u = await db.updateProfile(req.user.id, { bio });
  res.json(u);
});

// ============ РЕГИСТРАЦИЯ (обязательная анкета при первом входе) ============
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_LOGIN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

api.post('/register', async (req, res) => {
  if (req.user.registered) return bad(res, 'Вы уже зарегистрированы');

  const email = str(req.body.email, 190).toLowerCase();
  const login = str(req.body.login, 20);
  const phoneDigits = str(req.body.phone, 40).replace(/[^\d+]/g, '');
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  if (!RE_EMAIL.test(email)) return bad(res, 'Введите корректный email');
  if (phoneDigits.replace('+', '').length < 10) return bad(res, 'Введите корректный номер телефона');
  if (!RE_LOGIN.test(login)) return bad(res, 'Логин: 3-20 символов, латиница/цифры/_, должен начинаться с буквы');
  if (password.length < 8) return bad(res, 'Пароль должен быть не короче 8 символов');
  if (password !== password2) return bad(res, 'Пароли не совпадают');

  try {
    const u = await db.registerUser(req.user.id, { email, phone: phoneDigits, login, passwordHash: hashPassword(password) });
    res.json({ ...u, is_admin: isAdminId(u.id) ? 1 : 0, unread: await db.countUnread(u.id) });
  } catch (e) {
    if (e.code === 'login_taken') return bad(res, e.message);
    throw e;
  }
});

api.get('/users/:id', async (req, res) => {
  const u = await db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const products = await db.listProducts({ sellerId: u.id, status: 'active', limit: 50 });
  res.json({ user: { id: u.id, username: u.username, first_name: u.first_name, photo_url: u.photo_url, bio: u.bio, rating: u.rating, rating_count: u.rating_count, deals_count: u.deals_count, created_at: u.created_at }, products });
});

// ============ CATALOG (products) ============
// Помечает товары флагом is_favorite для текущего пользователя
async function withFavorites(items, userId) {
  const favIds = await db.getFavoriteIds(userId);
  const arr = Array.isArray(items) ? items : [items];
  for (const p of arr) if (p) p.is_favorite = favIds.has(p.id);
  return items;
}

api.get('/products', async (req, res) => {
  const { category, q, sort, sellerId } = req.query;
  const items = await db.listProducts({
    category: validCat(category) ? category : undefined,
    q: str(q, 100),
    sort: str(sort, 20) || 'new',
    sellerId: sellerId ? num(sellerId) : undefined,
    minPrice: numOrUndef(req.query.minPrice),
    maxPrice: numOrUndef(req.query.maxPrice),
    status: 'active',
    limit: clampLimit(req.query.limit, 50, 100),
    offset: clampOffset(req.query.offset),
  });
  res.json(await withFavorites(items, req.user.id));
});

// Кол-во активных товаров по категориям (для счётчиков на чипах каталога)
api.get('/products/counts', async (req, res) => {
  res.json(await db.productCategoryCounts(str(req.query.q, 100)));
});

api.get('/products/mine', async (req, res) => {
  res.json(await db.listProducts({ sellerId: req.user.id, status: 'all', limit: 100 }));
});

api.get('/products/:id', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  await db.incProductViews(p.id);
  res.json(await withFavorites(p, req.user.id));
});

// ============ FAVORITES (избранное) ============
api.get('/favorites', async (req, res) => {
  res.json(await withFavorites(await db.listFavoriteProducts(req.user.id), req.user.id));
});

api.post('/products/:id/favorite', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const favorited = await db.toggleFavorite(req.user.id, p.id);
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

api.post('/products', async (req, res) => {
  const r = parseProductBody(req.body);
  if (r.error) return bad(res, r.error);
  res.status(201).json(await db.createProduct({ seller_id: req.user.id, ...r.fields }));
});

// Редактирование товара (только владелец)
api.put('/products/:id', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const r = parseProductBody(req.body);
  if (r.error) return bad(res, r.error);
  const updated = await db.updateProduct(p.id, r.fields);
  // Подчищаем файлы старых скриншотов/аватара, которых больше нет в новом наборе
  const keep = new Set([r.fields.avatar, ...(r.fields.screenshots || [])].filter(Boolean));
  if (p.avatar && !keep.has(p.avatar)) deleteUploadedFile(p.avatar);
  (p.screenshots || []).forEach((url) => { if (!keep.has(url)) deleteUploadedFile(url); });
  res.json(updated);
});

// Удаляет физический файл в /uploads по его публичному URL — используется при удалении товара
// и при замене скриншотов/аватара на редактировании, иначе диск (Volume на Railway) растёт
// бесконечно, т.к. старые файлы никогда не отвязывались от товара.
function deleteUploadedFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  fs.unlink(path.join(config.uploadsDir, path.basename(url)), () => {});
}

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

api.patch('/products/:id/status', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  // Переключать сам продавец может только между active/hidden, и только если товар сейчас
  // в одном из этих статусов — иначе проданный/зарезервированный товар можно было бы
  // "вернуть в продажу" после того, как по нему уже прошла сделка.
  if (!['active', 'hidden'].includes(p.status)) return bad(res, 'Нельзя изменить статус этого товара');
  const status = str(req.body.status, 20);
  if (!['active', 'hidden'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(await db.updateProductStatus(p.id, status));
});

api.delete('/products/:id', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (p.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const deleted = await db.deleteProduct(p.id);
  if (!deleted) return bad(res, 'Нельзя удалить товар с активной сделкой');
  deleteUploadedFile(p.avatar);
  (p.screenshots || []).forEach(deleteUploadedFile);
  res.json({ ok: true });
});

// ============ EXCHANGE (requests) ============
api.get('/requests', async (req, res) => {
  const { category, q } = req.query;
  res.json(
    await db.listRequests({
      category: validCat(category) ? category : undefined,
      q: str(q, 100),
      status: 'active',
      limit: clampLimit(req.query.limit, 50, 100),
      offset: clampOffset(req.query.offset),
    })
  );
});

api.get('/requests/mine', async (req, res) => {
  res.json(await db.listRequests({ buyerId: req.user.id, status: 'all', limit: 100 }));
});

api.get('/requests/:id', async (req, res) => {
  const r = await db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});

api.post('/requests', async (req, res) => {
  const category = str(req.body.category, 20);
  const title = str(req.body.title, 120);
  const description = str(req.body.description, 4000);
  const budget = num(req.body.budget);
  if (!validCat(category)) return bad(res, 'Некорректная категория');
  if (title.length < 3) return bad(res, 'Слишком короткое название');
  if (budget < 0) return bad(res, 'Бюджет не может быть отрицательным');
  const r = await db.createRequest({ buyer_id: req.user.id, category, title, description, budget });
  res.status(201).json(r);
});

api.patch('/requests/:id/status', async (req, res) => {
  const r = await db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.buyer_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const status = str(req.body.status, 20);
  if (!['active', 'closed'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(await db.setRequestStatus(r.id, status));
});

api.delete('/requests/:id', async (req, res) => {
  const r = await db.getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.buyer_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  await db.deleteRequest(r.id);
  res.json({ ok: true });
});

// ============ CHATS ============
api.get('/chats', async (req, res) => {
  res.json(await db.listChats(req.user.id));
});

api.get('/unread', async (req, res) => {
  res.json({ unread: await db.countUnread(req.user.id) });
});

// Открыть/создать чат с пользователем
api.post('/chats', async (req, res) => {
  const targetId = num(req.body.targetId);
  const productId = num(req.body.productId);
  if (!targetId) return bad(res, 'Не указан собеседник');
  if (targetId === req.user.id) return bad(res, 'Нельзя написать самому себе');
  const target = await db.getUser(targetId);
  if (!target) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const chat = await db.getOrCreateChat(req.user.id, targetId, productId);
  res.json({
    id: chat.id,
    product_id: chat.product_id,
    other: { id: target.id, username: target.username, first_name: target.first_name, photo_url: target.photo_url },
  });
});

async function chatMeta(chat, uid) {
  const otherId = Number(chat.a_id) === uid ? chat.b_id : chat.a_id;
  const other = (await db.getUser(otherId)) || { id: otherId, first_name: 'Пользователь' };
  let product = null;
  if (chat.product_id) product = (await db.getProduct(chat.product_id)) || null;
  return {
    id: chat.id,
    product,
    other: { id: other.id, username: other.username, first_name: other.first_name, photo_url: other.photo_url },
  };
}

api.get('/chats/:id/messages', async (req, res) => {
  const chat = await db.getChatById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!db.isChatMember(chat, req.user.id)) return res.status(403).json({ error: 'forbidden' });
  const sinceId = num(req.query.sinceId);
  const messages = await db.listMessages(chat.id, sinceId);
  await db.markRead(chat.id, req.user.id);
  res.json({ chat: await chatMeta(chat, req.user.id), messages });
});

api.post('/chats/:id/messages', async (req, res) => {
  const chat = await db.getChatById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!db.isChatMember(chat, req.user.id)) return res.status(403).json({ error: 'forbidden' });
  const text = str(req.body.text, 4000);
  if (!text) return bad(res, 'Пустое сообщение');
  const msg = await db.sendMessage(chat.id, req.user.id, text);
  res.status(201).json(msg);
});

// ============ DEALS (эскроу) ============
api.get('/deals', async (req, res) => {
  const role = ['buyer', 'seller', 'all'].includes(req.query.role) ? req.query.role : 'all';
  res.json(await db.listDeals(req.user.id, role));
});

api.get('/deals/:id', async (req, res) => {
  const d = await db.getDeal(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (d.buyer_id !== req.user.id && d.seller_id !== req.user.id)
    return res.status(403).json({ error: 'forbidden' });
  res.json(d);
});

// Помощник: загрузить сделку и определить роль текущего пользователя
async function loadDeal(req, res) {
  const d = await db.getDeal(req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return null; }
  const role = Number(d.buyer_id) === req.user.id ? 'buyer' : Number(d.seller_id) === req.user.id ? 'seller' : null;
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { d, role };
}

// Покупка: оплата с баланса (заморозка средств) -> сделка «Сделка создана»
api.post('/deals', async (req, res) => {
  const p = await db.getProduct(num(req.body.productId));
  if (!p) return res.status(404).json({ error: 'not_found', message: 'Товар не найден' });
  if (p.seller_id === req.user.id) return bad(res, 'Нельзя купить свой товар');
  if (p.status !== 'active') return bad(res, 'Товар недоступен');
  if (!p.price || p.price <= 0) return bad(res, 'У товара договорная цена — оформите сделку через продавца в чате');
  const r = await db.createEscrowDeal(p, req.user.id);
  if (r.error === 'unavailable') return bad(res, 'Товар уже недоступен (продан или в сделке)');
  if (r.error === 'insufficient') {
    return res.status(400).json({ error: 'insufficient_funds', message: 'Недостаточно средств. Пополните баланс в профиле.' });
  }
  await db.getOrCreateChat(req.user.id, p.seller_id, p.id);
  notifyUser(p.seller_id, `🛒 <b>Новая сделка</b> по «${escHtml(p.title)}» на ${fmtMoney(r.deal.amount)}.\nСредства покупателя заморожены. У вас <b>24 часа</b>, чтобы подтвердить сделку в приложении.`);
  res.status(201).json(r.deal);
});

// Продавец подтверждает сделку -> «В процессе»
api.post('/deals/:id/confirm', async (req, res) => {
  const ld = await loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'seller') return res.status(403).json({ error: 'forbidden', message: 'Только продавец' });
  if (d.status !== 'created') return bad(res, 'Сделку сейчас нельзя подтвердить');
  const updated = await db.sellerConfirmDeal(d.id);
  notifyUser(d.buyer_id, `✅ Продавец подтвердил сделку по «${escHtml(d.title)}». Статус: «В процессе». У продавца <b>24 часа</b> на передачу товара.`);
  res.json(updated);
});

// Продавец передал товар -> «На проверке»
api.post('/deals/:id/deliver', async (req, res) => {
  const ld = await loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'seller') return res.status(403).json({ error: 'forbidden', message: 'Только продавец' });
  if (d.status !== 'in_progress') return bad(res, 'Сейчас нельзя передать на проверку');
  const updated = await db.sellerDeliverDeal(d.id);
  notifyUser(d.buyer_id, `📦 Продавец передал товар по «${escHtml(d.title)}». Проверьте и нажмите «Подтвердить получение». Через <b>7 дней</b> сделка завершится автоматически.`);
  res.json(updated);
});

// Покупатель подтверждает получение -> «Завершена», деньги продавцу
api.post('/deals/:id/complete', async (req, res) => {
  const ld = await loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (role !== 'buyer') return res.status(403).json({ error: 'forbidden', message: 'Только покупатель' });
  if (d.status !== 'review') return bad(res, 'Сейчас нельзя подтвердить получение');
  const rating = Math.max(0, Math.min(5, num(req.body.rating)));
  const comment = str(req.body.comment, 1000);
  if (!rating) return bad(res, 'Поставьте оценку от 1 до 5 звёзд');
  if (comment.length < 3) return bad(res, 'Напишите комментарий к отзыву (минимум 3 символа)');
  const { applied, deal: updated } = await db.completeDeal(d.id, {}); // рейтинг добавит отзыв ниже
  if (!applied) return bad(res, 'Сделка уже была завершена или отменена ранее');
  await db.addReview({ dealId: d.id, buyerId: d.buyer_id, sellerId: d.seller_id, productId: d.product_id, stars: rating, comment });
  notifyUser(d.seller_id, `🎉 Покупатель подтвердил получение по «${escHtml(d.title)}» и оставил отзыв (${rating}★). На баланс зачислено ${fmtMoney(d.amount)}.`);
  res.json(updated);
});

// Отзывы о продавце
api.get('/reviews', async (req, res) => {
  const sellerId = num(req.query.sellerId);
  if (!sellerId) return res.json([]);
  res.json(await db.listSellerReviews(sellerId, 20));
});

// Отмена сделки (правила из эскроу)
api.post('/deals/:id/cancel', async (req, res) => {
  const ld = await loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  let allowed = false;
  if (role === 'seller' && ['created', 'in_progress'].includes(d.status)) allowed = true;
  else if (role === 'buyer' && d.status === 'in_progress' && d.overdue) allowed = true;
  if (!allowed) {
    return bad(res, role === 'buyer'
      ? 'Отменить можно только после просрочки передачи товара, либо через спор.'
      : 'Сейчас отменить сделку нельзя.');
  }
  const { applied, deal: updated } = await db.cancelDeal(d.id, { note: role === 'seller' ? 'Отменено продавцом' : 'Отменено покупателем (просрочка передачи)' });
  if (!applied) return bad(res, 'Сделка уже была завершена или отменена ранее');
  const other = role === 'seller' ? d.buyer_id : d.seller_id;
  notifyUser(other, `❌ Сделка по «${escHtml(d.title)}» отменена. Средства возвращены покупателю на баланс.`);
  res.json(updated);
});

// Открыть спор
api.post('/deals/:id/dispute', async (req, res) => {
  const ld = await loadDeal(req, res); if (!ld) return;
  const { d, role } = ld;
  if (!['created', 'in_progress', 'review'].includes(d.status)) return bad(res, 'Спор сейчас открыть нельзя');
  try {
    const updated = await db.disputeDeal(d.id);
    const other = role === 'buyer' ? d.seller_id : d.buyer_id;
    notifyUser(other, `⚠️ По сделке «${escHtml(d.title)}» открыт спор. Решение примет администратор.`);
    res.json(updated);
  } catch (e) {
    if (e.code === 'invalid_state') return bad(res, 'Спор сейчас открыть нельзя');
    throw e;
  }
});

// ============ BALANCE / WITHDRAWALS ============
api.get('/transactions', async (req, res) => res.json(await db.listTransactions(req.user.id, 50)));

// Демо-пополнение баланса
api.post('/balance/topup', async (req, res) => {
  const amount = Math.floor(num(req.body.amount));
  if (amount <= 0) return bad(res, 'Некорректная сумма');
  if (amount > 1000000) return bad(res, 'Слишком большая сумма (демо-лимит 1 000 000 ₽)');
  const balance = await db.deposit(req.user.id, amount);
  res.json({ balance });
});

api.get('/withdrawals', async (req, res) => res.json(await db.listUserWithdrawals(req.user.id)));

api.post('/withdrawals', async (req, res) => {
  const amount = Math.floor(num(req.body.amount));
  const requisites = str(req.body.requisites, 200);
  if (amount <= 0) return bad(res, 'Некорректная сумма');
  const r = await db.createWithdrawal(req.user.id, amount, requisites);
  if (r.error === 'insufficient') return res.status(400).json({ error: 'insufficient_funds', message: 'Недостаточно средств на балансе' });
  if (r.error === 'amount') return bad(res, 'Некорректная сумма');
  res.status(201).json(r.withdrawal);
});

// ============ ADMIN ============
const admin = express.Router();
admin.use(adminOnly);

admin.get('/stats', async (req, res) => res.json(await db.adminStats()));

admin.get('/users', async (req, res) => {
  res.json(await db.listUsers({ q: str(req.query.q, 100), limit: clampLimit(req.query.limit, 100, 200), offset: clampOffset(req.query.offset) }));
});

admin.post('/users/:id/ban', async (req, res) => {
  const banned = req.body.banned ? 1 : 0;
  const u = await db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  // Забаненный сразу теряет доступ ко всем /api-маршрутам (включая свои же admin-маршруты) —
  // без этой защиты админ мог бы случайно заблокировать себя (или последнего другого админа)
  // и остаться без возможности снять бан изнутри приложения.
  if (banned && isAdminId(u.id)) return bad(res, 'Нельзя заблокировать администратора');
  res.json(await db.setBanned(u.id, banned));
});

admin.get('/products', async (req, res) => {
  res.json(await db.listProducts({ q: str(req.query.q, 100), status: str(req.query.status, 20) || 'all', limit: clampLimit(req.query.limit, 100, 200), offset: clampOffset(req.query.offset) }));
});

admin.patch('/products/:id/status', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  // Та же защита, что и в маршруте продавца: показать/скрыть можно только товар, который
  // сейчас active/hidden — иначе можно было бы вернуть в продажу уже проданный (sold) или
  // зарезервированный под сделку товар (Скрыть -> Показать в панели админа).
  if (!['active', 'hidden'].includes(p.status)) return bad(res, 'Нельзя изменить статус этого товара');
  const status = str(req.body.status, 20);
  if (!['active', 'hidden'].includes(status)) return bad(res, 'Недопустимый статус');
  res.json(await db.updateProductStatus(p.id, status));
});

admin.delete('/products/:id', async (req, res) => {
  const p = await db.getProduct(req.params.id);
  const deleted = await db.deleteProduct(req.params.id);
  if (!deleted) return bad(res, 'Нельзя удалить товар с активной сделкой');
  if (p) { deleteUploadedFile(p.avatar); (p.screenshots || []).forEach(deleteUploadedFile); }
  res.json({ ok: true });
});

admin.get('/requests', async (req, res) => {
  res.json(await db.listRequests({ q: str(req.query.q, 100), status: str(req.query.status, 20) || 'all', limit: 200 }));
});

admin.delete('/requests/:id', async (req, res) => {
  await db.deleteRequest(req.params.id);
  res.json({ ok: true });
});

admin.get('/deals', async (req, res) => {
  res.json(await db.listAllDeals(200));
});

// Решение спора / принудительное закрытие сделки админом
admin.post('/deals/:id/resolve', async (req, res) => {
  const outcome = str(req.body.outcome, 20); // 'release' -> продавцу, 'refund' -> покупателю
  if (!['release', 'refund'].includes(outcome)) return bad(res, 'Некорректное решение');
  const d = await db.getDeal(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (!['disputed', 'created', 'in_progress', 'review'].includes(d.status)) return bad(res, 'Сделка уже закрыта');
  const { applied, deal: updated } = await db.resolveDispute(d.id, outcome);
  if (!applied) return bad(res, 'Сделка уже была закрыта другим способом');
  const msg = outcome === 'release' ? 'в пользу продавца (выплата)' : 'возврат покупателю';
  notifyUser(d.buyer_id, `⚖️ Спор по «${escHtml(d.title)}» решён: ${msg}.`);
  notifyUser(d.seller_id, `⚖️ Спор по «${escHtml(d.title)}» решён: ${msg}.`);
  res.json(updated);
});

// Заявки на вывод
admin.get('/withdrawals', async (req, res) => res.json(await db.listWithdrawals(str(req.query.status, 20) || 'all')));

admin.post('/withdrawals/:id/approve', async (req, res) => {
  const { applied, withdrawal: w } = await db.approveWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  if (!applied) return bad(res, 'Заявка уже была обработана');
  notifyUser(w.user_id, `💸 Заявка на вывод ${fmtMoney(w.amount)} одобрена.`);
  res.json(w);
});

admin.post('/withdrawals/:id/reject', async (req, res) => {
  const { applied, withdrawal: w } = await db.rejectWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  if (!applied) return bad(res, 'Заявка уже была обработана');
  notifyUser(w.user_id, `↩️ Заявка на вывод ${fmtMoney(w.amount)} отклонена, средства возвращены на баланс.`);
  res.json(w);
});

// Корректировка баланса пользователя админом
admin.post('/users/:id/balance', async (req, res) => {
  const u = await db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const delta = num(req.body.delta);
  if (!delta) return bad(res, 'Укажите сумму (можно со знаком минус)');
  if (delta < 0 && (await db.getBalance(u.id)) + delta < 0) return bad(res, 'Баланс не может стать отрицательным');
  try {
    const balance = await db.balanceTx(u.id, delta, delta > 0 ? 'deposit' : 'withdraw_done', { note: 'Корректировка администратором' });
    res.json({ balance });
  } catch (e) {
    if (e.code === 'insufficient_funds') return bad(res, 'Баланс не может стать отрицательным');
    throw e;
  }
});

api.use('/admin', admin);
