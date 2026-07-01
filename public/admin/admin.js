/* ================= Админ-панель ================= */
'use strict';
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('bg_color'); } catch (e) {} }

const viewEl = document.getElementById('a-view');
const toastEl = document.getElementById('toast');
const whoami = document.getElementById('a-whoami');

const CATS = { channel: '📢 Каналы', bot: '🤖 Боты', script: '📜 Скрипты', chat: '💬 Чаты', code: '💾 Коды', other: '📦 Другое' };
const DEAL_STATUS = { pending: 'Ожидание', paid: 'Оплачено', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор' };

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
function empty(t) { return `<div class="empty"><span class="em">📭</span>${esc(t)}</div>`; }
function errBox(e) {
  if (e.status === 403) return `<div class="empty"><span class="em">⛔️</span>Доступ только для администраторов.<div class="text-hint mt12">Откройте панель командой /admin у бота.</div></div>`;
  return `<div class="empty"><span class="em">⚠️</span>${esc(e.message || 'Ошибка')}</div>`;
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
        <div class="stat-box"><div class="n" style="color:var(--danger)">${s.dealsDisputed}</div><div class="l">Споров</div></div>
        <div class="stat-box"><div class="n">${s.messages}</div><div class="l">Сообщений</div></div>
        <div class="stat-box wide"><div class="n" style="color:var(--success)">${money(s.volume)}</div><div class="l">Оборот завершённых сделок</div></div>
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
    <div class="a-item-head">
      <div><div class="a-item-title">${userLabel(u.first_name, u.username, u.id)}</div>
      <div class="a-item-sub">⭐ ${rating} · 🤝 ${u.deals_count || 0} сделок · ${u.is_admin ? '👑 админ' : 'юзер'}${u.is_banned ? ' · 🚫 бан' : ''}</div></div>
    </div>
    <div class="a-actions">
      ${u.is_banned
        ? `<button class="a-btn green" data-act="unban">Разблокировать</button>`
        : `<button class="a-btn red" data-act="ban">Заблокировать</button>`}
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
    <div class="a-item-head">
      <div><div class="a-item-title">${esc(p.title)}</div>
      <div class="a-item-sub">${CATS[p.category] || p.category} · ${money(p.price)} · ${esc(p.status)} · 👁 ${p.views || 0}<br>Продавец: ${userLabel(p.seller_name, p.seller_username, p.seller_id)}</div></div>
    </div>
    <div class="a-actions">
      ${p.status !== 'hidden' ? `<button class="a-btn gray" data-act="hide">Скрыть</button>` : `<button class="a-btn green" data-act="show">Показать</button>`}
      <button class="a-btn red" data-act="del">Удалить</button>
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
    <div class="a-item-head">
      <div><div class="a-item-title">${esc(r.title)}</div>
      <div class="a-item-sub">${CATS[r.category] || r.category} · бюджет ${money(r.budget)} · ${esc(r.status)}<br>Покупатель: ${userLabel(r.buyer_name, r.buyer_username, r.buyer_id)}</div></div>
    </div>
    <div class="a-actions"><button class="a-btn red" data-act="del">Удалить</button></div>
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
    <div class="a-item-head">
      <div><div class="a-item-title">${esc(d.title)} — ${money(d.amount)}</div>
      <div class="a-item-sub">🛒 ${userLabel(d.buyer_name, d.buyer_username, d.buyer_id)}<br>💰 ${userLabel(d.seller_name, d.seller_username, d.seller_id)}<br>${dt(d.created_at)}</div></div>
    </div>
    <div class="a-actions"><select class="a-select" data-act="status" style="margin:0">${opts}</select></div>
  </div>`;
}

/* ---------- init ---------- */
(async function init() {
  try {
    const me = await API.get('/me');
    whoami.textContent = (me.first_name || 'Админ') + (me.is_admin ? ' · 👑 администратор' : '');
    if (!me.is_admin) { viewEl.innerHTML = errBox({ status: 403 }); document.getElementById('a-nav').style.display = 'none'; return; }
    render();
  } catch (e) {
    viewEl.innerHTML = errBox(e);
    document.getElementById('a-nav').style.display = 'none';
  }
})();
