/* ================= Telegram Mini App — Маркет цифровых товаров (Apple UI) ================= */
'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.enableClosingConfirmation && tg.enableClosingConfirmation(); } catch (e) {}
}

/* ---------- theme (white/black + dark green) ---------- */
function applyTheme(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const bg = dark ? '#000000' : '#f5f5f7';
  try { tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); } catch (e) {}
}
function initTheme() {
  const scheme = (tg && tg.colorScheme) ||
    (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(scheme);
  if (tg && tg.onEvent) tg.onEvent('themeChanged', () => applyTheme(tg.colorScheme));
}
initTheme();

/* ---------- icons ---------- */
function ic(name, cls) { return `<i class="bi bi-${name}${cls ? ' ' + cls : ''}"></i>`; }

const CATEGORIES = [
  { key: 'channel', title: 'Каналы', icon: 'megaphone' },
  { key: 'bot', title: 'Боты', icon: 'robot' },
  { key: 'script', title: 'Скрипты', icon: 'file-earmark-code' },
  { key: 'chat', title: 'Чаты', icon: 'chat-square-text' },
  { key: 'code', title: 'Коды', icon: 'key' },
  { key: 'other', title: 'Другое', icon: 'box-seam' },
];
const catByKey = (k) => CATEGORIES.find((c) => c.key === k) || { title: k, icon: 'box-seam' };

const DEAL_STATUS = { pending: 'Ожидание', paid: 'Оплачено', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор' };
const DEAL_ICON = { pending: 'hourglass-split', paid: 'credit-card', completed: 'check-circle-fill', cancelled: 'x-circle', disputed: 'exclamation-triangle' };

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
function timeHM(ms) { return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function stars(r) {
  r = Number(r) || 0;
  if (!r) return '<span class="text-hint">нет оценок</span>';
  const full = Math.round(r);
  let s = '<span class="stars">';
  for (let i = 1; i <= 5; i++) s += ic('star' + (i <= full ? '-fill' : ''));
  return s + `<span class="stars-val">${r.toFixed(1)}</span></span>`;
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
    } catch (e) { toast('Нет соединения'); throw e; }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Ошибка запроса'), { status: res.status, data });
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
  if (chatOpen || !overlay.hidden) tg.BackButton.show(); else tg.BackButton.hide();
}
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => { if (chatOpen) closeChat(); else if (!overlay.hidden) closeSheet(); });
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    if (tg && tg.showConfirm) tg.showConfirm(message, (ok) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

/* ================= router ================= */
const TAB_ORDER = ['catalog', 'exchange', 'chats', 'deals', 'profile'];
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    const i = b.querySelector('.tab-ic');
    if (i) i.className = `bi bi-${b.dataset.icon}${on ? '-fill' : ''} tab-ic`;
  });
  // сдвигаем скользящую капсулу-индикатор под активный раздел
  const idx = TAB_ORDER.indexOf(tab);
  const bar = document.getElementById('tabbar');
  if (idx >= 0 && bar) bar.style.setProperty('--i', idx);
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
function setAddButton(handler) {
  topAction.innerHTML = `<button class="icon-btn" id="add-btn" aria-label="Добавить">${ic('plus-lg')}</button>`;
  document.getElementById('add-btn').addEventListener('click', () => { haptic('light'); handler(); });
}
function setLoading() { viewEl.innerHTML = '<div class="loader"><span class="spin"></span></div>'; }
function emptyState(icon, text) {
  return `<div class="empty"><span class="empty-ic">${ic(icon)}</span><div class="empty-t">${esc(text)}</div></div>`;
}

/* ================= CATALOG ================= */
function categoryChips(active) {
  let html = `<div class="chips"><button class="chip ${active ? '' : 'active'}" data-cat="">Все</button>`;
  for (const c of CATEGORIES)
    html += `<button class="chip ${active === c.key ? 'active' : ''}" data-cat="${c.key}">${ic(c.icon)} ${esc(c.title)}</button>`;
  return html + '</div>';
}

