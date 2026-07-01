/* ================= Админ-панель (Apple UI) ================= */
'use strict';
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

function applyTheme(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const bg = dark ? '#0c1110' : '#f5f5f7';
  try { tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); } catch (e) {}
}
(function initTheme() {
  const scheme = (tg && tg.colorScheme) || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(scheme);
  if (tg && tg.onEvent) tg.onEvent('themeChanged', () => applyTheme(tg.colorScheme));
})();

function ic(name, cls) { return `<i class="bi bi-${name}${cls ? ' ' + cls : ''}"></i>`; }

const viewEl = document.getElementById('a-view');
const toastEl = document.getElementById('toast');
const whoami = document.getElementById('a-whoami');

const CATS = {
  channel: { t: 'Каналы', i: 'megaphone' }, bot: { t: 'Боты', i: 'robot' },
  script: { t: 'Скрипты', i: 'file-earmark-code' }, chat: { t: 'Чаты', i: 'chat-square-text' },
  code: { t: 'Коды', i: 'key' }, other: { t: 'Другое', i: 'box-seam' },
};
const DEAL_STATUS = { pending: 'Ожидание', paid: 'Оплачено', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор' };
const catLabel = (k) => { const c = CATS[k] || { t: k, i: 'box-seam' }; return `${ic(c.i)} ${esc(c.t)}`; };

function esc(s) {
  return String(s == null ? '' : s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function toast(m) { toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, 2200); }
function money(n) { n = Number(n) || 0; return n ? n.toLocaleString('ru-RU') + ' ₽' : '—'; }
function dt(ms) { return ms ? new Date(ms).toLocaleString('ru-RU') : ''; }
function userLabel(name, username, id) {
  return `${esc(name || 'Без имени')}${username ? ' · @' + esc(username) : ''} <span class="badge-id">#${id}</span>`;
}
function confirmDialog(msg) {
  return new Promise((res) => { if (tg && tg.showConfirm) tg.showConfirm(msg, (ok) => res(!!ok)); else res(confirm(msg)); });
}

const API = {
  async call(method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    const dev = new URLSearchParams(location.search).get('devUserId');
    if (dev) headers['X-Dev-User-Id'] = dev;
    const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Ошибка'), { status: res.status });
    return data;
  },
  get(p) { return this.call('GET', p); },
  post(p, b) { return this.call('POST', p, b); },
  patch(p, b) { return this.call('PATCH', p, b); },
  del(p) { return this.call('DELETE', p); },
};

let section = 'stats';
document.querySelectorAll('.a-nav-btn').forEach((b) =>
  b.addEventListener('click', () => {
    section = b.dataset.sec;
    document.querySelectorAll('.a-nav-btn').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));

function loading() { viewEl.innerHTML = '<div class="loader"><span class="spin"></span></div>'; }
function empty(t) { return `<div class="empty"><span class="empty-ic">${ic('inbox')}</span><div class="empty-t">${esc(t)}</div></div>`; }
function errBox(e) {
  if (e.status === 403)
    return `<div class="empty"><span class="empty-ic">${ic('shield-lock')}</span><div class="empty-t">Доступ только для администраторов.</div><div class="text-hint mt12">Откройте панель командой /admin у бота.</div></div>`;
  return `<div class="empty"><span class="empty-ic">${ic('exclamation-triangle')}</span><div class="empty-t">${esc(e.message || 'Ошибка')}</div></div>`;
}

function render() {
  loading();
  if (section === 'stats') return renderStats();
  if (section === 'users') return renderUsers();
  if (section === 'products') return renderProducts();
  if (section === 'requests') return renderRequests();
  if (section === 'deals') return renderDeals();
}

/* ---------- STATS ---------- */
async function renderStats() {
  try {
    const s = await API.get('/admin/stats');
    viewEl.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="n">${s.users}</div><div class="l">Пользователей</div></div>
        <div class="stat-box"><div class="n">${s.banned}</div><div class="l">Заблокировано</div></div>
        <div class="stat-box"><div class="n accent">${s.products}</div><div class="l">Товаров (${s.productsActive} активн.)</div></div>
        <div class="stat-box"><div class="n accent">${s.requests}</div><div class="l">Заявок (${s.requestsActive} активн.)</div></div>
        <div class="stat-box"><div class="n">${s.deals}</div><div class="l">Сделок всего</div></div>
        <div class="stat-box"><div class="n">${s.dealsCompleted}</div><div class="l">Завершено</div></div>
        <div class="stat-box"><div class="n" style="color:var(--red)">${s.dealsDisputed}</div><div class="l">Споров</div></div>
        <div class="stat-box"><div class="n">${s.messages}</div><div class="l">Сообщений</div></div>
        <div class="stat-box wide"><div class="n accent">${money(s.volume)}</div><div class="l">Оборот завершённых сделок</div></div>
      </div>`;
  } catch (e) { viewEl.innerHTML = errBox(e); }
}

/* ---------- USERS ---------- */
async function renderUsers(q = '') {
  try {
    const users = await API.get('/admin/users?q=' + encodeURIComponent(q));
    viewEl.innerHTML = `
      <input class="a-search" id="u-q" placeholder="Поиск по имени / @username / id" value="${esc(q)}">
      <div id="u-list">${users.length ? users.map(userItem).join('') : empty('Никого не найдено')}</div>`;
    const qi = document.getElementById('u-q');
    let t; qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderUsers(qi.value.trim()), 350); });
    wireUsers();
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function userItem(u) {
  const rating = u.rating_count ? (u.rating_sum / u.rating_count).toFixed(1) : '—';
  return `<div class="a-item" data-id="${u.id}">
    <div class="a-item-head"><div><div class="a-item-title">${userLabel(u.first_name, u.username, u.id)}</div>
      <div class="a-item-sub">${ic('star-fill')} ${rating} · ${ic('briefcase')} ${u.deals_count || 0} · ${u.is_admin ? ic('shield-check') + ' админ' : 'юзер'}${u.is_banned ? ' · ' + ic('slash-circle') + ' бан' : ''}</div></div>
    </div>
    <div class="a-actions">
      ${u.is_banned
        ? `<button class="a-btn green" data-act="unban">${ic('check-circle')} Разблокировать</button>`
        : `<button class="a-btn red" data-act="ban">${ic('slash-circle')} Заблокировать</button>`}
    </div>
  </div>`;
}
function wireUsers() {
  viewEl.querySelectorAll('.a-item').forEach((it) => {
    const id = it.dataset.id;
    it.querySelector('[data-act="ban"]')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Заблокировать пользователя ' + id + '?'))) return;
      await API.post(`/admin/users/${id}/ban`, { banned: 1 }); toast('Заблокирован'); renderUsers(document.getElementById('u-q').value.trim());
    });
    it.querySelector('[data-act="unban"]')?.addEventListener('click', async () => {
      await API.post(`/admin/users/${id}/ban`, { banned: 0 }); toast('Разблокирован'); renderUsers(document.getElementById('u-q').value.trim());
    });
  });
}

/* ---------- PRODUCTS ---------- */
async function renderProducts() {
  try {
    const items = await API.get('/admin/products?status=all');
    viewEl.innerHTML = items.length ? items.map(productItem).join('') : empty('Нет товаров');
    wireProducts();
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function productItem(p) {
  return `<div class="a-item" data-id="${p.id}">
    <div class="a-item-head"><div><div class="a-item-title">${esc(p.title)}</div>
      <div class="a-item-sub">${catLabel(p.category)} · ${money(p.price)} · ${esc(p.status)} · ${ic('eye')} ${p.views || 0}<br>Продавец: ${userLabel(p.seller_name, p.seller_username, p.seller_id)}</div></div>
    </div>
    <div class="a-actions">
      ${p.status !== 'hidden' ? `<button class="a-btn gray" data-act="hide">${ic('eye-slash')} Скрыть</button>` : `<button class="a-btn green" data-act="show">${ic('eye')} Показать</button>`}
      <button class="a-btn red" data-act="del">${ic('trash')} Удалить</button>
    </div>
  </div>`;
}
function wireProducts() {
  viewEl.querySelectorAll('.a-item').forEach((it) => {
    const id = it.dataset.id;
    it.querySelector('[data-act="hide"]')?.addEventListener('click', async () => { await API.patch(`/admin/products/${id}/status`, { status: 'hidden' }); toast('Скрыт'); renderProducts(); });
    it.querySelector('[data-act="show"]')?.addEventListener('click', async () => { await API.patch(`/admin/products/${id}/status`, { status: 'active' }); toast('Активен'); renderProducts(); });
    it.querySelector('[data-act="del"]')?.addEventListener('click', async () => { if (!(await confirmDialog('Удалить товар?'))) return; await API.del(`/admin/products/${id}`); toast('Удалён'); renderProducts(); });
  });
}

/* ---------- REQUESTS ---------- */
async function renderRequests() {
  try {
    const items = await API.get('/admin/requests?status=all');
    viewEl.innerHTML = items.length ? items.map(requestItem).join('') : empty('Нет заявок');
    viewEl.querySelectorAll('.a-item').forEach((it) => {
      const id = it.dataset.id;
      it.querySelector('[data-act="del"]')?.addEventListener('click', async () => { if (!(await confirmDialog('Удалить заявку?'))) return; await API.del(`/admin/requests/${id}`); toast('Удалена'); renderRequests(); });
    });
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function requestItem(r) {
  return `<div class="a-item" data-id="${r.id}">
    <div class="a-item-head"><div><div class="a-item-title">${esc(r.title)}</div>
      <div class="a-item-sub">${catLabel(r.category)} · бюджет ${money(r.budget)} · ${esc(r.status)}<br>Покупатель: ${userLabel(r.buyer_name, r.buyer_username, r.buyer_id)}</div></div>
    </div>
    <div class="a-actions"><button class="a-btn red" data-act="del">${ic('trash')} Удалить</button></div>
  </div>`;
}

/* ---------- DEALS ---------- */
async function renderDeals() {
  try {
    const items = await API.get('/admin/deals');
    viewEl.innerHTML = items.length ? items.map(dealItem).join('') : empty('Нет сделок');
    viewEl.querySelectorAll('.a-item').forEach((it) => {
      const id = it.dataset.id;
      it.querySelector('[data-act="status"]')?.addEventListener('change', async (e) => {
        await API.patch(`/admin/deals/${id}`, { status: e.target.value }); toast('Статус изменён');
      });
    });
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function dealItem(d) {
  const opts = Object.keys(DEAL_STATUS).map((k) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${DEAL_STATUS[k]}</option>`).join('');
  return `<div class="a-item" data-id="${d.id}">
    <div class="a-item-head"><div><div class="a-item-title">${esc(d.title)} — ${money(d.amount)}</div>
      <div class="a-item-sub">${ic('cart')} ${userLabel(d.buyer_name, d.buyer_username, d.buyer_id)}<br>${ic('cash-coin')} ${userLabel(d.seller_name, d.seller_username, d.seller_id)}<br>${dt(d.created_at)}</div></div>
    </div>
    <div class="a-actions"><select class="a-select" data-act="status">${opts}</select></div>
  </div>`;
}

/* ---------- init ---------- */
(async function init() {
  try {
    const me = await API.get('/me');
    whoami.innerHTML = esc(me.first_name || 'Админ') + (me.is_admin ? ' · ' + ic('shield-check') + ' администратор' : '');
    if (!me.is_admin) { viewEl.innerHTML = errBox({ status: 403 }); document.getElementById('a-nav').style.display = 'none'; return; }
    render();
  } catch (e) {
    viewEl.innerHTML = errBox(e);
    document.getElementById('a-nav').style.display = 'none';
  }
})();
