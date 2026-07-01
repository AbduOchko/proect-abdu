/* ================= Telegram Mini App — Маркет цифровых товаров ================= */
'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('bg_color'); } catch (e) {}
  try { tg.enableClosingConfirmation && tg.enableClosingConfirmation(); } catch (e) {}
}

const CATEGORIES = [
  { key: 'channel', title: 'Каналы', emoji: '📢' },
  { key: 'bot', title: 'Боты', emoji: '🤖' },
  { key: 'script', title: 'Скрипты', emoji: '📜' },
  { key: 'chat', title: 'Чаты', emoji: '💬' },
  { key: 'code', title: 'Коды', emoji: '💾' },
  { key: 'other', title: 'Другое', emoji: '📦' },
];
const catByKey = (k) => CATEGORIES.find((c) => c.key === k) || { title: k, emoji: '📦' };

const DEAL_STATUS = {
  pending: 'Ожидание', paid: 'Оплачено', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор',
};

/* ---------- DOM ---------- */
const viewEl = document.getElementById('view');
const topTitle = document.getElementById('topbar-title');
const topAction = document.getElementById('topbar-action');
const overlay = document.getElementById('sheet-overlay');
const sheetBody = document.getElementById('sheet-body');
const chatsBadge = document.getElementById('chats-badge');
const toastEl = document.getElementById('toast');

/* ---------- state ---------- */
const state = {
  tab: 'catalog',
  me: null,
  catalog: { category: '', q: '', sort: 'new' },
  exchange: { category: '', q: '' },
  deals: { role: 'all' },
};
let chatOpen = false;
let chatCtx = null;

/* ================= helpers ================= */
function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function haptic(type) {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (type === 'error' || type === 'success' || type === 'warning') tg.HapticFeedback.notificationOccurred(type);
    else tg.HapticFeedback.impactOccurred(type || 'light');
  } catch (e) {}
}
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 2200);
}
function money(n, zero) {
  n = Number(n) || 0;
  if (!n) return zero || 'Договорная';
  return n.toLocaleString('ru-RU') + ' ₽';
}
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return Math.floor(s / 60) + ' мин';
  if (s < 86400) return Math.floor(s / 3600) + ' ч';
  if (s < 604800) return Math.floor(s / 86400) + ' дн';
  return new Date(ms).toLocaleDateString('ru-RU');
}
function timeHM(ms) {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function stars(r) {
  r = Number(r) || 0;
  if (!r) return '<span class="text-hint">нет оценок</span>';
  const full = Math.round(r);
  return `<span class="stars">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span> <span class="text-hint">${r.toFixed(1)}</span>`;
}
function avatarHtml(u, size) {
  const cls = 'avatar' + (size ? ' ' + size : '');
  if (u && u.photo_url) return `<img class="${cls}" src="${esc(u.photo_url)}" alt="">`;
  const initial = (((u && (u.first_name || u.username)) || '?').trim().charAt(0) || '?').toUpperCase();
  return `<span class="${cls}">${esc(initial)}</span>`;
}
function userName(u) {
  if (!u) return 'Пользователь';
  return esc(u.first_name || (u.username ? '@' + u.username : 'Пользователь'));
}

/* ================= API ================= */
const API = {
  async call(method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    const dev = new URLSearchParams(location.search).get('devUserId');
    if (dev) headers['X-Dev-User-Id'] = dev;
    let res;
    try {
      res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      toast('Нет соединения');
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (data && data.message) || 'Ошибка запроса';
      throw Object.assign(new Error(msg), { status: res.status, data });
    }
    return data;
  },
  get(p) { return this.call('GET', p); },
  post(p, b) { return this.call('POST', p, b); },
  patch(p, b) { return this.call('PATCH', p, b); },
  del(p) { return this.call('DELETE', p); },
};

/* ================= sheet / modal ================= */
function openSheet(html) {
  sheetBody.innerHTML = html;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  updateBackButton();
}
function closeSheet() {
  overlay.hidden = true;
  sheetBody.innerHTML = '';
  document.body.style.overflow = '';
  updateBackButton();
}
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

function updateBackButton() {
  if (!tg || !tg.BackButton) return;
  if (chatOpen || !overlay.hidden) tg.BackButton.show();
  else tg.BackButton.hide();
}
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    if (chatOpen) closeChat();
    else if (!overlay.hidden) closeSheet();
  });
}

