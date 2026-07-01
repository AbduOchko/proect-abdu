import crypto from 'node:crypto';
import { config, isAdminId } from './config.js';
import { upsertUser, getUser } from './db.js';

/**
 * Проверка подписи Telegram WebApp initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Возвращает объект пользователя Telegram или null.
 */
export function validateInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Защита от повторного использования старых initData
  const authDate = Number(params.get('auth_date'));
  if (authDate && maxAgeSec > 0) {
    const ageSec = Math.floor(Date.now() / 1000) - authDate;
    if (ageSec > maxAgeSec) return null;
  }

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

function extractInitData(req) {
  return (
    req.get('X-Telegram-Init-Data') ||
    req.get('Authorization')?.replace(/^tma\s+/i, '') ||
    req.query.initData ||
    ''
  );
}

/**
 * Express middleware: аутентификация пользователя Mini App.
 * Кладёт в req.user запись из БД.
 */
export function authMiddleware(req, res, next) {
  let user;

  if (config.allowDevAuth) {
    // Режим локальной разработки без Telegram
    const devId = Number(req.get('X-Dev-User-Id') || req.query.devUserId || 777000);
    user = upsertUser({ id: devId, first_name: 'Dev', username: 'dev_user' });
  } else {
    const tgUser = validateInitData(extractInitData(req), config.botToken);
    if (!tgUser) {
      return res.status(401).json({ error: 'unauthorized', message: 'Неверные данные авторизации Telegram' });
    }
    user = upsertUser(tgUser);
  }

  if (user.is_banned) {
    return res.status(403).json({ error: 'banned', message: 'Вы заблокированы' });
  }
  req.user = user;
  next();
}

/**
 * Middleware только для администраторов (по ADMIN_IDS).
 */
export function adminOnly(req, res, next) {
  if (!req.user || !isAdminId(req.user.id)) {
    return res.status(403).json({ error: 'forbidden', message: 'Доступ только для администраторов' });
  }
  next();
}