async function renderCatalog() {
  topTitle.textContent = 'Каталог';
  setAddButton(openProductForm);
  const s = state.catalog;
  viewEl.innerHTML = `
    <div class="searchbar">${ic('search')}<input id="cat-search" placeholder="Поиск товаров" value="${esc(s.q)}"></div>
    ${categoryChips(s.category)}
    <div class="row-between">
      <span class="text-hint" id="cat-count"></span>
      <select class="select-sort" id="cat-sort">
        <option value="new">Сначала новые</option>
        <option value="cheap">Сначала дешёвые</option>
        <option value="expensive">Сначала дорогие</option>
        <option value="popular">Популярные</option>
      </select>
    </div>
    <div id="cat-list"><div class="loader"><span class="spin"></span></div></div>`;
  document.getElementById('cat-sort').value = s.sort;
  document.querySelectorAll('#view .chip').forEach((ch) =>
    ch.addEventListener('click', () => { s.category = ch.dataset.cat; renderCatalog(); }));
  const searchInput = document.getElementById('cat-search');
  searchInput.addEventListener('input', debounce(() => { s.q = searchInput.value.trim(); loadCatalogList(); }, 350));
  document.getElementById('cat-sort').addEventListener('change', (e) => { s.sort = e.target.value; loadCatalogList(); });
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
    if (!items.length) { list.innerHTML = emptyState('bag', 'Пока нет товаров\nв этой категории'); return; }
    list.innerHTML = items.map(productCard).join('');
    list.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openProductDetail(Number(c.dataset.id))));
  } catch (e) { list.innerHTML = emptyState('exclamation-triangle', e.message || 'Не удалось загрузить'); }
}

function productCard(p) {
  const c = catByKey(p.category);
  const seller = { first_name: p.seller_name, username: p.seller_username, photo_url: p.seller_photo };
  return `<div class="card" data-id="${p.id}">
    <div class="card-top">
      <div style="min-width:0">
        <div class="card-title">${esc(p.title)}</div>
        <span class="badge cat">${ic(c.icon)} ${esc(c.title)}</span>
      </div>
      <div class="price">${money(p.price)}</div>
    </div>
    ${p.description ? `<div class="card-desc">${esc(p.description)}</div>` : ''}
    <div class="card-foot">
      <div class="mini-user">${avatarHtml(seller)} ${userName(seller)}</div>
      <span class="muted-ic">${ic('eye')} ${p.views || 0}</span>
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
    let actions;
    if (mine) {
      actions = `<div class="btn-row">
        <button class="btn secondary sm" data-act="toggle">${ic(p.status === 'active' ? 'eye-slash' : 'eye')} ${p.status === 'active' ? 'Скрыть' : 'Опубликовать'}</button>
        <button class="btn danger sm" data-act="del">${ic('trash')} Удалить</button></div>`;
    } else {
      actions = `<button class="btn" data-act="buy">${ic('bag-check')} Купить за ${money(p.price)}</button>
        <button class="btn secondary mt8" data-act="chat">${ic('chat-dots')} Написать продавцу</button>`;
    }
    openSheet(`
      <div class="sheet-title">${esc(p.title)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="badge cat">${ic(c.icon)} ${esc(c.title)}</span>
        <span class="st st-${p.status}">${statusProductLabel(p.status)}</span>
      </div>
      <div class="detail-desc">${esc(p.description) || '<span class="text-hint">Без описания</span>'}</div>
      <div class="list-group">
        <div class="ios-row"><span class="label">Цена</span><span class="trailing">${money(p.price)}</span></div>
        <div class="ios-row"><span class="label">Просмотры</span><span class="trailing">${p.views || 0}</span></div>
        <div class="ios-row"><span class="label">Продавец</span><span class="trailing">${avatarHtml(seller)} ${userName(seller)}</span></div>
        <div class="ios-row"><span class="label">Рейтинг</span><span class="trailing">${stars(p.seller_rating)}</span></div>
        <div class="ios-row"><span class="label">Сделок у продавца</span><span class="trailing">${p.seller_deals || 0}</span></div>
      </div>
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
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message || 'Ошибка')); }
}
function statusProductLabel(s) { return { active: 'Активен', hidden: 'Скрыт', sold: 'Продан' }[s] || s; }

