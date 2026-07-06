/* ================= Telegram Mini App — Маркет цифровых товаров (Apple UI) ================= */
'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.enableClosingConfirmation && tg.enableClosingConfirmation(); } catch (e) {}
}

/* ---------- theme (white/black + dark green) ---------- */
// Пользователь может выбрать тему вручную в профиле: 'auto' | 'light' | 'dark'.
// Выбор сохраняется на устройстве (localStorage) и переживает перезапуск приложения.
// По умолчанию (пока пользователь сам не выберет иное) — всегда светлая тема,
// независимо от темы Telegram/системы.
const THEME_KEY = 'market_theme_pref';
function getThemePref() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; }
}
function systemScheme() {
  return (tg && tg.colorScheme) ||
    (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const bg = dark ? '#0c1110' : '#f5f5f7';
  try { tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); } catch (e) {}
}
function resolveAndApplyTheme() {
  const pref = getThemePref();
  applyTheme(pref === 'auto' ? systemScheme() : pref);
}
function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
  resolveAndApplyTheme();
}
function initTheme() {
  resolveAndApplyTheme();
  if (tg && tg.onEvent) tg.onEvent('themeChanged', () => { if (getThemePref() === 'auto') applyTheme(systemScheme()); });
}
initTheme();
function paintThemeSeg() {
  const cur = getThemePref();
  document.querySelectorAll('#pf-theme [data-theme-pref]').forEach((b) =>
    b.classList.toggle('active', b.dataset.themePref === cur));
}

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

// Цветные градиенты обложек по категориям
const CAT_GRAD = {
  channel: ['#3b82f6', '#1d4ed8'],
  bot: ['#14b8a6', '#0f766e'],
  script: ['#8b5cf6', '#6d28d9'],
  chat: ['#10b981', '#047857'],
  code: ['#f59e0b', '#b45309'],
  other: ['#64748b', '#334155'],
};
const catGrad = (k) => CAT_GRAD[k] || CAT_GRAD.other;

const SORTS = [
  { v: 'top', l: 'Рекомендуемые (по рейтингу)', i: 'stars' },
  { v: 'new', l: 'Сначала новые', i: 'clock-history' },
  { v: 'cheap', l: 'Сначала дешёвые', i: 'sort-numeric-down' },
  { v: 'expensive', l: 'Сначала дорогие', i: 'sort-numeric-up-alt' },
  { v: 'popular', l: 'Популярные', i: 'fire' },
];
const sortShort = { top: 'Рекомендуемые', new: 'Новые', cheap: 'Дешевле', expensive: 'Дороже', popular: 'Популярные' };

// Тематики каналов
const CHANNEL_GENRES = ['Новости', 'Юмор', 'Крипта', 'Бизнес', 'Технологии', 'Игры', 'Кино', 'Музыка', 'Спорт', 'Образование', 'Мода', 'Путешествия', 'Здоровье', 'Психология', 'Кулинария', 'Авто', 'Искусство', 'Политика', '18+', 'Другое'];

const DEAL_STATUS = { created: 'Сделка создана', in_progress: 'В процессе', review: 'На проверке', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор' };
const DEAL_ICON = { created: 'lock-fill', in_progress: 'arrow-repeat', review: 'search', completed: 'check-circle-fill', cancelled: 'x-circle', disputed: 'exclamation-triangle' };
// Что происходит на каждом этапе
const DEAL_STAGE = {
  created: 'Ожидаем подтверждения продавца',
  in_progress: 'Продавец передаёт товар',
  review: 'Покупатель проверяет товар',
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
  catalog: { category: '', q: '', sort: 'top', minPrice: '', maxPrice: '' },
  exchange: { category: '', q: '' },
  deals: { role: 'all' },
};
let chatOpen = false;
let chatCtx = null;
let productPageOpen = false;
let listPageOpen = false;
let listPageKind = null;

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
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(n);
}
// Сжатие изображения на клиенте перед загрузкой
function compressImage(file, maxW = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('not image'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load error')); };
    img.src = url;
  });
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
  put(p, b) { return this.call('PUT', p, b); },
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
  document.body.style.overflow = (productPageOpen || listPageOpen || chatOpen) ? 'hidden' : '';
  updateBackButton();
}
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

function updateBackButton() {
  if (!tg || !tg.BackButton) return;
  if (chatOpen || productPageOpen || listPageOpen || !overlay.hidden) tg.BackButton.show(); else tg.BackButton.hide();
}
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    const lb = document.getElementById('lightbox');
    if (lb && lb.style.display !== 'none' && lb.style.display !== '') { lb.style.display = 'none'; return; }
    // Порядок = z-index (сверху вниз): лист > чат > страница товара > страница-список
    if (!overlay.hidden) closeSheet();
    else if (chatOpen) closeChat();
    else if (productPageOpen) closeProductPage();
    else if (listPageOpen) closeListPage();
  });
}