/* ================= confirm ================= */
function confirmDialog(message) {
  return new Promise((resolve) => {
    if (tg && tg.showConfirm) tg.showConfirm(message, (ok) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

/* ================= router ================= */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  haptic('light');
  renderTab();
}
function renderTab() {
  topAction.innerHTML = '';
  if (state.tab === 'catalog') renderCatalog();
  else if (state.tab === 'exchange') renderExchange();
  else if (state.tab === 'chats') renderChats();
  else if (state.tab === 'deals') renderDeals();
  else if (state.tab === 'profile') renderProfile();
}
function setLoading() { viewEl.innerHTML = '<div class="loader"><span class="spin"></span></div>'; }
function emptyState(emoji, text) {
  return `<div class="empty"><span class="em">${emoji}</span>${esc(text)}</div>`;
}

/* ================= CATALOG ================= */
function categoryChips(active, allLabel) {
  let html = `<div class="chips"><button class="chip ${active ? '' : 'active'}" data-cat="">${allLabel}</button>`;
  for (const c of CATEGORIES) {
    html += `<button class="chip ${active === c.key ? 'active' : ''}" data-cat="${c.key}">${c.emoji} ${esc(c.title)}</button>`;
  }
  return html + '</div>';
}

async function renderCatalog() {
  topTitle.textContent = 'Каталог';
  const s = state.catalog;
  viewEl.innerHTML = `
    <div class="searchbar"><span class="ic">🔎</span><input id="cat-search" placeholder="Поиск товаров" value="${esc(s.q)}"></div>
    ${categoryChips(s.category, 'Все')}
    <div class="row-between">
      <span class="text-hint" id="cat-count"></span>
      <select class="select-sort" id="cat-sort">
        <option value="new">Сначала новые</option>
        <option value="cheap">Сначала дешёвые</option>
        <option value="expensive">Сначала дорогие</option>
        <option value="popular">Популярные</option>
      </select>
    </div>
    <div id="cat-list"><div class="loader"><span class="spin"></span></div></div>
    <button class="fab" id="cat-fab">＋</button>`;

  document.getElementById('cat-sort').value = s.sort;
  document.querySelectorAll('#view .chip').forEach((ch) =>
    ch.addEventListener('click', () => { s.category = ch.dataset.cat; renderCatalog(); }));
  const searchInput = document.getElementById('cat-search');
  searchInput.addEventListener('input', debounce(() => { s.q = searchInput.value.trim(); loadCatalogList(); }, 350));
  document.getElementById('cat-sort').addEventListener('change', (e) => { s.sort = e.target.value; loadCatalogList(); });
  document.getElementById('cat-fab').addEventListener('click', openProductForm);
  loadCatalogList();
}

async function loadCatalogList() {
  const s = state.catalog;
  const list = document.getElementById('cat-list');
  if (!list) return;
  try {
    const qs = new URLSearchParams();
    if (s.category) qs.set('category', s.category);
    if (s.q) qs.set('q', s.q);
    if (s.sort) qs.set('sort', s.sort);
    const items = await API.get('/products?' + qs.toString());
    const countEl = document.getElementById('cat-count');
    if (countEl) countEl.textContent = items.length ? `${items.length} товаров` : '';
    if (!items.length) { list.innerHTML = emptyState('🛒', 'Пока нет товаров в этой категории'); return; }
    list.innerHTML = items.map(productCard).join('');
    list.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openProductDetail(Number(c.dataset.id))));
  } catch (e) {
    list.innerHTML = emptyState('⚠️', e.message || 'Не удалось загрузить');
  }
}

function productCard(p) {
  const c = catByKey(p.category);
  return `<div class="card" data-id="${p.id}">
    <div class="card-top">
      <div style="min-width:0">
        <div class="card-title">${esc(p.title)}</div>
        <span class="badge cat">${c.emoji} ${esc(c.title)}</span>
      </div>
      <div class="price">${money(p.price)}</div>
    </div>
    ${p.description ? `<div class="card-desc">${esc(p.description)}</div>` : ''}
    <div class="card-foot">
      <div class="mini-user">${avatarHtml({ first_name: p.seller_name, username: p.seller_username, photo_url: p.seller_photo })} ${userName({ first_name: p.seller_name, username: p.seller_username })}</div>
      <span class="text-hint">👁 ${p.views || 0}</span>
    </div>
  </div>`;
}

async function openProductDetail(id) {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const p = await API.get('/products/' + id);
    const c = catByKey(p.category);
    const mine = state.me && p.seller_id === state.me.id;
    const seller = { first_name: p.seller_name, username: p.seller_username, photo_url: p.seller_photo };
    let actions = '';
    if (mine) {
      actions = `<div class="btn-row">
        <button class="btn secondary sm" data-act="toggle">${p.status === 'active' ? 'Скрыть' : 'Опубликовать'}</button>
        <button class="btn danger sm" data-act="del">Удалить</button>
      </div>`;
    } else {
      actions = `<button class="btn" data-act="buy">Купить за ${money(p.price)}</button>
        <button class="btn secondary mt8" data-act="chat">💬 Написать продавцу</button>`;
    }
    openSheet(`
      <div class="sheet-title">${esc(p.title)}</div>
      <span class="badge cat">${c.emoji} ${esc(c.title)}</span>
      <span class="st st-${p.status}" style="margin-left:6px">${statusProductLabel(p.status)}</span>
      <div class="detail-desc">${esc(p.description) || '<span class="text-hint">Без описания</span>'}</div>
      <div class="detail-row"><span class="k">Цена</span><span class="v">${money(p.price)}</span></div>
      <div class="detail-row"><span class="k">Просмотры</span><span class="v">${p.views || 0}</span></div>
      <div class="detail-row"><span class="k">Продавец</span><span class="v" style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${avatarHtml(seller)} ${userName(seller)}</span></div>
      <div class="detail-row"><span class="k">Рейтинг</span><span class="v">${stars(p.seller_rating)}</span></div>
      <div class="detail-row"><span class="k">Сделок у продавца</span><span class="v">${p.seller_deals || 0}</span></div>
      <div class="mt12">${actions}</div>`);

    sheetBody.querySelector('[data-act="buy"]')?.addEventListener('click', () => buyProduct(p));
    sheetBody.querySelector('[data-act="chat"]')?.addEventListener('click', () => startChat(p.seller_id, p.id));
    sheetBody.querySelector('[data-act="toggle"]')?.addEventListener('click', async () => {
      await API.patch(`/products/${p.id}/status`, { status: p.status === 'active' ? 'hidden' : 'active' });
      toast('Готово'); closeSheet(); loadCatalogList();
    });
    sheetBody.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить товар?'))) return;
      await API.del('/products/' + p.id); toast('Удалено'); closeSheet(); loadCatalogList();
    });
  } catch (e) {
    openSheet(emptyState('⚠️', e.message || 'Ошибка'));
  }
}
function statusProductLabel(s) {
  return { active: 'Активен', hidden: 'Скрыт', sold: 'Продан' }[s] || s;
}