async function buyProduct(p) {
  if (!(await confirmDialog(`Создать сделку на «${p.title}» за ${money(p.price)}?`))) return;
  try {
    const deal = await API.post('/deals', { productId: p.id });
    haptic('success'); closeSheet(); toast('Сделка создана! Открыт чат с продавцом');
    await refreshUnread(); switchTab('deals');
    setTimeout(() => openDealDetail(deal.id), 220);
  } catch (e) { toast(e.message); haptic('error'); }
}

function openProductForm() {
  openSheet(`
    <div class="sheet-title">Новый товар</div>
    <div class="field"><label>Категория</label><select id="f-cat">${CATEGORIES.map((c) => `<option value="${c.key}">${c.title}</option>`).join('')}</select></div>
    <div class="field"><label>Название</label><input id="f-title" maxlength="120" placeholder="Напр. Telegram-канал 50к подписчиков"></div>
    <div class="field"><label>Описание</label><textarea id="f-desc" maxlength="4000" placeholder="Расскажите о товаре, условиях передачи и т.д."></textarea></div>
    <div class="field"><label>Цена, ₽ (0 — договорная)</label><input id="f-price" type="number" inputmode="numeric" min="0" value="0"></div>
    <button class="btn" id="f-submit">${ic('check-lg')} Опубликовать</button>`);
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

/* ================= EXCHANGE ================= */
async function renderExchange() {
  topTitle.textContent = 'Биржа';
  setAddButton(openRequestForm);
  const s = state.exchange;
  viewEl.innerHTML = `
    <div class="searchbar">${ic('search')}<input id="ex-search" placeholder="Поиск заявок" value="${esc(s.q)}"></div>
    ${categoryChips(s.category)}
    <p class="text-hint mb12">${ic('info-circle')} Заявки покупателей — что люди хотят купить</p>
    <div id="ex-list"><div class="loader"><span class="spin"></span></div></div>`;
  document.querySelectorAll('#view .chip').forEach((ch) =>
    ch.addEventListener('click', () => { s.category = ch.dataset.cat; renderExchange(); }));
  const si = document.getElementById('ex-search');
  si.addEventListener('input', debounce(() => { s.q = si.value.trim(); loadExchangeList(); }, 350));
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
    if (!items.length) { list.innerHTML = emptyState('inbox', 'Пока нет заявок'); return; }
    list.innerHTML = items.map(requestCard).join('');
    list.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openRequestDetail(Number(c.dataset.id))));
  } catch (e) { list.innerHTML = emptyState('exclamation-triangle', e.message || 'Ошибка'); }
}

