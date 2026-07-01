// Простые уведомления пользователям через бота.
// Бот устанавливается на старте (setBot), а API/фоновые задачи вызывают notifyUser.
let botRef = null;

export function setBot(bot) {
  botRef = bot;
}

export function notifyUser(userId, text) {
  if (!botRef || !userId) return;
  // Отправляем без ожидания; для пользователей, не запускавших бота, просто игнорируем ошибку.
  Promise.resolve(botRef.api.sendMessage(Number(userId), text, { parse_mode: 'HTML' })).catch(() => {});
}