async function buyProduct(p) {
  if (!(await confirmDialog(`Создать сделку на «${p.title}» за ${money(p.price)}?`))) return;
  try {
    const deal = await API.post('/deals', { productId: p.id });
    haptic('success');
    closeSheet();
    toast('Сделка создана! Открыт чат с продавцом');
    await refreshUnread();
    switchTab('deals');
    setTimeout(() => openDealDetail(deal.id), 200);
  } catch (e) { toast(e.message); haptic('error'); }
}

function openProductForm() {
  haptic('light');
  openSheet(`
    <div class="sheet-title">Новый товар</div>
    <div class="field"><label>Категория</label><select id="f-cat">${CATEGORIES.map((c) => `<option value="${c.key}">${c.emoji} ${c.title}</option>`).join('')}</select></div>
    <div class="field"><label>Название</label><input id="f-title" maxlength="120" placeholder="Напр. Telegram-канал 50к подписчиков"></div>
    <div class="field"><label>Описание</label><textarea id="f-desc" maxlength="4000" placeholder="Расскажите о товаре, условиях передачи и т.д."></textarea></div>
    <div class="field"><label>Цена, ₽ (0 — договорная)</label><input id="f-price" type="number" inputmode="numeric" min="0" value="0"></div>
    <button class="btn" id="f-submit">Опубликовать</button>`);
  document.getElementById('f-submit').addEventListener('click', async () => {
    const body = {
      category: document.getElementById('f-cat').value,
      title: document.getElementById('f-title').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      price: Number(document.getElementById('f-price').value) || 0,
    };
    if (body.title.length < 3) return toast('Введите название (мин. 3 символа)');
    try {
      await API.post('/products', body);
      haptic('success'); closeSheet(); toast('Товар опубликован');
      if (state.tab === 'catalog') loadCatalogList();
    } catch (e) { toast(e.message); }
  });
}