// Универсальная полноэкранная страница-список (для «Мои товары», «Мои объявления»)
function ensureListPage(title) {
  let el = document.getElementById('list-page');
  if (!el) { el = document.createElement('div'); el.id = 'list-page'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="pp-head">
      <button class="back" id="lp-back">${ic('chevron-left')}</button>
      <div class="pp-htitle">${esc(title)}</div>
      <div style="width:34px"></div>
    </div>
    <div class="pp-scroll" id="lp-scroll"><div class="loader"><span class="spin"></span></div></div>`;
  el.style.display = 'flex';
  listPageOpen = true;
  document.body.style.overflow = 'hidden';
  document.getElementById('lp-back').addEventListener('click', closeListPage);
  updateBackButton();
  return document.getElementById('lp-scroll');
}
function closeListPage() {
  listPageOpen = false;
  listPageKind = null;
  const el = document.getElementById('list-page');
  if (el) el.style.display = 'none';
  document.body.style.overflow = overlay.hidden ? '' : 'hidden';
  updateBackButton();
}
// Обновить открытую страницу-список после изменений
function refreshListPage() {
  if (!listPageOpen) return;
  if (listPageKind === 'products') openMyProducts();
  else if (listPageKind === 'requests') openMyRequests();
  else if (listPageKind === 'favorites') openFavorites();
}

async function openFavorites() {
  const scroll = ensureListPage('Избранное');
  listPageKind = 'favorites';
  try {
    const items = await API.get('/favorites');
    scroll.innerHTML = items.length
      ? `<div class="plist">${items.map((p, i) => productCard(p, i)).join('')}</div>`
      : emptyState('heart', 'Пока нет избранных товаров.\nНажмите на сердечко на карточке товара.');
    wireProductCards(scroll, openProductDetail);
  } catch (e) { scroll.innerHTML = emptyState('exclamation-triangle', e.message); }
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    // tg.showConfirm может бросить исключение (например, старая версия Telegram) —
    // без try/catch это молча ломало бы кнопку (unhandled rejection, никакой обратной связи).
    try {
      if (tg && tg.showConfirm) { tg.showConfirm(message, (ok) => resolve(!!ok)); return; }
    } catch (e) {}
    resolve(window.confirm(message));
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
function setTopIcon(icon, handler, label) {
  topAction.innerHTML = `<button class="icon-btn" id="topicon-btn" aria-label="${esc(label || '')}">${ic(icon)}</button>`;
  document.getElementById('topicon-btn').addEventListener('click', () => { haptic('light'); handler(); });
}
function setAddButton(handler) { setTopIcon('plus-lg', handler, 'Добавить'); }
function setLoading() { viewEl.innerHTML = '<div class="loader"><span class="spin"></span></div>'; }
function emptyState(icon, text) {
  return `<div class="empty"><span class="empty-ic">${ic(icon)}</span><div class="empty-t">${esc(text)}</div></div>`;
}

/* ================= CATALOG ================= */
function categoryChips(active) {
  let html = `<div class="chips"><button class="chip ${active ? '' : 'active'}" data-cat="">Все <span class="chip-count" data-count="all"></span></button>`;
  for (const c of CATEGORIES)
    html += `<button class="chip ${active === c.key ? 'active' : ''}" data-cat="${c.key}">${ic(c.icon)} ${esc(c.title)} <span class="chip-count" data-count="${c.key}"></span></button>`;
  return html + '</div>';
}
// Подставляет числа в счётчики чипов категорий (без полной перерисовки списка чипов)
function applyCategoryCounts(counts) {
  document.querySelectorAll('.chip-count').forEach((el) => {
    const key = el.dataset.count;
    const n = counts && counts[key];
    el.textContent = n ? `(${n})` : '';
  });
}

// Единый debounce для поиска каталога (общий таймер, не пересоздаётся при каждом рендере)
const debouncedCatSearch = debounce(() => {
  const inp = document.getElementById('cat-search');
  state.catalog.q = inp ? inp.value.trim() : '';
  loadCatalogList();
}, 350);

function skeletonList() {
  const one = `<div class="pcard skeleton"><div class="pcard-av"></div><div class="pcard-main"><div class="skel skel-1"></div><div class="skel skel-2"></div></div></div>`;
  return `<div class="plist">${one.repeat(6)}</div>`;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

async function renderCatalog() {
  topTitle.textContent = 'Каталог';
  setTopIcon('heart', openFavorites, 'Избранное');
  const s = state.catalog;
  const hasPrice = s.minPrice !== '' || s.maxPrice !== '';
  viewEl.innerHTML = `
    <div class="searchbar" id="cat-sb">
      ${ic('search')}
      <input id="cat-search" placeholder="Поиск товаров" value="${esc(s.q)}">
      <button class="sb-clear ${s.q ? '' : 'hidden'}" id="cat-clear" aria-label="Очистить">${ic('x-circle-fill')}</button>
    </div>
    ${categoryChips(s.category)}
    <div class="toolbar">
      <span class="text-hint" id="cat-count"></span>
      <div class="toolbar-actions">
        <button class="pill-btn" id="cat-sort-btn">${ic('arrow-down-up')} <span id="cat-sort-lb">${sortShort[s.sort]}</span></button>
        <button class="pill-btn ${hasPrice ? 'active' : ''}" id="cat-filter-btn">${ic('sliders2')} Фильтр</button>
      </div>
    </div>
    <div id="cat-list">${skeletonList()}</div>`;

  document.querySelectorAll('#view .chip').forEach((ch) =>
    ch.addEventListener('click', () => { s.category = ch.dataset.cat; renderCatalog(); }));

  const searchInput = document.getElementById('cat-search');
  const clearBtn = document.getElementById('cat-clear');
  searchInput.addEventListener('input', () => { clearBtn.classList.toggle('hidden', !searchInput.value); debouncedCatSearch(); });
  clearBtn.addEventListener('click', () => { searchInput.value = ''; s.q = ''; clearBtn.classList.add('hidden'); loadCatalogList(); });

  document.getElementById('cat-sort-btn').addEventListener('click', openSortSheet);
  document.getElementById('cat-filter-btn').addEventListener('click', openFilterSheet);
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
    if (s.minPrice !== '') qs.set('minPrice', s.minPrice);
    if (s.maxPrice !== '') qs.set('maxPrice', s.maxPrice);
    const items = await API.get('/products?' + qs.toString());
    const countEl = document.getElementById('cat-count');
    if (countEl) countEl.textContent = items.length
      ? `${items.length} ${plural(items.length, 'товар', 'товара', 'товаров')}`
      : 'Ничего не найдено';
    if (!items.length) { list.innerHTML = emptyState('bag', 'По вашему запросу\nничего не найдено'); return; }
    list.innerHTML = `<div class="plist">${items.map((p, i) => productCard(p, i)).join('')}</div>`;
    wireProductCards(list, openProductDetail);
  } catch (e) { list.innerHTML = emptyState('exclamation-triangle', e.message || 'Не удалось загрузить'); return; }
  // Счётчики категорий подгружаем отдельно и не блокируем ими показ списка товаров
  try {
    applyCategoryCounts(await API.get('/products/counts' + (s.q ? '?q=' + encodeURIComponent(s.q) : '')));
  } catch (e) {}
}

function openSortSheet() {
  const cur = state.catalog.sort;
  openSheet(`<div class="sheet-title">Сортировка</div>
    <div class="list-group">${SORTS.map((o) => `
      <button class="ios-row" data-sort="${o.v}">
        <span class="ios-ic">${ic(o.i)}</span>
        <span class="label">${o.l}</span>
        ${cur === o.v ? `<span class="sc-check">${ic('check-lg')}</span>` : ''}
      </button>`).join('')}</div>`);
  sheetBody.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      state.catalog.sort = b.dataset.sort;
      const lb = document.getElementById('cat-sort-lb'); if (lb) lb.textContent = sortShort[b.dataset.sort];
      haptic('light'); closeSheet(); loadCatalogList();
    }));
}

function openFilterSheet() {
  const s = state.catalog;
  openSheet(`<div class="sheet-title">Фильтр по цене</div>
    <div class="field"><label>Диапазон цены, ₽</label>
      <div class="range-row">
        <input id="flt-min" type="number" inputmode="numeric" min="0" placeholder="от" value="${s.minPrice}">
        <span class="range-dash">—</span>
        <input id="flt-max" type="number" inputmode="numeric" min="0" placeholder="до" value="${s.maxPrice}">
      </div>
    </div>
    <div class="btn-row">
      <button class="btn secondary" id="flt-reset">${ic('arrow-counterclockwise')} Сбросить</button>
      <button class="btn" id="flt-apply">${ic('check-lg')} Применить</button>
    </div>`);
  document.getElementById('flt-apply').addEventListener('click', () => {
    const mn = document.getElementById('flt-min').value.trim();
    const mx = document.getElementById('flt-max').value.trim();
    s.minPrice = mn === '' ? '' : Math.max(0, Number(mn) || 0);
    s.maxPrice = mx === '' ? '' : Math.max(0, Number(mx) || 0);
    haptic('light'); closeSheet(); renderCatalog();
  });
  document.getElementById('flt-reset').addEventListener('click', () => {
    s.minPrice = ''; s.maxPrice = ''; closeSheet(); renderCatalog();
  });
}

function productCard(p, index) {
  const c = catByKey(p.category);
  const g = catGrad(p.category);
  const isChannel = p.category === 'channel';
  let specs = '';
  if (isChannel && (p.subscribers || p.reach24)) {
    const parts = [];
    if (p.subscribers) parts.push(`${ic('people')} ${fmtNum(p.subscribers)}`);
    if (p.reach24) parts.push(`${ic('graph-up')} ${fmtNum(p.reach24)}`);
    specs = parts.join(' · ');
  } else if (p.description) {
    specs = esc(p.description);
  }
  let tags;
  if (isChannel && p.genres && p.genres.length) {
    tags = p.genres.slice(0, 2).map((x) => `<span class="tag">${esc(x)}</span>`).join('') +
      (p.genres.length > 2 ? `<span class="tag more">+${p.genres.length - 2}</span>` : '');
  } else {
    tags = `<span class="tag">${ic(c.icon)} ${esc(c.title)}</span>`;
  }
  if (p.status && p.status !== 'active') tags += `<span class="tag more">${statusProductLabel(p.status)}</span>`;
  const delay = Math.min((index || 0) * 45, 420);
  const isFav = !!p.is_favorite;
  const rating = Number(p.seller_rating) || 0;
  const isTopSeller = rating >= 4.5 && Number(p.seller_deals) >= 3;
  const sellerMini = rating > 0
    ? `<div class="pcard-seller-mini">${isTopSeller ? `${ic('patch-check-fill', 'pcard-top-badge')}` : ''}${ic('star-fill')}${rating.toFixed(1)}</div>`
    : '';
  return `<div class="pcard" data-id="${p.id}" style="--c1:${g[0]};--c2:${g[1]};--d:${delay}ms">
    <div class="pcard-av">
      ${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : ic(c.icon)}
      <button class="pcard-heart ${isFav ? 'active' : ''}" data-fav="${p.id}" aria-label="В избранное">${ic(isFav ? 'heart-fill' : 'heart')}</button>
    </div>
    <div class="pcard-main">
      <div class="pcard-title">${esc(p.title)}</div>
      ${specs ? `<div class="pcard-specs">${specs}</div>` : ''}
      <div class="pcard-bottom-row">
        <div class="pcard-tags">${tags}</div>
        ${sellerMini}
      </div>
    </div>
    <div class="pcard-price">${money(p.price)}</div>
  </div>`;
}

// Навешивает клик-по-карточке (открыть товар) и клик-по-сердцу (избранное) на список .pcard в контейнере
function wireProductCards(container, onOpen) {
  container.querySelectorAll('.pcard').forEach((el) =>
    el.addEventListener('click', () => onOpen(Number(el.dataset.id))));
  container.querySelectorAll('[data-fav]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFavoriteBtn(btn); }));
}

async function toggleFavoriteBtn(btn) {
  const id = btn.dataset.fav;
  const wasActive = btn.classList.contains('active');
  btn.classList.toggle('active', !wasActive);
  btn.innerHTML = ic(wasActive ? 'heart' : 'heart-fill');
  haptic(wasActive ? 'light' : 'success');
  try {
    await API.post(`/products/${id}/favorite`, {});
    // Убрали из избранного прямо на странице «Избранное» — карточка сразу исчезает из списка
    if (wasActive && listPageKind === 'favorites') {
      const card = btn.closest('.pcard');
      if (card) card.remove();
    }
  } catch (e) {
    btn.classList.toggle('active', wasActive);
    btn.innerHTML = ic(wasActive ? 'heart-fill' : 'heart');
    toast(e.message);
  }
}

// ---------- полноэкранная страница товара ----------
async function openProductDetail(id) {
  let el = document.getElementById('product-page');
  if (!el) { el = document.createElement('div'); el.id = 'product-page'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="pp-head">
      <button class="back" id="pp-back">${ic('chevron-left')}</button>
      <div class="pp-htitle">Товар</div>
      <div id="pp-fav-slot" style="width:34px"></div>
    </div>
    <div class="pp-scroll"><div class="loader"><span class="spin"></span></div></div>`;
  el.style.display = 'flex';
  productPageOpen = true;
  document.body.style.overflow = 'hidden';
  document.getElementById('pp-back').addEventListener('click', closeProductPage);
  updateBackButton();
  try {
    renderProductPage(await API.get('/products/' + id));
  } catch (e) {
    el.querySelector('.pp-scroll').innerHTML = emptyState('exclamation-triangle', e.message || 'Ошибка');
  }
}

function closeProductPage() {
  productPageOpen = false;
  const el = document.getElementById('product-page');
  if (el) el.style.display = 'none';
  document.body.style.overflow = (!overlay.hidden || listPageOpen) ? 'hidden' : '';
  updateBackButton();
  if (state.tab === 'catalog') loadCatalogList();
  refreshListPage();
}

function renderProductPage(p) {
  const el = document.getElementById('product-page');
  if (!el) return;
  const scroll = el.querySelector('.pp-scroll');
  const c = catByKey(p.category);
  const g = catGrad(p.category);
  const mine = state.me && p.seller_id === state.me.id;
  const seller = { first_name: p.seller_name, username: p.seller_username, photo_url: p.seller_photo };
  const isChannel = p.category === 'channel';

  const favSlot = document.getElementById('pp-fav-slot');
  if (favSlot && !mine) {
    const isFav = !!p.is_favorite;
    favSlot.style.width = '';
    favSlot.innerHTML = `<button class="icon-btn pcard-heart-lg ${isFav ? 'active' : ''}" id="pp-fav-btn" data-fav="${p.id}" aria-label="В избранное">${ic(isFav ? 'heart-fill' : 'heart')}</button>`;
    document.getElementById('pp-fav-btn').addEventListener('click', (e) => toggleFavoriteBtn(e.currentTarget));
  }

  const genresHtml = isChannel && p.genres && p.genres.length
    ? `<div class="pp-section"><div class="pp-label">Тематики</div><div class="pp-tags">${p.genres.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>`
    : '';

  const rows = [];
  if (isChannel) {
    if (p.subscribers) rows.push([ic('people'), 'Подписчики', p.subscribers.toLocaleString('ru-RU')]);
    if (p.reach24) rows.push([ic('graph-up'), 'Охват за 24 ч', p.reach24.toLocaleString('ru-RU')]);
    if (p.avg_age) rows.push([ic('person'), 'Средний возраст', esc(p.avg_age)]);
  }
  const specsHtml = rows.length
    ? `<div class="pp-section"><div class="pp-label">Характеристики</div><div class="list-group">${rows.map(([i, k, v]) => `<div class="ios-row"><span class="ios-ic">${i}</span><span class="label">${k}</span><span class="trailing">${v}</span></div>`).join('')}</div></div>`
    : '';

  const descHtml = p.description
    ? `<div class="pp-section"><div class="pp-label">Описание</div><div class="pp-desc">${esc(p.description)}</div></div>`
    : '';

  const shotsHtml = (p.screenshots && p.screenshots.length)
    ? `<div class="pp-section"><div class="pp-label">Скриншоты статистики</div><div class="pp-shots">${p.screenshots.map((u, i) => `<img class="pp-shot" src="${esc(u)}" data-shot="${i}" alt="">`).join('')}</div></div>`
    : '';

  scroll.innerHTML = `
    <div class="pp-hero" style="--c1:${g[0]};--c2:${g[1]}">
      ${ic(c.icon, 'pp-hero-ic')}
      <div class="pp-hero-chips">
        <span class="hero-chip">${ic(c.icon)} ${esc(c.title)}</span>
        ${p.status !== 'active' ? `<span class="hero-chip">${statusProductLabel(p.status)}</span>` : ''}
      </div>
      <div class="pp-hero-bottom">
        <div class="pp-hero-av">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : ic(c.icon)}</div>
        <div class="pp-hero-price">${money(p.price)}</div>
      </div>
    </div>
    <div class="pp-title">${esc(p.title)}</div>
    <div class="mini-stats">
      <span class="mini-stat">${ic('eye')} ${p.views || 0} просмотров</span>
      <span class="mini-stat">${ic('clock')} ${timeAgo(p.created_at)}</span>
    </div>
    ${genresHtml}${specsHtml}${descHtml}${shotsHtml}
    <div class="pp-section">
      <div class="pp-label">Продавец</div>
      <div class="seller-card${mine ? '' : ' tappable'}">
        ${avatarHtml(seller, 'md')}
        <div class="sc-main">
          <div class="sc-name">${userName(seller)}${mine ? ' <span class="text-hint">(вы)</span>' : ''}</div>
          <div class="sc-sub">${stars(p.seller_rating)} · ${p.seller_deals || 0} ${plural(p.seller_deals || 0, 'сделка', 'сделки', 'сделок')}</div>
        </div>
        ${mine ? '' : `<span class="sc-chev">${ic('chevron-right')}</span>`}
      </div>
    </div>
    <div id="pp-reviews"></div>`;

  loadSellerReviews(p.seller_id);

  let actionsHtml;
  if (mine) {
    actionsHtml = `<div class="btn-row">
      <button class="btn secondary" data-act="toggle">${ic(p.status === 'active' ? 'eye-slash' : 'eye')} ${p.status === 'active' ? 'Скрыть' : 'Опубликовать'}</button>
      <button class="btn danger" data-act="del">${ic('trash')} Удалить</button></div>`;
  } else {
    const off = p.status !== 'active';
    actionsHtml = `<button class="btn" data-act="buy"${off ? ' disabled' : ''}>${ic('shield-check')} ${off ? 'Товар недоступен' : 'Безопасно купить · ' + money(p.price)}</button>
      <button class="btn secondary mt8" data-act="chat">${ic('chat-dots')} Связаться с владельцем</button>`;
  }
  let bar = el.querySelector('.pp-actions');
  if (!bar) { bar = document.createElement('div'); bar.className = 'pp-actions'; el.appendChild(bar); }
  bar.innerHTML = actionsHtml;

  scroll.querySelectorAll('[data-shot]').forEach((img) =>
    img.addEventListener('click', () => openLightbox(p.screenshots[Number(img.dataset.shot)])));
  if (!mine) scroll.querySelector('.seller-card')?.addEventListener('click', () => startChat(p.seller_id, p.id));
  bar.querySelector('[data-act="buy"]')?.addEventListener('click', () => { if (p.status === 'active') buyProduct(p); });
  bar.querySelector('[data-act="chat"]')?.addEventListener('click', () => startChat(p.seller_id, p.id));
  bar.querySelector('[data-act="toggle"]')?.addEventListener('click', async () => {
    try {
      await API.patch(`/products/${p.id}/status`, { status: p.status === 'active' ? 'hidden' : 'active' });
      haptic('success'); toast('Готово'); closeProductPage();
    } catch (e) { toast(e.message); haptic('error'); }
  });
  bar.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Удалить товар?'))) return;
    try {
      await API.del('/products/' + p.id); haptic('success'); toast('Удалено'); closeProductPage();
    } catch (e) { toast(e.message); haptic('error'); }
  });
}

