import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { api } from './api.js';
import { createBot, setupMenuButton } from './bot.js';
import { processDealTimeouts } from './db.js'; // + инициализация схемы БД
import { seedDemo } from './seed.js';
import { setBot, notifyUser } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// Папка для загруженных скриншотов
fs.mkdirSync(config.uploadsDir, { recursive: true });

// Демо-данные (только если задано SEED_DEMO=1 и БД пустая)
if (process.env.SEED_DEMO === '1') {
  try { seedDemo(); } catch (e) { console.error('Ошибка сидирования:', e); }
}

const app = express();
app.use(express.json({ limit: '8mb' })); // с запасом под base64-изображения

// Заголовки, чтобы приложение корректно открывалось внутри Telegram
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org tg:");
  next();
});

// Проверка живости (для Railway healthcheck)
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// REST API
app.use('/api', api);

// Загруженные скриншоты
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d', immutable: true }));

// Статика: мини-приложение и админка
app.use(express.static(publicDir));

// SPA-фолбэки
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin', 'index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(publicDir, 'admin', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Обработчик ошибок API
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error', message: 'Внутренняя ошибка сервера' });
});

app.listen(config.port, () => {
  console.log(`🌐 Веб-сервер запущен на порту ${config.port}`);
  console.log(`🔗 WEBAPP_URL: ${config.webappUrl || '(не задан)'}`);
  console.log(`👑 Админы: ${config.adminIds.join(', ') || '(не заданы)'}`);
  if (config.allowDevAuth) {
    console.warn('⚠️  ВНИМАНИЕ: включена ДЕВ-АВТОРИЗАЦИЯ (ALLOW_DEV_AUTH). Вход без Telegram разрешён — используйте ТОЛЬКО локально, никогда в проде!');
  }
});

// Telegram-бот (long polling)
const bot = createBot();
setBot(bot); // для уведомлений (если бота нет — уведомления просто игнорируются)
if (bot) {
  bot
    .start({
      onStart: async () => {
        console.log('🤖 Telegram-бот запущен (long polling)');
        await setupMenuButton(bot);
      },
    })
    .catch((err) => {
      // Не роняем веб-сервер, если бот не смог запуститься (напр. неверный BOT_TOKEN)
      const desc = (err && (err.description || err.message)) || err;
      console.error('❌ Не удалось запустить Telegram-бота. Проверьте BOT_TOKEN у @BotFather.');
      console.error('   Причина:', desc);
      console.error('   Веб-приложение (Mini App) продолжает работать.');
    });

  const stop = () => { try { bot.stop(); } catch (e) {} };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Фоновая обработка дедлайнов сделок (автоотмена/автозавершение) каждую минуту
function runDealTimeouts() {
  try {
    const events = processDealTimeouts();
    for (const e of events) {
      const d = e.deal;
      if (!d) continue;
      if (e.type === 'auto_cancel') {
        notifyUser(d.buyer_id, `⏱ Продавец не подтвердил сделку по «${d.title}» за 24 часа. Сделка отменена, средства возвращены на баланс.`);
        notifyUser(d.seller_id, `⏱ Вы не подтвердили сделку по «${d.title}» за 24 часа. Сделка отменена, рейтинг снижен.`);
      } else if (e.type === 'auto_complete') {
        notifyUser(d.seller_id, `⏱ Покупатель не подтвердил получение за 7 дней — сделка по «${d.title}» завершена автоматически. На баланс зачислено.`);
        notifyUser(d.buyer_id, `⏱ Сделка по «${d.title}» автоматически завершена (7 дней на проверке истекли).`);
      }
    }
  } catch (e) {
    console.error('Ошибка обработки дедлайнов сделок:', e);
  }
}
setInterval(runDealTimeouts, 60 * 1000);
runDealTimeouts();

// Подстраховка: не позволяем необработанным промисам ронять процесс
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Необработанная ошибка промиса:', reason);
});