/* ================= EXCHANGE (Биржа) ================= */
async function renderExchange() {
  topTitle.textContent = 'Биржа';
  const s = state.exchange;
  viewEl.innerHTML = `
    <div class="searchbar"><span class="ic">🔎</span><input id="ex-search" placeholder="Поиск заявок" value="${esc(s.q)}"></div>
    ${categoryChips(s.category, 'Все')}
    <p class="text-hint mb12">📊 Заявки покупателей — что люди хотят купить</p>
    <div id="ex-list"><div class="loader"><span class="spin"></span></div></div>
    <button class="fab" id="ex-fab">＋</button>`;
  document.querySelectorAll('#view .chip').forEach((ch) =>
    ch.addEventListener('click', () => { s.category = ch.dataset.cat; renderExchange(); }));
  const si = document.getElementById('ex-search');
  si.addEventListener('input', debounce(() => { s.q = si.value.trim(); loadExchangeList(); }, 350));
  document.getElementById('ex-fab').addEventListener('click', openRequestForm);
  loadExchangeList();
}

async function loadExchangeList() {
  const s = state.exchange;
  const list = document.getElementById('ex-list');
  if (!list) return;
  try {
    const qs = new URLSearchParams();
    if (s.category) qs.set('category', s.category);
    if (s.q) qs.set('q', s.q);
    const items = await API.get('/requests?' + qs.toString());
    if (!items.length) { list.innerHTML = emptyState('📭', 'Пока нет заявок'); return; }
    list.innerHTML = items.map(requestCard).join('');
    list.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openRequestDetail(Number(c.dataset.id))));
  } catch (e) {
    list.innerHTML = emptyState('⚠️', e.message || 'Ошибка');
  }
}

function requestCard(r) {
  const c = catByKey(r.category);
  const buyer = { first_name: r.buyer_name, username: r.buyer_username, photo_url: r.buyer_photo };
  return `<div class="card" data-id="${r.id}">
    <div class="card-top">
      <div style="min-width:0"><div class="card-title">${esc(r.title)}</div><span class="badge cat">${c.emoji} ${esc(c.title)}</span></div>
      <div class="price">${money(r.budget, 'Бюджет ?')}</div>
    </div>
    ${r.description ? `<div class="card-desc">${esc(r.description)}</div>` : ''}
    <div class="card-foot">
      <div class="mini-user">${avatarHtml(buyer)} ${userName(buyer)}</div>
      <span class="text-hint">${timeAgo(r.created_at)}</span>
    </div>
  </div>`;
}

async function openRequestDetail(id) {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const r = await API.get('/requests/' + id);
    const c = catByKey(r.category);
    const mine = state.me && r.buyer_id === state.me.id;
    const buyer = { first_name: r.buyer_name, username: r.buyer_username, photo_url: r.buyer_photo };
    let actions = mine
      ? `<button class="btn danger" data-act="close">Закрыть заявку</button>`
      : `<button class="btn" data-act="offer">💬 Предложить товар</button>`;
    openSheet(`
      <div class="sheet-title">${esc(r.title)}</div>
      <span class="badge cat">${c.emoji} ${esc(c.title)}</span>
      <div class="detail-desc">${esc(r.description) || '<span class="text-hint">Без описания</span>'}</div>
      <div class="detail-row"><span class="k">Бюджет</span><span class="v">${money(r.budget, 'Договорной')}</span></div>
      <div class="detail-row"><span class="k">Покупатель</span><span class="v" style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${avatarHtml(buyer)} ${userName(buyer)}</span></div>
      <div class="detail-row"><span class="k">Создана</span><span class="v">${timeAgo(r.created_at)}</span></div>
      <div class="mt12">${actions}</div>`);
    sheetBody.querySelector('[data-act="offer"]')?.addEventListener('click', () => startChat(r.buyer_id, 0));
    sheetBody.querySelector('[data-act="close"]')?.addEventListener('click', async () => {
      await API.patch(`/requests/${r.id}/status`, { status: 'closed' });
      toast('Заявка закрыта'); closeSheet(); loadExchangeList();
    });
  } catch (e) { openSheet(emptyState('⚠️', e.message)); }
}