function openLightbox(url) {
  if (!url) return;
  let lb = document.getElementById('lightbox');
  if (!lb) { lb = document.createElement('div'); lb.id = 'lightbox'; document.body.appendChild(lb); }
  lb.innerHTML = `<button class="lb-close">${ic('x-lg')}</button><img src="${esc(url)}" alt="">`;
  lb.style.display = 'flex';
  lb.onclick = () => { lb.style.display = 'none'; };
}
function reviewStars(n) {
  return '<span class="review-stars">' + [1, 2, 3, 4, 5].map((i) => ic('star' + (i <= n ? '-fill' : ''))).join('') + '</span>';
}
function reviewCard(r) {
  const u = { first_name: r.buyer_name, username: r.buyer_username, photo_url: r.buyer_photo };
  return `<div class="review-card">
    <div class="review-head">${avatarHtml(u)}<span class="review-name">${userName(u)}</span><span class="review-date">${timeAgo(r.created_at)}</span></div>
    ${reviewStars(r.stars)}
    <div class="review-text">${esc(r.comment)}</div>
  </div>`;
}
async function loadSellerReviews(sellerId) {
  const box = document.getElementById('pp-reviews');
  if (!box) return;
  try {
    const reviews = await API.get('/reviews?sellerId=' + sellerId);
    if (!reviews.length) return;
    box.innerHTML = `<div class="pp-section"><div class="pp-label">Отзывы о продавце (${reviews.length})</div>${reviews.map(reviewCard).join('')}</div>`;
  } catch (e) {}
}
function statusProductLabel(s) { return { active: 'Активен', hidden: 'Скрыт', sold: 'Продан', reserved: 'В сделке' }[s] || s; }

