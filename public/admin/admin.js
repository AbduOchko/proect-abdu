/* ================= Админ-панель (Apple UI) ================= */
'use strict';
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

// Тема синхронизирована с выбором пользователя в профиле Mini App (тот же ключ localStorage).
// По умолчанию — всегда светлая тема, пока пользователь сам не выберет иное.
const THEME_KEY = 'market_theme_pref';
function getThemePref() { try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; } }
function systemScheme() { return (tg && tg.colorScheme) || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function applyTheme(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const bg = dark ? '#0c1110' : '#f5f5f7';
  try { tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); } catch (e) {}
}
(function initTheme() {
  const pref = getThemePref();
  applyTheme(pref === 'auto' ? systemScheme() : pref);
  if (tg && tg.onEvent) tg.onEvent('themeChanged', () => { if (getThemePref() === 'auto') applyTheme(systemScheme()); });
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
const DEAL_STATUS = { created: 'Сделка создана', in_progress: 'В процессе', review: 'На проверке', completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор' };
const WD_STATUS = { pending: 'На рассмотрении', approved: 'Выполнено', rejected: 'Отклонено' };
const ACTIVE_DEAL = ['created', 'in_progress', 'review', 'disputed'];
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
  return new Promise((res) => {
    // tg.showConfirm может бросить исключение (например, старая версия Telegram) —
    // без try/catch это молча ломало бы кнопку (unhandled rejection, никакой обратной связи).
    try {
      if (tg && tg.showConfirm) { tg.showConfirm(msg, (ok) => res(!!ok)); return; }
    } catch (e) {}
    res(confirm(msg));
  });
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
  if (section === 'withdrawals') return renderWithdrawals();
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
        <div class="stat-box"><div class="n">${s.dealsActive || 0}</div><div class="l">Активных сделок</div></div>
        <div class="stat-box"><div class="n">${s.dealsCompleted}</div><div class="l">Завершено</div></div>
        <div class="stat-box"><div class="n" style="color:var(--red)">${s.dealsDisputed}</div><div class="l">Споров</div></div>
        <div class="stat-box"><div class="n" style="color:var(--orange)">${s.withdrawPending || 0}</div><div class="l">Заявок на вывод</div></div>
        <div class="stat-box wide"><div class="n accent">${money(s.escrow || 0)}</div><div class="l">Заморожено в сделках (эскроу)</div></div>
        <div class="stat-box"><div class="n accent">${money(s.volume)}</div><div class="l">Оборот завершённых</div></div>
        <div class="stat-box"><div class="n">${money(s.balances || 0)}</div><div class="l">Баланс пользователей</div></div>
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
    // споры и активные — вверх
    items.sort((a, b) => (b.status === 'disputed') - (a.status === 'disputed') || b.id - a.id);
    viewEl.innerHTML = items.length ? items.map(dealItem).join('') : empty('Нет сделок');
    viewEl.querySelectorAll('.a-item').forEach((it) => {
      const id = it.dataset.id;
      const resolve = async (outcome, extra) => {
        try {
          await API.post(`/admin/deals/${id}/resolve`, { outcome, ...extra });
          toast('Готово'); renderDeals();
        } catch (e) { toast(e.message); }
      };
      it.querySelector('[data-act="release"]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Выплатить продавцу?'))) return;
        resolve('release');
      });
      it.querySelector('[data-act="refund"]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Вернуть деньги покупателю?'))) return;
        resolve('refund');
      });
      const splitRow = it.querySelector('.split-row');
      it.querySelector('[data-act="split"]')?.addEventListener('click', () => { if (splitRow) splitRow.hidden = !splitRow.hidden; });
      it.querySelector('[data-act="split-confirm"]')?.addEventListener('click', async () => {
        const input = it.querySelector('.split-amount');
        const sellerAmount = Number(input.value);
        if (!(sellerAmount > 0)) return toast('Укажите сумму продавцу больше 0');
        if (!(await confirmDialog(`Продавцу ${sellerAmount.toLocaleString('ru-RU')} ₽, остальное — покупателю?`))) return;
        resolve('split', { sellerAmount });
      });
      const detail = it.querySelector('.a-detail');
      it.querySelector('[data-act="details"]')?.addEventListener('click', () => { if (detail) detail.hidden = !detail.hidden; });
      it.querySelector('[data-act="load-chat"]')?.addEventListener('click', async (ev) => {
        const box = it.querySelector(`#a-chat-${id}`);
        box.innerHTML = '<div class="loader"><span class="spin"></span></div>';
        try {
          const { messages } = await API.get(`/admin/deals/${id}/messages`);
          const d = items.find((x) => String(x.id) === String(id));
          box.innerHTML = messages.length ? messages.map((m) => chatMsgHtml(m, d)).join('') : empty('Сообщений нет');
        } catch (e) { box.innerHTML = errBox(e); }
      });
    });
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function chatMsgHtml(m, d) {
  const isBuyer = d && Number(m.sender_id) === Number(d.buyer_id);
  return `<div class="msg ${isBuyer ? 'in' : 'out'}"><b>${isBuyer ? 'Покупатель' : 'Продавец'}:</b> ${esc(m.text)}<div class="t">${dt(m.created_at)}</div></div>`;
}
function galleryHtml(urls) {
  if (!urls || !urls.length) return '';
  return `<div class="shots-edit">${urls.map((u) => `<a class="shot-thumb" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}"></a>`).join('')}</div>`;
}
// Предупреждение о недобросовестном спорщике: больше одного открытого спора или хотя бы один проигранный
function disputeBadge(opened, lost) {
  opened = opened || 0; lost = lost || 0;
  if (opened < 2 && lost < 1) return '';
  return ` <span class="warn-badge" title="Споры: открыто ${opened}, проиграно ${lost}">${ic('exclamation-triangle')} ${lost}/${opened}</span>`;
}
function dealDetailHtml(d) {
  const snap = d.product_snapshot || {};
  let html = '';
  if (snap && snap.title) {
    html += `<div class="section-label mt12">Товар на момент покупки</div>
      <div class="list-group">
        <div class="ios-row"><span class="label">Название</span><span class="trailing">${esc(snap.title)}</span></div>
        ${snap.subscribers ? `<div class="ios-row"><span class="label">Подписчики</span><span class="trailing">${Number(snap.subscribers).toLocaleString('ru-RU')}</span></div>` : ''}
        ${snap.reach24 ? `<div class="ios-row"><span class="label">Охват 24ч</span><span class="trailing">${Number(snap.reach24).toLocaleString('ru-RU')}</span></div>` : ''}
      </div>
      ${snap.description ? `<p class="text-hint mt8" style="white-space:pre-wrap">${esc(snap.description)}</p>` : ''}
      ${galleryHtml(snap.screenshots)}`;
  }
  if (d.delivery_proof) {
    html += `<div class="section-label mt12">Доказательство передачи (продавец)</div>
      <div class="list-group"><div class="ios-row" style="display:block;padding:12px 14px"><p style="margin:0 0 8px;white-space:pre-wrap">${esc(d.delivery_proof)}</p>${galleryHtml(d.delivery_proof_evidence)}</div></div>`;
  }
  if (d.dispute_reason) {
    const opener = d.disputed_by ? (Number(d.disputed_by) === Number(d.buyer_id) ? 'покупатель' : 'продавец') : '';
    html += `<div class="section-label mt12">Причина спора${opener ? ` (открыл: ${opener})` : ''}</div>
      <div class="list-group"><div class="ios-row" style="display:block;padding:12px 14px"><p style="margin:0 0 8px;white-space:pre-wrap">${esc(d.dispute_reason)}</p>${galleryHtml(d.dispute_evidence)}</div></div>`;
  }
  if (d.dispute_response) {
    html += `<div class="section-label mt12">Ответ на спор</div>
      <div class="list-group"><div class="ios-row" style="display:block;padding:12px 14px"><p style="margin:0 0 8px;white-space:pre-wrap">${esc(d.dispute_response)}</p>${galleryHtml(d.dispute_response_evidence)}</div></div>`;
  }
  html += `<div class="section-label mt12">Переписка покупателя и продавца</div>
    <div id="a-chat-${d.id}"><button class="a-btn gray" data-act="load-chat">${ic('chat-dots')} Показать переписку</button></div>`;
  return html;
}
function dealItem(d) {
  const active = ACTIVE_DEAL.includes(d.status);
  return `<div class="a-item" data-id="${d.id}">
    <div class="a-item-head"><div><div class="a-item-title">${esc(d.title)} — ${money(d.amount)}</div>
      <div class="a-item-sub">${ic('cart')} ${userLabel(d.buyer_name, d.buyer_username, d.buyer_id)}${disputeBadge(d.buyer_disputes_opened, d.buyer_disputes_lost)}<br>${ic('cash-coin')} ${userLabel(d.seller_name, d.seller_username, d.seller_id)}${disputeBadge(d.seller_disputes_opened, d.seller_disputes_lost)}<br>${dt(d.created_at)}</div></div>
      <span class="st st-${d.status}">${DEAL_STATUS[d.status] || d.status}</span>
    </div>
    <div class="a-actions">
      <button class="a-btn gray" data-act="details">${ic('info-circle')} Подробнее</button>
      ${active ? `
      <button class="a-btn green" data-act="release">${ic('cash-coin')} Продавцу</button>
      <button class="a-btn red" data-act="refund">${ic('arrow-counterclockwise')} Покупателю</button>
      <button class="a-btn gray" data-act="split">${ic('columns-gap')} Разделить</button>` : ''}
    </div>
    ${active ? `<div class="split-row" hidden>
      <input type="number" class="split-amount" placeholder="Сумма продавцу, ₽" min="1">
      <button class="a-btn green" data-act="split-confirm">${ic('check-lg')} Подтвердить раздел</button>
    </div>` : ''}
    <div class="a-detail" hidden>${dealDetailHtml(d)}</div>
  </div>`;
}