function openRequestForm() {
  haptic('light');
  openSheet(`
    <div class="sheet-title">Новая заявка</div>
    <p class="text-hint mb12">Опишите, что вы хотите купить — продавцы предложат варианты</p>
    <div class="field"><label>Категория</label><select id="rf-cat">${CATEGORIES.map((c) => `<option value="${c.key}">${c.emoji} ${c.title}</option>`).join('')}</select></div>
    <div class="field"><label>Что ищете</label><input id="rf-title" maxlength="120" placeholder="Напр. Ищу бота для рассылок"></div>
    <div class="field"><label>Подробности</label><textarea id="rf-desc" maxlength="4000" placeholder="Требования, пожелания..."></textarea></div>
    <div class="field"><label>Бюджет, ₽ (0 — договорной)</label><input id="rf-budget" type="number" inputmode="numeric" min="0" value="0"></div>
    <button class="btn" id="rf-submit">Разместить заявку</button>`);
  document.getElementById('rf-submit').addEventListener('click', async () => {
    const body = {
      category: document.getElementById('rf-cat').value,
      title: document.getElementById('rf-title').value.trim(),
      description: document.getElementById('rf-desc').value.trim(),
      budget: Number(document.getElementById('rf-budget').value) || 0,
    };
    if (body.title.length < 3) return toast('Введите заголовок (мин. 3 символа)');
    try {
      await API.post('/requests', body);
      haptic('success'); closeSheet(); toast('Заявка размещена');
      if (state.tab === 'exchange') loadExchangeList();
    } catch (e) { toast(e.message); }
  });
}

/* ================= CHATS ================= */
async function renderChats() {
  topTitle.textContent = 'Чаты';
  setLoading();
  try {
    const chats = await API.get('/chats');
    if (!chats.length) { viewEl.innerHTML = emptyState('💬', 'Пока нет переписок.\nНапишите продавцу из каталога или ответьте на заявку.'); return; }
    viewEl.innerHTML = chats.map(chatListItem).join('');
    viewEl.querySelectorAll('[data-chat]').forEach((el) =>
      el.addEventListener('click', () => openChat(Number(el.dataset.chat), JSON.parse(el.dataset.other))));
    await refreshUnread();
  } catch (e) { viewEl.innerHTML = emptyState('⚠️', e.message); }
}
function chatListItem(c) {
  return `<div class="chat-list-item" data-chat="${c.id}" data-other='${esc(JSON.stringify(c.other))}'>
    ${avatarHtml(c.other, 'md')}
    <div class="chat-li-main">
      <div class="chat-li-name">${userName(c.other)}</div>
      <div class="chat-li-last">${esc(c.last_text) || '—'}</div>
    </div>
    <div class="chat-li-right">
      <span class="chat-li-time">${timeAgo(c.last_at)}</span>
      ${c.unread ? `<span class="unread-dot">${c.unread}</span>` : ''}
    </div>
  </div>`;
}

async function startChat(targetId, productId) {
  try {
    const chat = await API.post('/chats', { targetId, productId: productId || 0 });
    closeSheet();
    openChat(chat.id, chat.other);
  } catch (e) { toast(e.message); }
}

function openChat(chatId, other) {
  chatOpen = true;
  chatCtx = { id: chatId, other, lastId: 0, timer: null };
  let el = document.getElementById('chat-view');
  if (!el) { el = document.createElement('div'); el.id = 'chat-view'; document.body.appendChild(el); }
  el.innerHTML = `
    <div id="chat-head">
      <button class="back" id="chat-back">‹</button>
      ${avatarHtml(other, 'md')}
      <div><div class="name">${userName(other)}</div><div class="sub" id="chat-sub"></div></div>
    </div>
    <div id="chat-msgs"><div class="loader"><span class="spin"></span></div></div>
    <div id="chat-input-bar">
      <input id="chat-input" placeholder="Сообщение..." autocomplete="off">
      <button id="chat-send">➤</button>
    </div>`;
  el.style.display = 'flex';
  document.getElementById('chat-back').addEventListener('click', closeChat);
  const input = document.getElementById('chat-input');
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const msg = await API.post(`/chats/${chatId}/messages`, { text });
      appendMessages([msg]);
    } catch (e) { toast(e.message); input.value = text; }
  };
  document.getElementById('chat-send').addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  updateBackButton();
  loadChatMessages(true);
  chatCtx.timer = setInterval(() => loadChatMessages(false), 3000);
}

