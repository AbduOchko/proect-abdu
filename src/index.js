import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { api } from './api.js';
import { createBot, setupMenuButton } from './bot.js';
import './db.js'; // инициализация схемы БД

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '256kb' }));

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
});

// Telegram-бот (long polling)
const bot = createBot();
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

// Подстраховка: не позволяем необработанным промисам ронять процесс
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Необработанная ошибка промиса:', reason);
});
