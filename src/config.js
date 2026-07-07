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
  port: (() => { const n = Number(process.env.PORT); return Number.isFinite(n) && n > 0 ? n : 3000; })(),
  databaseUrl: process.env.DATABASE_URL || '',
  // Внутренние соединения Railway (тот же проект) не требуют SSL; для внешних
  // провайдеров Postgres (Supabase/Neon/RDS и т.п.) выставьте PGSSL=true.
  pgSsl: process.env.PGSSL === '1' || process.env.PGSSL === 'true',
  // Дев-авторизация (вход без Telegram) РАЗРЕШЕНА только вне production. NODE_ENV=production
  // никто на деплое сам не выставляет (ни Railway, ни Procfile/railway.json — это делает start.js
  // ниже), поэтому одного NODE_ENV недостаточно: дополнительно проверяем RAILWAY_ENVIRONMENT —
  // эту переменную сама платформа Railway выставляет для ЛЮБОГО задеплоенного сервиса, независимо
  // от того, не забыли ли где-то прописать NODE_ENV. Так забытый ALLOW_DEV_AUTH=1 в переменных
  // Railway не даст войти под любым userId в реальном деплое.
  allowDevAuth:
    process.env.NODE_ENV !== 'production' &&
    !process.env.RAILWAY_ENVIRONMENT &&
    (process.env.ALLOW_DEV_AUTH === '1' || process.env.ALLOW_DEV_AUTH === 'true'),
};

// Папка для загруженных изображений. На Railway это отдельный Volume от Postgres —
// подключите его к сервису web (Settings → Volumes), иначе файлы не переживут передеплой.
config.uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');

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