async function loadChatMessages(first) {
  if (!chatCtx) return;
  try {
    const data = await API.get(`/chats/${chatCtx.id}/messages?sinceId=${chatCtx.lastId}`);
    if (first) {
      const sub = document.getElementById('chat-sub');
      if (sub && data.chat && data.chat.product) sub.textContent = 'по товару: ' + data.chat.product.title;
      document.getElementById('chat-msgs').innerHTML = '';
    }
    appendMessages(data.messages || []);
    if (first) refreshUnread();
  } catch (e) { /* тихо */ }
}
function appendMessages(msgs) {
  if (!chatCtx || !msgs.length) return;
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  const mine = state.me ? state.me.id : null;
  for (const m of msgs) {
    if (m.id <= chatCtx.lastId) continue;
    chatCtx.lastId = m.id;
    const div = document.createElement('div');
    div.className = 'msg ' + (m.sender_id === mine ? 'out' : 'in');
    div.innerHTML = `${esc(m.text)}<div class="t">${timeHM(m.created_at)}</div>`;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}
function closeChat() {
  chatOpen = false;
  if (chatCtx && chatCtx.timer) clearInterval(chatCtx.timer);
  chatCtx = null;
  const el = document.getElementById('chat-view');
  if (el) el.style.display = 'none';
  updateBackButton();
  refreshUnread();
  if (state.tab === 'chats') renderChats();
}

/* ================= DEALS ================= */
async function renderDeals() {
  topTitle.textContent = 'Сделки';
  const role = state.deals.role;
  viewEl.innerHTML = `
    <div class="subtabs">
      <button class="subtab ${role === 'all' ? 'active' : ''}" data-role="all">Все</button>
      <button class="subtab ${role === 'buyer' ? 'active' : ''}" data-role="buyer">Покупки</button>
      <button class="subtab ${role === 'seller' ? 'active' : ''}" data-role="seller">Продажи</button>
    </div>
    <div id="deals-list"><div class="loader"><span class="spin"></span></div></div>`;
  viewEl.querySelectorAll('.subtab').forEach((b) =>
    b.addEventListener('click', () => { state.deals.role = b.dataset.role; renderDeals(); }));
  loadDealsList();
}
async function loadDealsList() {
  const list = document.getElementById('deals-list');
  if (!list) return;
  try {
    const deals = await API.get('/deals?role=' + state.deals.role);
    if (!deals.length) { list.innerHTML = emptyState('🤝', 'Сделок пока нет'); return; }
    list.innerHTML = deals.map(dealCard).join('');
    list.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openDealDetail(Number(c.dataset.id))));
  } catch (e) { list.innerHTML = emptyState('⚠️', e.message); }
}
function dealRole(d) { return state.me && d.buyer_id === state.me.id ? 'buyer' : 'seller'; }
function dealCard(d) {
  const role = dealRole(d);
  const other = role === 'buyer'
    ? { first_name: d.seller_name, username: d.seller_username, photo_url: d.seller_photo }
    : { first_name: d.buyer_name, username: d.buyer_username, photo_url: d.buyer_photo };
  return `<div class="card" data-id="${d.id}">
    <div class="card-top">
      <div style="min-width:0"><div class="card-title">${esc(d.title)}</div>
      <span class="text-hint">${role === 'buyer' ? '🛒 Покупка' : '💰 Продажа'} · ${timeAgo(d.created_at)}</span></div>
      <div class="price">${money(d.amount)}</div>
    </div>
    <div class="card-foot mt8">
      <div class="mini-user">${avatarHtml(other)} ${userName(other)}</div>
      <span class="st st-${d.status}">${DEAL_STATUS[d.status] || d.status}</span>
    </div>
  </div>`;
}