function requestCard(r) {
  const c = catByKey(r.category);
  const buyer = { first_name: r.buyer_name, username: r.buyer_username, photo_url: r.buyer_photo };
  return `<div class="card" data-id="${r.id}">
    <div class="card-top">
      <div style="min-width:0"><div class="card-title">${esc(r.title)}</div><span class="badge cat">${ic(c.icon)} ${esc(c.title)}</span></div>
      <div class="price">${money(r.budget, 'Бюджет —')}</div>
    </div>
    ${r.description ? `<div class="card-desc">${esc(r.description)}</div>` : ''}
    <div class="card-foot">
      <div class="mini-user">${avatarHtml(buyer)} ${userName(buyer)}</div>
      <span class="muted-ic">${ic('clock')} ${timeAgo(r.created_at)}</span>
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
    const actions = mine
      ? `<button class="btn danger" data-act="close">${ic('x-circle')} Закрыть заявку</button>`
      : `<button class="btn" data-act="offer">${ic('chat-dots')} Предложить товар</button>`;
    openSheet(`
      <div class="sheet-title">${esc(r.title)}</div>
      <span class="badge cat">${ic(c.icon)} ${esc(c.title)}</span>
      <div class="detail-desc">${esc(r.description) || '<span class="text-hint">Без описания</span>'}</div>
      <div class="list-group">
        <div class="ios-row"><span class="label">Бюджет</span><span class="trailing">${money(r.budget, 'Договорной')}</span></div>
        <div class="ios-row"><span class="label">Покупатель</span><span class="trailing">${avatarHtml(buyer)} ${userName(buyer)}</span></div>
        <div class="ios-row"><span class="label">Создана</span><span class="trailing">${timeAgo(r.created_at)}</span></div>
      </div>
      <div class="mt12">${actions}</div>`);
    sheetBody.querySelector('[data-act="offer"]')?.addEventListener('click', () => startChat(r.buyer_id, 0));
    sheetBody.querySelector('[data-act="close"]')?.addEventListener('click', async () => {
      await API.patch(`/requests/${r.id}/status`, { status: 'closed' });
      toast('Заявка закрыта'); closeSheet(); loadExchangeList();
    });
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
}

function openRequestForm() {
  openSheet(`
    <div class="sheet-title">Новая заявка</div>
    <p class="text-hint mb12">Опишите, что вы хотите купить — продавцы предложат варианты</p>
    <div class="field"><label>Категория</label><select id="rf-cat">${CATEGORIES.map((c) => `<option value="${c.key}">${c.title}</option>`).join('')}</select></div>
    <div class="field"><label>Что ищете</label><input id="rf-title" maxlength="120" placeholder="Напр. Ищу бота для рассылок"></div>
    <div class="field"><label>Подробности</label><textarea id="rf-desc" maxlength="4000" placeholder="Требования, пожелания..."></textarea></div>
    <div class="field"><label>Бюджет, ₽ (0 — договорной)</label><input id="rf-budget" type="number" inputmode="numeric" min="0" value="0"></div>
    <button class="btn" id="rf-submit">${ic('check-lg')} Разместить заявку</button>`);
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
    if (!chats.length) { viewEl.innerHTML = emptyState('chat-square-dots', 'Пока нет переписок.\nНапишите продавцу из каталога\nили ответьте на заявку.'); return; }
    viewEl.innerHTML = chats.map(chatListItem).join('');
    viewEl.querySelectorAll('[data-chat]').forEach((el) =>
      el.addEventListener('click', () => openChat(Number(el.dataset.chat), JSON.parse(el.dataset.other))));
    await refreshUnread();
  } catch (e) { viewEl.innerHTML = emptyState('exclamation-triangle', e.message); }
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
    closeSheet(); openChat(chat.id, chat.other);
  } catch (e) { toast(e.message); }
}

function openChat(chatId, other) {
  chatOpen = true;
  chatCtx = { id: chatId, other, lastId: 0, timer: null };
  let el = document.getElementById('chat-view');
  if (!el) { el = document.createElement('div'); el.id = 'chat-view'; document.body.appendChild(el); }
  el.innerHTML = `
    <div id="chat-head">
      <button class="back" id="chat-back">${ic('chevron-left')}</button>
      ${avatarHtml(other, 'md')}
      <div><div class="name">${userName(other)}</div><div class="sub" id="chat-sub"></div></div>
    </div>
    <div id="chat-msgs"><div class="loader"><span class="spin"></span></div></div>
    <div id="chat-input-bar">
      <input id="chat-input" placeholder="Сообщение..." autocomplete="off">
      <button id="chat-send">${ic('arrow-up')}</button>
    </div>`;
  el.style.display = 'flex';
  document.getElementById('chat-back').addEventListener('click', closeChat);
  const input = document.getElementById('chat-input');
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { appendMessages([await API.post(`/chats/${chatId}/messages`, { text })]); }
    catch (e) { toast(e.message); input.value = text; }
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
      const box = document.getElementById('chat-msgs'); if (box) box.innerHTML = '';
    }
    appendMessages(data.messages || []);
    if (first) refreshUnread();
  } catch (e) {}
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
  updateBackButton(); refreshUnread();
  if (state.tab === 'chats') renderChats();
}

/* ================= DEALS ================= */
async function renderDeals() {
  topTitle.textContent = 'Сделки';
  const role = state.deals.role;
  viewEl.innerHTML = `
    <div class="seg">
      <button class="${role === 'all' ? 'active' : ''}" data-role="all">Все</button>
      <button class="${role === 'buyer' ? 'active' : ''}" data-role="buyer">Покупки</button>
      <button class="${role === 'seller' ? 'active' : ''}" data-role="seller">Продажи</button>
    </div>
    <div id="deals-list"><div class="loader"><span class="spin"></span></div></div>`;
  viewEl.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => { state.deals.role = b.dataset.role; renderDeals(); }));
  loadDealsList();
}
async function loadDealsList() {
  const list = document.getElementById('deals-list');
  if (!list) return;
  try {
    const deals = await API.get('/deals?role=' + state.deals.role);
    if (!deals.length) { list.innerHTML = emptyState('briefcase', 'Сделок пока нет'); return; }
    list.innerHTML = deals.map(dealCard).join('');
    list.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openDealDetail(Number(c.dataset.id))));
  } catch (e) { list.innerHTML = emptyState('exclamation-triangle', e.message); }
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
      <span class="muted-ic">${ic(role === 'buyer' ? 'cart' : 'cash-coin')} ${role === 'buyer' ? 'Покупка' : 'Продажа'} · ${timeAgo(d.created_at)}</span></div>
      <div class="price">${money(d.amount)}</div>
    </div>
    <div class="card-foot mt8">
      <div class="mini-user">${avatarHtml(other)} ${userName(other)}</div>
      <span class="st st-${d.status}">${ic(DEAL_ICON[d.status])} ${DEAL_STATUS[d.status] || d.status}</span>
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
      <span class="st st-${d.status}">${ic(DEAL_ICON[d.status])} ${DEAL_STATUS[d.status] || d.status}</span>
      <div class="list-group mt12">
        <div class="ios-row"><span class="label">Роль</span><span class="trailing">${role === 'buyer' ? 'Покупатель' : 'Продавец'}</span></div>
        <div class="ios-row"><span class="label">Сумма</span><span class="trailing">${money(d.amount)}</span></div>
        <div class="ios-row"><span class="label">${role === 'buyer' ? 'Продавец' : 'Покупатель'}</span><span class="trailing">${avatarHtml(other)} ${userName(other)}</span></div>
        <div class="ios-row"><span class="label">Создана</span><span class="trailing">${new Date(d.created_at).toLocaleString('ru-RU')}</span></div>
      </div>
      <button class="btn secondary mt12" data-act="chat">${ic('chat-dots')} Открыть чат</button>
      <div id="deal-actions" class="mt8"></div>`);
    sheetBody.querySelector('[data-act="chat"]').addEventListener('click', () => startChat(other.id, d.product_id || 0));
    renderDealActions(d, role);
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
}

