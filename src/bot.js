import { Bot, InlineKeyboard } from 'grammy';
import { config, isAdminId } from './config.js';
import { upsertUser } from './db.js';

const isHttps = (url) => typeof url === 'string' && url.startsWith('https://');

export function createBot() {
  if (!config.botToken) {
    console.warn('⚠️  BOT_TOKEN не задан — Telegram-бот не будет запущен (работает только веб-часть).');
    return null;
  }

  const bot = new Bot(config.botToken);
  const url = config.webappUrl;

  bot.command('start', async (ctx) => {
    // Регистрируем/обновляем пользователя
    await upsertUser({
      id: ctx.from.id,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });

    const text =
      `👋 <b>Добро пожаловать в Маркет цифровых товаров!</b>\n\n` +
      `Здесь можно покупать и продавать: 📢 каналы, 🤖 ботов, 📜 скрипты, 💬 чаты, 💾 коды и другое.\n\n` +
      `В приложении вас ждёт:\n` +
      `• 🛍 <b>Каталог</b> — товары продавцов\n` +
      `• 📊 <b>Биржа</b> — заявки покупателей\n` +
      `• 💬 <b>Чаты</b> — переписка по сделкам\n` +
      `• 🤝 <b>Сделки</b> — история покупок и продаж\n` +
      `• 👤 <b>Профиль</b> — ваши данные и настройки\n\n` +
      `Нажмите кнопку ниже, чтобы открыть приложение 👇`;

    if (isHttps(url)) {
      const kb = new InlineKeyboard().webApp('🚀 Открыть Маркет', url);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    } else {
      await ctx.reply(
        text +
          `\n\n⚠️ Адрес приложения (WEBAPP_URL) ещё не настроен. ` +
          `Задайте переменную окружения WEBAPP_URL с HTTPS-адресом (Railway задаёт её автоматически после деплоя).`,
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('admin', async (ctx) => {
    if (!isAdminId(ctx.from.id)) {
      await ctx.reply('⛔️ Команда доступна только администраторам.');
      return;
    }
    const adminUrl = isHttps(url) ? `${url}/admin` : null;
    if (adminUrl) {
      const kb = new InlineKeyboard().webApp('🛠 Открыть админ-панель', adminUrl);
      await ctx.reply('🛠 <b>Админ-панель</b>\nУправление пользователями, товарами и сделками.', {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    } else {
      await ctx.reply('⚠️ WEBAPP_URL не настроен — не могу открыть админ-панель.');
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'ℹ️ Команды:\n/start — открыть приложение\n/admin — админ-панель (только для админов)\n/help — помощь'
    );
  });

  bot.catch((err) => {
    console.error('Ошибка бота:', err?.error || err);
  });

  return bot;
}

// Устанавливает кнопку меню (рядом с полем ввода), открывающую Mini App
export async function setupMenuButton(bot) {
  if (!bot || !isHttps(config.webappUrl)) return;
  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Маркет', web_app: { url: config.webappUrl } },
    });
  } catch (e) {
    console.warn('Не удалось установить кнопку меню:', e?.message || e);
  }
}