async function buyProduct(p) {
  if (!(await confirmDialog(`Оплатить ${money(p.price)} с баланса и создать сделку?\n\nДеньги замораживаются в сделке и уйдут продавцу только после того, как вы подтвердите получение товара.`))) return;
  try {
    const deal = await API.post('/deals', { productId: p.id });
    state.me = await API.get('/me'); // обновим баланс
    haptic('success');
    closeSheet();
    toast('Сделка создана, средства заморожены');
    await refreshUnread();
    switchTab('deals'); // переключаем ДО закрытия страницы, чтобы не грузить каталог зря
    if (productPageOpen) closeProductPage();
    setTimeout(() => openDealDetail(deal.id), 220);
  } catch (e) {
    haptic('error');
    if (e.status === 400 && e.data && e.data.error === 'insufficient_funds') {
      if (await confirmDialog('Недостаточно средств на балансе. Пополнить баланс?')) openTopupSheet();
    } else {
      toast(e.message);
    }
  }
}

function openProductForm(edit) {
  const isEdit = !!edit;
  const genresSel = new Set(isEdit && Array.isArray(edit.genres) ? edit.genres : []);
  const shots = isEdit && Array.isArray(edit.screenshots) ? [...edit.screenshots] : [];
  let avatarUrl = isEdit ? (edit.avatar || '') : '';
  const initSubs = isEdit && edit.subscribers ? edit.subscribers : '';
  const initReach = isEdit && edit.reach24 ? edit.reach24 : '';
  const initAge = isEdit ? (edit.avg_age || '') : '';
  openSheet(`
    <div class="sheet-title">${isEdit ? 'Редактировать товар' : 'Новый товар'}</div>
    <div class="field"><label>Категория</label><select id="f-cat">${CATEGORIES.map((c) => `<option value="${c.key}" ${isEdit && edit.category === c.key ? 'selected' : ''}>${c.title}</option>`).join('')}</select></div>
    <div class="field"><label>Аватар товара</label>
      <div class="avatar-upload">
        <div class="avatar-preview" id="f-av-prev"></div>
        <div class="avatar-upload-actions">
          <label class="upload-btn" for="f-av-file">${ic('image')} Загрузить фото</label>
          <button type="button" class="btn-link" id="f-av-rm" hidden>Убрать</button>
        </div>
        <input id="f-av-file" type="file" accept="image/*" hidden>
      </div>
    </div>
    <div class="field"><label>Название</label><input id="f-title" maxlength="120" value="${isEdit ? esc(edit.title) : ''}" placeholder="Напр. Telegram-канал 50к подписчиков"></div>
    <div id="f-channel"></div>
    <div class="field"><label>Описание</label><textarea id="f-desc" maxlength="4000" placeholder="Расскажите о товаре, условиях передачи и т.д.">${isEdit ? esc(edit.description) : ''}</textarea></div>
    <div class="field"><label>Цена, ₽ (0 — договорная)</label><input id="f-price" type="number" inputmode="numeric" min="0" value="${isEdit ? (edit.price || 0) : 0}"></div>
    <button class="btn" id="f-submit">${ic('check-lg')} ${isEdit ? 'Сохранить' : 'Опубликовать'}</button>`);

  const catSel = document.getElementById('f-cat');
  const chanBox = document.getElementById('f-channel');

  // --- аватар товара ---
  const avPrev = document.getElementById('f-av-prev');
  const avRm = document.getElementById('f-av-rm');
  const avFile = document.getElementById('f-av-file');
  function renderAvatar() {
    const g = catGrad(catSel.value);
    avPrev.style.setProperty('--c1', g[0]);
    avPrev.style.setProperty('--c2', g[1]);
    avPrev.innerHTML = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="">` : ic(catByKey(catSel.value).icon);
    avRm.hidden = !avatarUrl;
  }
  avFile.addEventListener('change', async () => {
    const file = avFile.files && avFile.files[0];
    avFile.value = '';
    if (!file) return;
    try {
      const { url } = await API.post('/upload', { image: await compressImage(file, 400, 0.82) });
      avatarUrl = url; renderAvatar(); haptic('success');
    } catch (e) { toast('Не удалось загрузить изображение'); }
  });
  avRm.addEventListener('click', () => { avatarUrl = ''; renderAvatar(); });

  const shotsPreview = () => shots.map((u, i) =>
    `<div class="shot-thumb"><img src="${esc(u)}"><button type="button" class="shot-rm" data-rm="${i}">${ic('x-lg')}</button></div>`).join('');
  const refreshShots = () => {
    const box = document.getElementById('f-shots');
    if (!box) return;
    box.innerHTML = shotsPreview();
    box.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => { shots.splice(Number(b.dataset.rm), 1); refreshShots(); }));
  };

  function renderChannel() {
    if (catSel.value !== 'channel') { chanBox.innerHTML = ''; return; }
    chanBox.innerHTML = `
      <div class="field"><label>Тематики канала</label>
        <div class="genre-pick" id="f-genres">${CHANNEL_GENRES.map((gname) =>
          `<button type="button" class="chip ${genresSel.has(gname) ? 'active' : ''}" data-g="${esc(gname)}">${esc(gname)}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Подписчики</label><input id="f-subs" type="number" inputmode="numeric" min="0" value="${initSubs}" placeholder="напр. 52000"></div>
      <div class="field"><label>Охват поста за 24 ч</label><input id="f-reach" type="number" inputmode="numeric" min="0" value="${initReach}" placeholder="напр. 18000"></div>
      <div class="field"><label>Средний возраст аудитории</label><input id="f-age" maxlength="40" value="${esc(initAge)}" placeholder="напр. 25–34"></div>
      <div class="field"><label>Скриншоты статистики</label>
        <div class="shots-edit" id="f-shots">${shotsPreview()}</div>
        <label class="upload-btn" for="f-file">${ic('image')} Добавить скриншот</label>
        <input id="f-file" type="file" accept="image/*" multiple hidden>
      </div>`;
    chanBox.querySelectorAll('[data-g]').forEach((b) =>
      b.addEventListener('click', () => {
        const gname = b.dataset.g;
        if (genresSel.has(gname)) genresSel.delete(gname); else genresSel.add(gname);
        b.classList.toggle('active'); haptic('light');
      }));
    refreshShots();
    const fileInput = document.getElementById('f-file');
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      for (const file of files) {
        if (shots.length >= 8) { toast('Максимум 8 скриншотов'); break; }
        try {
          const { url } = await API.post('/upload', { image: await compressImage(file) });
          shots.push(url); refreshShots();
        } catch (e) { toast('Не удалось загрузить изображение'); }
      }
    });
  }
  catSel.addEventListener('change', () => { renderChannel(); renderAvatar(); });
  renderChannel();
  renderAvatar();

  document.getElementById('f-submit').addEventListener('click', async () => {
    const category = catSel.value;
    const body = {
      category,
      title: document.getElementById('f-title').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      price: Number(document.getElementById('f-price').value) || 0,
      avatar: avatarUrl,
    };
    if (category === 'channel') {
      body.genres = [...genresSel];
      body.subscribers = Number(document.getElementById('f-subs')?.value) || 0;
      body.reach24 = Number(document.getElementById('f-reach')?.value) || 0;
      body.avg_age = (document.getElementById('f-age')?.value || '').trim();
      body.screenshots = shots;
    }
    if (body.title.length < 3) return toast('Введите название (мин. 3 символа)');
    try {
      if (isEdit) await API.put('/products/' + edit.id, body);
      else await API.post('/products', body);
      haptic('success'); closeSheet(); toast(isEdit ? 'Изменения сохранены' : 'Товар опубликован');
      if (state.tab === 'catalog') loadCatalogList();
      refreshListPage();
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
      try {
        await API.patch(`/requests/${r.id}/status`, { status: 'closed' });
        toast('Заявка закрыта'); closeSheet(); loadExchangeList(); refreshListPage();
      } catch (e) { toast(e.message); haptic('error'); }
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
      refreshListPage();
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
  if (chatCtx && chatCtx.timer) clearInterval(chatCtx.timer); // не оставляем висящий поллинг
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

function deadlineInfo(d) {
  if (!['created', 'in_progress', 'review'].includes(d.status) || !d.deadline_at) return null;
  const ms = d.deadline_at - Date.now();
  const abs = Math.abs(ms);
  let t;
  if (abs >= 86400000) { const dd = Math.floor(abs / 86400000), hh = Math.floor((abs % 86400000) / 3600000); t = `${dd} дн${hh ? ' ' + hh + ' ч' : ''}`; }
  else if (abs >= 3600000) { const h = Math.floor(abs / 3600000), m = Math.floor((abs % 3600000) / 60000); t = `${h} ч ${m} мин`; }
  else { t = `${Math.max(1, Math.floor(abs / 60000))} мин`; }
  return ms <= 0 ? { overdue: true, text: 'просрочено на ' + t } : { overdue: false, text: 'осталось ' + t };
}

function dealCard(d) {
  const role = dealRole(d);
  const other = role === 'buyer'
    ? { first_name: d.seller_name, username: d.seller_username, photo_url: d.seller_photo }
    : { first_name: d.buyer_name, username: d.buyer_username, photo_url: d.buyer_photo };
  const di = deadlineInfo(d);
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
    ${di ? `<div class="deal-timer ${di.overdue ? 'overdue' : ''}">${ic(di.overdue ? 'exclamation-circle' : 'clock')} ${di.text}</div>` : ''}
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
    const di = deadlineInfo(d);
    const stage = DEAL_STAGE[d.status];
    openSheet(`
      <div class="sheet-title">${esc(d.title)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="st st-${d.status}">${ic(DEAL_ICON[d.status])} ${DEAL_STATUS[d.status] || d.status}</span>
        ${di ? `<span class="deal-timer inline ${di.overdue ? 'overdue' : ''}">${ic(di.overdue ? 'exclamation-circle' : 'clock')} ${di.text}</span>` : ''}
      </div>
      ${stage ? `<p class="text-hint mt8">${esc(stage)}${d.status === 'review' ? ' · иначе завершится автоматически' : ''}</p>` : ''}
      <div class="escrow-note mt12">${ic('shield-lock')} ${money(d.amount)} заморожены в сделке и уйдут продавцу только после подтверждения получения.</div>
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
  const btns = []; // [cls, action, icon, label]
  if (role === 'seller') {
    if (d.status === 'created') btns.push(['success', 'confirm', 'check-circle', 'Подтвердить сделку']);
    if (d.status === 'in_progress') btns.push(['success', 'deliver', 'box-seam', 'Передать на проверку']);
    if (['created', 'in_progress'].includes(d.status)) btns.push(['danger', 'cancel', 'x-circle', 'Отменить сделку']);
  } else {
    if (d.status === 'review') btns.push(['success', 'complete', 'patch-check', 'Подтвердить получение']);
    if (d.status === 'in_progress' && d.overdue) btns.push(['danger', 'cancel', 'x-circle', 'Отменить и вернуть деньги']);
  }
  if (['created', 'in_progress', 'review'].includes(d.status)) btns.push(['secondary', 'dispute', 'exclamation-triangle', 'Открыть спор']);

  let html = btns.map(([cls, act, i, label]) => `<button class="btn ${cls} sm mt8" data-do="${act}">${ic(i)} ${label}</button>`).join('');
  if (d.status === 'created' && role === 'buyer') html = `<p class="text-hint" style="text-align:center;padding:6px">Ждём подтверждения продавца. Отменить можно после просрочки или через спор.</p>` + html;
  if (d.status === 'in_progress' && role === 'buyer' && !d.overdue) html = `<p class="text-hint" style="text-align:center;padding:6px">Продавец передаёт товар. Отменить сможете после просрочки (24 ч).</p>` + html;
  if (d.status === 'review' && role === 'seller') html = `<p class="text-hint" style="text-align:center;padding:6px">Ожидаем подтверждения покупателя.</p>` + html;
  if (['completed', 'cancelled'].includes(d.status)) html = `<p class="text-hint" style="text-align:center;padding:8px">${d.status === 'completed' ? 'Сделка успешно завершена' : 'Сделка отменена, средства возвращены покупателю'}</p>`;
  if (d.status === 'disputed') html = `<p class="text-hint" style="text-align:center;padding:8px">${ic('exclamation-triangle')} Спор рассматривается администратором</p>`;
  box.innerHTML = html;
  box.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => dealAction(d, b.dataset.do, role)));
}

async function dealAction(d, action, role) {
  if (action === 'complete') return completeDealWithRating(d);
  const texts = {
    confirm: 'Подтвердить сделку? У вас будет 24 часа на передачу товара.',
    deliver: 'Передать товар на проверку покупателю?',
    cancel: role === 'seller' ? 'Отменить сделку? Деньги вернутся покупателю.' : 'Отменить сделку и вернуть свои деньги на баланс?',
    dispute: 'Открыть спор? Решение примет администратор.',
  };
  if (!(await confirmDialog(texts[action] || 'Продолжить?'))) return;
  try {
    await API.post(`/deals/${d.id}/${action}`, {});
    if (action === 'cancel') state.me = await API.get('/me');
    haptic('success'); toast('Готово'); closeSheet(); loadDealsList();
  } catch (e) { toast(e.message); haptic('error'); }
}

function completeDealWithRating(d) {
  const box = document.getElementById('deal-actions');
  box.innerHTML = `
    <div class="escrow-note mt8">${ic('info-circle')} После подтверждения ${money(d.amount)} уйдут продавцу. Оставьте отзыв о продавце — оценка и комментарий обязательны.</div>
    <div id="rate-stars" style="text-align:center;font-size:36px;letter-spacing:8px;color:var(--gold);margin:10px 0">
      ${[1, 2, 3, 4, 5].map((n) => `<i class="bi bi-star" data-star="${n}" style="cursor:pointer"></i>`).join('')}
    </div>
    <div class="field"><textarea id="rate-comment" maxlength="1000" placeholder="Комментарий к отзыву (обязательно): как прошла сделка, качество товара, общение с продавцом..."></textarea></div>
    <button class="btn success" id="rate-confirm">${ic('patch-check')} Подтвердить и оставить отзыв</button>`;
  let rating = 5;
  const paint = () => box.querySelectorAll('[data-star]').forEach((s) => {
    s.className = 'bi bi-star' + (Number(s.dataset.star) <= rating ? '-fill' : '');
  });
  box.querySelectorAll('[data-star]').forEach((s) =>
    s.addEventListener('click', () => { rating = Number(s.dataset.star); paint(); haptic('light'); }));
  paint();
  document.getElementById('rate-confirm').addEventListener('click', async () => {
    const comment = document.getElementById('rate-comment').value.trim();
    if (!rating) return toast('Поставьте оценку от 1 до 5 звёзд');
    if (comment.length < 3) return toast('Напишите комментарий к отзыву');
    try {
      await API.post(`/deals/${d.id}/complete`, { rating, comment });
      haptic('success'); toast('Сделка завершена! Спасибо за отзыв'); closeSheet(); loadDealsList();
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
        <span class="avatar lg">${esc((me.login || '?').charAt(0).toUpperCase())}</span>
        <div class="profile-name">${esc(me.login || 'Пользователь')}</div>
        ${me.email ? `<div class="profile-username">${esc(me.email)}</div>` : ''}
        <div>${stars(me.rating)}</div>
      </div>
      <div class="profile-stats">
        <div class="pstat"><div class="n">${me.deals_count || 0}</div><div class="l">Сделок</div></div>
        <div class="pstat"><div class="n">${me.rating_count || 0}</div><div class="l">Отзывов</div></div>
        <div class="pstat"><div class="n">${(me.rating || 0).toFixed(1)}</div><div class="l">Рейтинг</div></div>
      </div>

      <div class="balance-card">
        <div class="balance-top">
          <span class="balance-label">${ic('wallet2')} Баланс</span>
          <span class="balance-amount">${money(me.balance || 0, '0 ₽')}</span>
        </div>
        <div class="balance-actions">
          <button class="btn sm" id="pf-topup">${ic('plus-circle')} Пополнить</button>
          <button class="btn secondary sm" id="pf-withdraw">${ic('cash-stack')} Вывести</button>
        </div>
        <button class="balance-history" id="pf-history">${ic('clock-history')} История операций</button>
      </div>

      <div class="section-label">Оформление</div>
      <div class="seg seg-theme" id="pf-theme">
        <button data-theme-pref="auto">${ic('phone')}<span>Авто</span></button>
        <button data-theme-pref="light">${ic('sun')}<span>Светлая</span></button>
        <button data-theme-pref="dark">${ic('moon-stars')}<span>Тёмная</span></button>
      </div>

      <div class="section-label">О себе</div>
      <div class="field mt8"><textarea id="pf-bio" maxlength="500" placeholder="Расскажите о себе">${esc(me.bio || '')}</textarea></div>
      <button class="btn secondary sm" id="pf-save-bio">${ic('check-lg')} Сохранить</button>

      <div class="section-label">Мои публикации</div>
      <div class="list-group">
        <button class="ios-row" id="pf-products"><span class="ios-ic">${ic('bag')}</span><span class="label">Мои товары</span><span class="chev">${ic('chevron-right')}</span></button>
        <button class="ios-row" id="pf-requests"><span class="ios-ic">${ic('megaphone')}</span><span class="label">Мои объявления</span><span class="chev">${ic('chevron-right')}</span></button>
      </div>

      <div class="section-label">Аккаунт</div>
      <div class="list-group">
        <div class="ios-row"><span class="ios-ic">${ic('person-badge')}</span><span class="label">Логин</span><span class="trailing">${esc(me.login || '—')}</span></div>
        <div class="ios-row"><span class="ios-ic blue">${ic('envelope')}</span><span class="label">Email</span><span class="trailing">${esc(me.email || '—')}</span></div>
        <div class="ios-row"><span class="ios-ic gray">${ic('telephone')}</span><span class="label">Телефон</span><span class="trailing">${esc(me.phone || '—')}</span></div>
      </div>

      <div class="section-label">Информация</div>
      <div class="list-group">
        <div class="ios-row"><span class="ios-ic gray">${ic('person-badge')}</span><span class="label">ID</span><span class="trailing">${me.seq_id || '—'}</span></div>
        <div class="ios-row"><span class="ios-ic blue">${ic('calendar3')}</span><span class="label">С нами с</span><span class="trailing">${since}</span></div>
      </div>
      <p class="text-hint mt12" style="text-align:center">Маркет цифровых товаров · v1.0</p>`;

    document.getElementById('pf-save-bio').addEventListener('click', async () => {
      try { await API.patch('/me', { bio: document.getElementById('pf-bio').value.trim() }); toast('Сохранено'); haptic('success'); }
      catch (e) { toast(e.message); }
    });
    document.getElementById('pf-products').addEventListener('click', openMyProducts);
    document.getElementById('pf-requests').addEventListener('click', openMyRequests);
    paintThemeSeg();
    document.querySelectorAll('#pf-theme [data-theme-pref]').forEach((b) =>
      b.addEventListener('click', () => { setThemePref(b.dataset.themePref); paintThemeSeg(); haptic('light'); }));
    document.getElementById('pf-topup').addEventListener('click', openTopupSheet);
    document.getElementById('pf-withdraw').addEventListener('click', openWithdrawSheet);
    document.getElementById('pf-history').addEventListener('click', openHistorySheet);
  } catch (e) { viewEl.innerHTML = emptyState('exclamation-triangle', e.message || 'Ошибка загрузки профиля'); }
}

/* ================= WALLET (баланс) ================= */
function openTopupSheet() {
  const quick = [500, 1000, 5000, 10000];
  openSheet(`
    <div class="sheet-title">Пополнить баланс</div>
    <p class="text-hint mb12">Демо-пополнение: средства зачисляются мгновенно, без реальной оплаты.</p>
    <div class="field"><label>Сумма, ₽</label><input id="tp-amount" type="number" inputmode="numeric" min="1" value="1000"></div>
    <div class="quick-amounts">${quick.map((a) => `<button type="button" class="chip" data-amt="${a}">+${a.toLocaleString('ru-RU')}</button>`).join('')}</div>
    <button class="btn mt12" id="tp-submit">${ic('plus-circle')} Пополнить</button>`);
  sheetBody.querySelectorAll('[data-amt]').forEach((b) =>
    b.addEventListener('click', () => { document.getElementById('tp-amount').value = b.dataset.amt; }));
  document.getElementById('tp-submit').addEventListener('click', async () => {
    const amount = Math.floor(Number(document.getElementById('tp-amount').value) || 0);
    if (amount <= 0) return toast('Введите сумму');
    try {
      const { balance } = await API.post('/balance/topup', { amount });
      if (state.me) state.me.balance = balance;
      haptic('success'); closeSheet(); toast('Баланс пополнен');
      if (state.tab === 'profile') renderProfile();
    } catch (e) { toast(e.message); }
  });
}

function openWithdrawSheet() {
  const bal = (state.me && state.me.balance) || 0;
  openSheet(`
    <div class="sheet-title">Вывод средств</div>
    <p class="text-hint mb12">Доступно к выводу: <b>${money(bal, '0 ₽')}</b>. Заявку обработает администратор.</p>
    <div class="field"><label>Сумма, ₽</label><input id="wd-amount" type="number" inputmode="numeric" min="1" placeholder="0"></div>
    <div class="field"><label>Реквизиты (карта / кошелёк)</label><input id="wd-req" maxlength="200" placeholder="Куда вывести средства"></div>
    <button class="btn" id="wd-submit">${ic('cash-stack')} Создать заявку</button>
    <button class="btn secondary sm mt8" id="wd-history">${ic('list-ul')} Мои заявки на вывод</button>`);
  document.getElementById('wd-submit').addEventListener('click', async () => {
    const amount = Math.floor(Number(document.getElementById('wd-amount').value) || 0);
    const requisites = document.getElementById('wd-req').value.trim();
    if (amount <= 0) return toast('Введите сумму');
    try {
      await API.post('/withdrawals', { amount, requisites });
      state.me = await API.get('/me');
      haptic('success'); closeSheet(); toast('Заявка на вывод создана');
      if (state.tab === 'profile') renderProfile();
    } catch (e) {
      if (e.status === 400 && e.data && e.data.error === 'insufficient_funds') toast('Недостаточно средств');
      else toast(e.message);
    }
  });
  document.getElementById('wd-history').addEventListener('click', openWithdrawHistory);
}

const WD_STATUS = { pending: 'На рассмотрении', approved: 'Выполнено', rejected: 'Отклонено' };
async function openWithdrawHistory() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/withdrawals');
    openSheet(`<div class="sheet-title">Заявки на вывод</div>${items.length
      ? '<div class="list-group">' + items.map((w) => `<div class="ios-row">
          <span class="ios-ic ${w.status === 'approved' ? '' : 'gray'}">${ic(w.status === 'approved' ? 'check-lg' : w.status === 'rejected' ? 'x-lg' : 'hourglass-split')}</span>
          <span class="label">${money(w.amount)}<div class="text-hint" style="font-size:12px">${new Date(w.created_at).toLocaleString('ru-RU')}</div></span>
          <span class="trailing">${WD_STATUS[w.status] || w.status}</span></div>`).join('') + '</div>'
      : emptyState('cash-stack', 'Заявок на вывод нет')}`);
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
}

const TX_LABEL = { deposit: 'Пополнение', hold: 'Оплата сделки', release: 'Зачисление за сделку', refund: 'Возврат по сделке', withdraw_hold: 'Заявка на вывод', withdraw_refund: 'Возврат вывода', withdraw_done: 'Корректировка' };
async function openHistorySheet() {
  openSheet('<div class="loader"><span class="spin"></span></div>');
  try {
    const items = await API.get('/transactions');
    openSheet(`<div class="sheet-title">История операций</div>${items.length
      ? '<div class="list-group">' + items.map((t) => {
          const pos = t.amount >= 0;
          return `<div class="ios-row">
            <span class="ios-ic ${pos ? '' : 'gray'}">${ic(pos ? 'arrow-down-left' : 'arrow-up-right')}</span>
            <span class="label">${esc(TX_LABEL[t.type] || t.type)}<div class="text-hint" style="font-size:12px">${esc(t.note || '')}</div></span>
            <span class="trailing" style="color:${pos ? 'var(--green)' : 'var(--text)'}">${pos ? '+' : ''}${money(t.amount)}</span></div>`;
        }).join('') + '</div>'
      : emptyState('clock-history', 'Операций пока нет')}`);
  } catch (e) { openSheet(emptyState('exclamation-triangle', e.message)); }
}

function myProductCard(p, i) {
  return `<div class="mp-item">
    ${productCard(p, i)}
    <div class="mp-actions">
      <button class="mp-btn" data-edit="${p.id}">${ic('pencil')} Изменить</button>
      <button class="mp-btn" data-toggle="${p.id}">${ic(p.status === 'active' ? 'eye-slash' : 'eye')} ${p.status === 'active' ? 'Скрыть' : 'Показать'}</button>
      <button class="mp-btn danger" data-del="${p.id}">${ic('trash')} Удалить</button>
    </div>
  </div>`;
}

async function openMyProducts() {
  const scroll = ensureListPage('Мои товары');
  listPageKind = 'products';
  try {
    const items = await API.get('/products/mine');
    scroll.innerHTML = `
      <button class="btn mb12" id="mp-add">${ic('plus-lg')} Добавить товар</button>
      ${items.length ? items.map((p, i) => myProductCard(p, i)).join('') : emptyState('bag', 'У вас пока нет товаров.\nНажмите «Добавить товар».')}`;
    const byId = (id) => items.find((x) => x.id === Number(id));
    document.getElementById('mp-add').addEventListener('click', () => openProductForm());
    wireProductCards(scroll, openProductDetail);
    scroll.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openProductForm(byId(b.dataset.edit))));
    scroll.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        const p = byId(b.dataset.toggle);
        try {
          await API.patch(`/products/${p.id}/status`, { status: p.status === 'active' ? 'hidden' : 'active' });
          haptic('light'); toast('Готово'); openMyProducts();
        } catch (e) { toast(e.message); haptic('error'); }
      }));
    scroll.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить товар?'))) return;
        try {
          await API.del('/products/' + b.dataset.del); haptic('success'); toast('Удалено'); openMyProducts();
        } catch (e) { toast(e.message); haptic('error'); }
      }));
  } catch (e) { scroll.innerHTML = emptyState('exclamation-triangle', e.message); }
}