function renderDealActions(d, role) {
  const box = document.getElementById('deal-actions');
  if (!box) return;
  const btns = [];
  if (role === 'buyer' && d.status === 'pending') btns.push(['success', 'paid', 'check-circle', 'Я оплатил']);
  if (role === 'buyer' && (d.status === 'paid' || d.status === 'pending')) btns.push(['success', 'completed', 'patch-check', 'Подтвердить получение']);
  if (d.status === 'pending' || d.status === 'paid') {
    btns.push(['danger', 'cancelled', 'x-circle', 'Отменить']);
    btns.push(['secondary', 'disputed', 'exclamation-triangle', 'Открыть спор']);
  }
  if (!btns.length) { box.innerHTML = '<p class="text-hint" style="text-align:center;padding:8px">Сделка завершена</p>'; return; }
  box.innerHTML = btns.map(([cls, st, i, label]) => `<button class="btn ${cls} sm mt8" data-st="${st}">${ic(i)} ${label}</button>`).join('');
  box.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => changeDealStatus(d, b.dataset.st, role)));
}

async function changeDealStatus(d, status, role) {
  if (status === 'completed') return completeDealWithRating(d);
  const labels = { paid: 'отметить как оплаченную', cancelled: 'отменить сделку', disputed: 'открыть спор' };
  if (!(await confirmDialog('Вы уверены, что хотите ' + (labels[status] || 'изменить статус') + '?'))) return;
  try {
    await API.patch('/deals/' + d.id, { status });
    haptic('success'); toast('Статус обновлён'); closeSheet(); loadDealsList();
  } catch (e) { toast(e.message); haptic('error'); }
}

