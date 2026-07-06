// Простые уведомления пользователям через бота.
// Бот устанавливается на старте (setBot), а API/фоновые задачи вызывают notifyUser.
let botRef = null;

export function setBot(bot) {
  botRef = bot;
}

// Экранирование текста, подставляемого в HTML-сообщения бота (parse_mode: 'HTML') —
// без этого заголовок товара/сделки мог бы содержать теги вроде <a href=...> (фишинг-ссылка
// в уведомлении, которое выглядит как официальное от бота маркетплейса). Используется везде,
// где в текст уведомления попадают пользовательские данные (api.js и фоновая обработка дедлайнов).
export const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function notifyUser(userId, text) {
  if (!botRef || !userId) return;
  // Отправляем без ожидания; для пользователей, не запускавших бота, просто игнорируем ошибку.
  Promise.resolve(botRef.api.sendMessage(Number(userId), text, { parse_mode: 'HTML' })).catch(() => {});
}