function myRequestCard(r) {
  const c = catByKey(r.category);
  const closed = r.status !== 'active';
  return `<div class="mp-item">
    <div class="card" data-id="${r.id}">
      <div class="card-top">
        <div style="min-width:0"><div class="card-title">${esc(r.title)}</div>
        <span class="badge cat">${ic(c.icon)} ${esc(c.title)}</span>
        ${closed ? '<span class="st st-closed">Закрыта</span>' : ''}</div>
        <div class="price">${money(r.budget, 'Бюджет —')}</div>
      </div>
      ${r.description ? `<div class="card-desc">${esc(r.description)}</div>` : ''}
    </div>
    <div class="mp-actions">
      ${closed ? '' : `<button class="mp-btn" data-close="${r.id}">${ic('check-circle')} Закрыть</button>`}
      <button class="mp-btn danger" data-delr="${r.id}">${ic('trash')} Удалить</button>
    </div>
  </div>`;
}

async function openMyRequests() {
  const scroll = ensureListPage('Мои объявления');
  listPageKind = 'requests';
  try {
    const items = await API.get('/requests/mine');
    scroll.innerHTML = `
      <button class="btn mb12" id="mr-add">${ic('plus-lg')} Добавить объявление</button>
      ${items.length ? items.map(myRequestCard).join('') : emptyState('megaphone', 'У вас пока нет объявлений.\nНажмите «Добавить объявление».')}`;
    document.getElementById('mr-add').addEventListener('click', openRequestForm);
    scroll.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openRequestDetail(Number(c.dataset.id))));
    scroll.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await API.patch(`/requests/${b.dataset.close}/status`, { status: 'closed' });
          haptic('light'); toast('Закрыто'); openMyRequests();
        } catch (e) { toast(e.message); haptic('error'); }
      }));
    scroll.querySelectorAll('[data-delr]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить объявление?'))) return;
        try {
          await API.del('/requests/' + b.dataset.delr); haptic('success'); toast('Удалено'); openMyRequests();
        } catch (e) { toast(e.message); haptic('error'); }
      }));
  } catch (e) { scroll.innerHTML = emptyState('exclamation-triangle', e.message); }
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