async function openDealDetail(id) {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const d = await API.get('/deals/' + id);
    const role = dealRole(d);
    const other = role === 'buyer'
      ? { id: d.seller_id, first_name: d.seller_name, username: d.seller_username, photo_url: d.seller_photo }
      : { id: d.buyer_id, first_name: d.buyer_name, username: d.buyer_username, photo_url: d.buyer_photo };
    openSheet(`
      <div class="sheet-title">${esc(d.title)}</div>
      <span class="st st-${d.status}">${DEAL_STATUS[d.status] || d.status}</span>
      <div class="detail-row"><span class="k">Роль</span><span class="v">${role === 'buyer' ? 'Покупатель' : 'Продавец'}</span></div>
      <div class="detail-row"><span class="k">Сумма</span><span class="v">${money(d.amount)}</span></div>
      <div class="detail-row"><span class="k">${role === 'buyer' ? 'Продавец' : 'Покупатель'}</span><span class="v" style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${avatarHtml(other)} ${userName(other)}</span></div>
      <div class="detail-row"><span class="k">Создана</span><span class="v">${new Date(d.created_at).toLocaleString('ru-RU')}</span></div>
      <button class="btn secondary mt12" data-act="chat">💬 Открыть чат</button>
      <div id="deal-actions" class="mt8"></div>`);
    sheetBody.querySelector('[data-act="chat"]').addEventListener('click', () => startChat(other.id, d.product_id || 0));
    renderDealActions(d, role);
  } catch (e) { openSheet(emptyState('⚠️', e.message)); }
}

function renderDealActions(d, role) {
  const box = document.getElementById('deal-actions');
  if (!box) return;
  const btns = [];
  if (role === 'buyer' && d.status === 'pending') btns.push(['success', 'paid', '✅ Я оплатил']);
  if (role === 'buyer' && (d.status === 'paid' || d.status === 'pending')) btns.push(['success', 'completed', '🎉 Подтвердить получение']);
  if ((d.status === 'pending' || d.status === 'paid')) {
    btns.push(['danger', 'cancelled', '✖️ Отменить']);
    btns.push(['secondary', 'disputed', '⚠️ Открыть спор']);
  }
  if (!btns.length) { box.innerHTML = '<p class="text-hint" style="text-align:center">Сделка завершена</p>'; return; }
  box.innerHTML = btns.map(([cls, st, label]) => `<button class="btn ${cls} sm mt8" data-st="${st}">${label}</button>`).join('');
  box.querySelectorAll('[data-st]').forEach((b) =>
    b.addEventListener('click', () => changeDealStatus(d, b.dataset.st, role)));
}

async function changeDealStatus(d, status, role) {
  if (status === 'completed') return completeDealWithRating(d);
  const labels = { paid: 'отметить как оплаченную', cancelled: 'отменить сделку', disputed: 'открыть спор' };
  if (!(await confirmDialog('Вы уверены, что хотите ' + (labels[status] || 'изменить статус') + '?'))) return;
  try {
    await API.patch('/deals/' + d.id, { status });
    haptic('success'); toast('Статус обновлён'); closeSheet();
    loadDealsList();
  } catch (e) { toast(e.message); haptic('error'); }
}

function completeDealWithRating(d) {
  const box = document.getElementById('deal-actions');
  box.innerHTML = `
    <p class="text-hint mb12" style="text-align:center">Оцените продавца и подтвердите получение</p>
    <div id="rate-stars" style="text-align:center;font-size:34px;letter-spacing:6px;color:#f5a623">
      ${[1, 2, 3, 4, 5].map((n) => `<span data-star="${n}" style="cursor:pointer">☆</span>`).join('')}
    </div>
    <button class="btn success mt12" id="rate-confirm">Подтвердить</button>`;
  let rating = 5;
  const paint = () => box.querySelectorAll('[data-star]').forEach((s) =>
    s.textContent = Number(s.dataset.star) <= rating ? '★' : '☆');
  box.querySelectorAll('[data-star]').forEach((s) =>
    s.addEventListener('click', () => { rating = Number(s.dataset.star); paint(); haptic('light'); }));
  paint();
  document.getElementById('rate-confirm').addEventListener('click', async () => {
    try {
      await API.patch('/deals/' + d.id, { status: 'completed', rating });
      haptic('success'); toast('Сделка завершена! Спасибо за оценку'); closeSheet();
      loadDealsList();
    } catch (e) { toast(e.message); haptic('error'); }
  });
}