function completeDealWithRating(d) {
  const box = document.getElementById('deal-actions');
  box.innerHTML = `
    <p class="text-hint mb12" style="text-align:center">Оцените продавца и подтвердите получение</p>
    <div id="rate-stars" style="text-align:center;font-size:36px;letter-spacing:8px;color:var(--gold)">
      ${[1, 2, 3, 4, 5].map((n) => `<i class="bi bi-star" data-star="${n}" style="cursor:pointer"></i>`).join('')}
    </div>
    <button class="btn success mt12" id="rate-confirm">${ic('patch-check')} Подтвердить</button>`;
  let rating = 5;
  const paint = () => box.querySelectorAll('[data-star]').forEach((s) => {
    s.className = 'bi bi-star' + (Number(s.dataset.star) <= rating ? '-fill' : '');
  });
  box.querySelectorAll('[data-star]').forEach((s) =>
    s.addEventListener('click', () => { rating = Number(s.dataset.star); paint(); haptic('light'); }));
  paint();
  document.getElementById('rate-confirm').addEventListener('click', async () => {
    try {
      await API.patch('/deals/' + d.id, { status: 'completed', rating });
      haptic('success'); toast('Сделка завершена! Спасибо за оценку'); closeSheet(); loadDealsList();
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
      <div class="field mt8"><textarea id="pf-bio" maxlength="500" placeholder="Расскажите о себе">${esc(me.bio || '')}</textarea></div>
      <button class="btn secondary sm" id="pf-save-bio">${ic('check-lg')} Сохранить</button>

      <div class="section-label">Мои объявления</div>
      <div class="list-group">
        <button class="ios-row" id="pf-products"><span class="ios-ic">${ic('bag')}</span><span class="label">Мои товары</span><span class="chev">${ic('chevron-right')}</span></button>
        <button class="ios-row" id="pf-requests"><span class="ios-ic">${ic('megaphone')}</span><span class="label">Мои заявки</span><span class="chev">${ic('chevron-right')}</span></button>
      </div>

      <div class="section-label">Информация</div>
      <div class="list-group">
        <div class="ios-row"><span class="ios-ic gray">${ic('person-badge')}</span><span class="label">ID</span><span class="trailing">${me.id}</span></div>
        <div class="ios-row"><span class="ios-ic blue">${ic('calendar3')}</span><span class="label">С нами с</span><span class="trailing">${since}</span></div>
        ${me.is_admin ? `<div class="ios-row"><span class="ios-ic gold">${ic('shield-check')}</span><span class="label">Статус</span><span class="trailing">Администратор</span></div>` : ''}
      </div>
      <p class="text-hint mt12" style="text-align:center">Маркет цифровых товаров · v1.0</p>`;

    document.getElementById('pf-save-bio').addEventListener('click', async () => {
      try { await API.patch('/me', { bio: document.getElementById('pf-bio').value.trim() }); toast('Сохранено'); haptic('success'); }
      catch (e) { toast(e.message); }
    });
    document.getElementById('pf-products').addEventListener('click', openMyProducts);
    document.getElementById('pf-requests').addEventListener('click', openMyRequests);
  } catch (e) { viewEl.innerHTML = emptyState('exclamation-triangle', e.message || 'Ошибка загрузки профиля'); }
}

async function openMyProducts() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/products/mine');
    openSheet(`<div class="sheet-title">Мои товары</div>${items.length ? items.map(productCard).join('') : emptyState('bag', 'У вас нет товаров')}`);
    sheetBody.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openProductDetail(Number(c.dataset.id))));
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
}
async function openMyRequests() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/requests/mine');
    openSheet(`<div class="sheet-title">Мои заявки</div>${items.length ? items.map(requestCard).join('') : emptyState('megaphone', 'У вас нет заявок')}`);
    sheetBody.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openRequestDetail(Number(c.dataset.id))));
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
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
  try { state.me = await API.get('/me'); }
  catch (e) {
    viewEl.innerHTML = `<div class="empty"><span class="empty-ic">${ic('lock')}</span>
      <div class="empty-t">Не удалось авторизоваться.\nОткройте приложение через Telegram-бота.</div>
      <div class="text-hint mt12">${esc(e.message || '')}</div></div>`;
    document.getElementById('tabbar').style.display = 'none';
    document.getElementById('topbar-action').innerHTML = '';
    return;
  }
  switchTab('catalog');
  refreshUnread();
  setInterval(() => { if (!chatOpen) refreshUnread(); }, 15000);
}
init();