/* ================= регистрация (обязательная анкета при первом входе) ================= */
function showAuthGate() {
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('tabbar').style.display = 'none';
  let el = document.getElementById('auth-page');
  if (!el) { el = document.createElement('div'); el.id = 'auth-page'; document.body.appendChild(el); }
  el.innerHTML = `
    <form id="rg-form" class="auth-form">
      <div class="auth-scroll">
        <div class="auth-hero">
          <div class="auth-logo">${ic('bag-heart-fill')}</div>
          <div class="auth-title">Добро пожаловать</div>
          <div class="auth-sub">Заполните анкету, чтобы начать пользоваться маркетом</div>
        </div>
        <div class="auth-card">
          <div class="field">
            <label>${ic('envelope')} Email</label>
            <input id="rg-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">
            <div class="field-hint" id="rg-email-hint"></div>
          </div>
          <div class="field">
            <label>${ic('telephone')} Телефон</label>
            <input id="rg-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67">
            <div class="field-hint" id="rg-phone-hint"></div>
          </div>
          <div class="field">
            <label>${ic('person-badge')} Логин</label>
            <input id="rg-login" type="text" autocomplete="username" placeholder="username" maxlength="20">
            <div class="field-hint" id="rg-login-hint"></div>
          </div>
          <div class="field">
            <label>${ic('lock')} Пароль</label>
            <div class="field-pw">
              <input id="rg-pass" type="password" autocomplete="new-password" placeholder="Минимум 8 символов">
              <button type="button" class="field-pw-toggle" data-pw-toggle="rg-pass" aria-label="Показать пароль">${ic('eye')}</button>
            </div>
            <div class="field-hint" id="rg-pass-hint"></div>
          </div>
          <div class="field">
            <label>${ic('lock-fill')} Повторите пароль</label>
            <div class="field-pw">
              <input id="rg-pass2" type="password" autocomplete="new-password" placeholder="Ещё раз">
              <button type="button" class="field-pw-toggle" data-pw-toggle="rg-pass2" aria-label="Показать пароль">${ic('eye')}</button>
            </div>
            <div class="field-hint" id="rg-pass2-hint"></div>
          </div>
        </div>
        <div class="auth-error" id="rg-error" hidden></div>
      </div>
      <div class="pp-actions">
        <button type="submit" class="btn" id="rg-submit" disabled>${ic('arrow-right-circle-fill')} Создать аккаунт</button>
      </div>
    </form>`;
  el.style.display = 'flex';
  wireAuthGate();
}