/* ================= PROFILE ================= */
async function renderProfile() {
  topTitle.textContent = 'Профиль';
  setLoading();
  try {
    const me = await API.get('/me');
    state.me = me;
    const since = me.created_at ? new Date(me.created_at).toLocaleDateString('ru-RU') : '';
    viewEl.innerHTML = `
      <div class="profile-head">
        ${avatarHtml(me, 'lg')}
        <div class="profile-name">${userName(me)}</div>
        ${me.username ? `<div class="profile-username">@${esc(me.username)}</div>` : ''}
        <div>${stars(me.rating)}</div>
      </div>
      <div class="profile-stats">
        <div class="pstat"><div class="n">${me.deals_count || 0}</div><div class="l">Сделок</div></div>
        <div class="pstat"><div class="n">${me.rating_count || 0}</div><div class="l">Отзывов</div></div>
        <div class="pstat"><div class="n">${(me.rating || 0).toFixed(1)}</div><div class="l">Рейтинг</div></div>
      </div>

      <div class="section-label">О себе</div>
      <div class="field"><textarea id="pf-bio" maxlength="500" placeholder="Расскажите о себе">${esc(me.bio || '')}</textarea></div>
      <button class="btn secondary sm" id="pf-save-bio">Сохранить</button>

      <div class="section-label">Мои объявления</div>
      <button class="list-btn" id="pf-products"><span>🛍 Мои товары</span><span class="chev">›</span></button>
      <button class="list-btn" id="pf-requests"><span>📊 Мои заявки</span><span class="chev">›</span></button>

      <div class="section-label">Информация</div>
      <div class="list-btn"><span>🆔 ID</span><span class="text-hint">${me.id}</span></div>
      <div class="list-btn"><span>📅 С нами с</span><span class="text-hint">${since}</span></div>
      ${me.is_admin ? '<div class="list-btn"><span>👑 Статус</span><span class="text-hint">Администратор</span></div>' : ''}
      <p class="text-hint mt12" style="text-align:center">Маркет цифровых товаров v1.0</p>`;

    document.getElementById('pf-save-bio').addEventListener('click', async () => {
      try { await API.patch('/me', { bio: document.getElementById('pf-bio').value.trim() }); toast('Сохранено'); haptic('success'); }
      catch (e) { toast(e.message); }
    });
    document.getElementById('pf-products').addEventListener('click', openMyProducts);
    document.getElementById('pf-requests').addEventListener('click', openMyRequests);
  } catch (e) {
    viewEl.innerHTML = emptyState('⚠️', e.message || 'Ошибка загрузки профиля');
  }
}

async function openMyProducts() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/products/mine');
    openSheet(`<div class="sheet-title">Мои товары</div>${items.length ? items.map(productCard).join('') : emptyState('🛍', 'У вас нет товаров')}`);
    sheetBody.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openProductDetail(Number(c.dataset.id))));
  } catch (e) { openSheet(emptyState('⚠️', e.message)); }
}
async function openMyRequests() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/requests/mine');
    openSheet(`<div class="sheet-title">Мои заявки</div>${items.length ? items.map(requestCard).join('') : emptyState('📊', 'У вас нет заявок')}`);
    sheetBody.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openRequestDetail(Number(c.dataset.id))));
  } catch (e) { openSheet(emptyState('⚠️', e.message)); }
}

/* ================= misc ================= */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
async function refreshUnread() {
  try {
    const { unread } = await API.get('/unread');
    if (unread > 0) { chatsBadge.textContent = unread > 99 ? '99+' : unread; chatsBadge.hidden = false; }
    else chatsBadge.hidden = true;
  } catch (e) {}
}

/* ================= init ================= */
async function init() {
  try {
    state.me = await API.get('/me');
  } catch (e) {
    viewEl.innerHTML = `<div class="empty"><span class="em">🔒</span>
      Не удалось авторизоваться.<br>Откройте приложение через Telegram-бота.
      <div class="text-hint mt12">${esc(e.message || '')}</div></div>`;
    document.getElementById('tabbar').style.display = 'none';
    return;
  }
  switchTab('catalog');
  refreshUnread();
  setInterval(() => { if (!chatOpen) refreshUnread(); }, 15000);
}
init();