/* ---------- WITHDRAWALS ---------- */
async function renderWithdrawals() {
  try {
    const items = await API.get('/admin/withdrawals');
    items.sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.id - a.id);
    viewEl.innerHTML = items.length ? items.map(wdItem).join('') : empty('Заявок на вывод нет');
    viewEl.querySelectorAll('.a-item').forEach((it) => {
      const id = it.dataset.id;
      it.querySelector('[data-act="approve"]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Одобрить вывод? Средства уже списаны с баланса пользователя.'))) return;
        await API.post(`/admin/withdrawals/${id}/approve`); toast('Одобрено'); renderWithdrawals();
      });
      it.querySelector('[data-act="reject"]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Отклонить вывод? Средства вернутся на баланс.'))) return;
        await API.post(`/admin/withdrawals/${id}/reject`); toast('Отклонено'); renderWithdrawals();
      });
    });
  } catch (e) { viewEl.innerHTML = errBox(e); }
}
function wdItem(w) {
  return `<div class="a-item" data-id="${w.id}">
    <div class="a-item-head"><div><div class="a-item-title">${money(w.amount)}</div>
      <div class="a-item-sub">${userLabel(w.first_name, w.username, w.user_id)}<br>${w.requisites ? '💳 ' + esc(w.requisites) + '<br>' : ''}${dt(w.created_at)}</div></div>
      <span class="st st-${w.status === 'approved' ? 'completed' : w.status === 'rejected' ? 'cancelled' : 'created'}">${WD_STATUS[w.status] || w.status}</span>
    </div>
    ${w.status === 'pending' ? `<div class="a-actions">
      <button class="a-btn green" data-act="approve">${ic('check-lg')} Одобрить</button>
      <button class="a-btn red" data-act="reject">${ic('x-lg')} Отклонить</button>
    </div>` : ''}
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
