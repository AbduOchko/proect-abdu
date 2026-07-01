import 'dotenv/config';
import path from 'node:path';

function deriveWebappUrl() {
  if (process.env.WEBAPP_URL) return process.env.WEBAPP_URL.replace(/\/+$/, '');
  // Railway автоматически прокидывает публичный домен
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return '';
}

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  webappUrl: deriveWebappUrl(),
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n)),
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || './data/marketplace.db',
  allowDevAuth: process.env.ALLOW_DEV_AUTH === '1' || process.env.ALLOW_DEV_AUTH === 'true',
};

// Папка для загруженных изображений — рядом с БД (чтобы делить один Volume на Railway)
config.uploadsDir = path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');

export function isAdminId(id) {
  return config.adminIds.includes(Number(id));
}

// Категории цифровых товаров — используются и на бэке, и на фронте.
export const CATEGORIES = [
  { key: 'channel', title: 'Каналы', emoji: '📢' },
  { key: 'bot', title: 'Боты', emoji: '🤖' },
  { key: 'script', title: 'Скрипты', emoji: '📜' },
  { key: 'chat', title: 'Чаты', emoji: '💬' },
  { key: 'code', title: 'Коды', emoji: '💾' },
  { key: 'other', title: 'Другое', emoji: '📦' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