function wireAuthGate() {
  const $ = (id) => document.getElementById(id);
  const form = $('rg-form');
  const email = $('rg-email'), phone = $('rg-phone'), login = $('rg-login'), pass = $('rg-pass'), pass2 = $('rg-pass2');
  const submit = $('rg-submit'), errBox = $('rg-error');
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const RE_LOGIN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
  const digits = (v) => v.replace(/[^\d+]/g, '');

  function setHint(id, msg) {
    const h = $(id);
    h.textContent = msg || '';
    h.classList.toggle('show', !!msg);
  }
  function validate() {
    const emailOk = RE_EMAIL.test(email.value.trim());
    setHint('rg-email-hint', email.value && !emailOk ? 'Введите корректный email' : '');
    const phoneOk = digits(phone.value).replace('+', '').length >= 10;
    setHint('rg-phone-hint', phone.value && !phoneOk ? 'Введите корректный номер телефона' : '');
    const loginOk = RE_LOGIN.test(login.value.trim());
    setHint('rg-login-hint', login.value && !loginOk ? 'Латиница/цифры/_, 3-20 символов, начало — буква' : '');
    const passOk = pass.value.length >= 8;
    setHint('rg-pass-hint', pass.value && !passOk ? 'Минимум 8 символов' : '');
    const matchOk = pass2.value.length > 0 && pass2.value === pass.value;
    setHint('rg-pass2-hint', pass2.value && !matchOk ? 'Пароли не совпадают' : '');
    const allFilled = email.value.trim() && phone.value.trim() && login.value.trim() && pass.value && pass2.value;
    const ok = !!(allFilled && emailOk && phoneOk && loginOk && passOk && matchOk);
    submit.disabled = !ok;
    return ok;
  }
  [email, phone, login, pass, pass2].forEach((inp) => inp.addEventListener('input', () => { errBox.hidden = true; validate(); }));

  document.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = $(btn.dataset.pwToggle);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = ic(show ? 'eye-slash' : 'eye');
      haptic('light');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) { haptic('error'); return; }
    submit.disabled = true;
    const prevHtml = submit.innerHTML;
    submit.innerHTML = `<span class="spin sm"></span> Создаём аккаунт…`;
    try {
      const me = await API.post('/register', {
        email: email.value.trim(), phone: phone.value.trim(), login: login.value.trim(),
        password: pass.value, password2: pass2.value,
      });
      state.me = me;
      haptic('success');
      document.getElementById('auth-page').style.display = 'none';
      document.getElementById('topbar').style.display = '';
      document.getElementById('tabbar').style.display = '';
      startApp();
    } catch (err) {
      errBox.textContent = err.message || 'Не удалось зарегистрироваться';
      errBox.hidden = false;
      haptic('error');
      submit.innerHTML = prevHtml;
      validate();
    }
  });
  validate();
}

/* ================= init ================= */
function startApp() {
  switchTab('catalog');
  refreshUnread();
  setInterval(() => { if (!chatOpen) refreshUnread(); }, 15000);
}
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
  if (!state.me.registered) { showAuthGate(); return; }
  startApp();
}
init();
