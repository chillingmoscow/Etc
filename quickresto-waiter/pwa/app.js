// Логика PWA официанта. Офлайн-первая:
//  - меню/столы кэшируются в IndexedDB;
//  - заказ собирается локально, ставится в очередь с idempotencyKey;
//  - очередь синхронизируется с BFF (ретраи при возврате сети);
//  - статусы заказов периодически подтягиваются с BFF.
const API = ''; // тот же origin: BFF отдаёт и PWA, и API
let MENU = { categories: [], dishes: [] };
let TABLES = { tables: [] };
const CART = new Map();

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

// fetch JSON, считая ошибкой не-2xx ИЛИ офлайн-маркер от service worker (503 {offline:true}).
// Так мы не перетираем валидный кэш «пустым» ответом и не теряем заказы.
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  if (data && data.offline) throw new Error('offline');
  return data;
}

function setNet() {
  const on = navigator.onLine;
  const b = $('#netStatus');
  b.textContent = on ? '🟢 онлайн' : '🔴 офлайн';
  b.classList.toggle('off', !on);
}
window.addEventListener('online', () => { setNet(); flushQueue(); });
window.addEventListener('offline', setNet);

async function loadRefData() {
  // Меню и столы грузим независимо и с фолбэком на кэш. При ошибке (в т.ч. офлайн-503
  // от service worker) НЕ перетираем валидный кэш в IndexedDB.
  try {
    MENU = await fetchJson(API + '/api/menu');
    await IDB.kvSet('menu', MENU);
  } catch (e) {
    MENU = (await IDB.kvGet('menu')) || MENU;
  }
  try {
    TABLES = await fetchJson(API + '/api/tables');
    await IDB.kvSet('tables', TABLES);
  } catch (e) {
    TABLES = (await IDB.kvGet('tables')) || TABLES;
  }
  try {
    const health = await fetchJson(API + '/api/health');
    $('#modeBadge').textContent = 'режим: ' + (health.mode === 'mock' ? 'MOCK (без кредов)' : 'REAL ' + (health.layer || ''));
  } catch (e) {
    $('#modeBadge').textContent = 'режим: офлайн (кэш)';
  }
  renderTables();
  renderMenu();
}

function renderTables() {
  const s = $('#tableSelect');
  s.innerHTML = '';
  (TABLES.tables || []).forEach((t) => {
    const o = el('option', null, t.label);
    o.value = t.tableId;
    o.dataset.hall = t.hallId || '';
    o.dataset.label = t.label;
    s.appendChild(o);
  });
}

function renderMenu() {
  const m = $('#menu');
  m.innerHTML = '';
  (MENU.dishes || []).forEach((d) => {
    const card = el('button', 'dish');
    card.appendChild(el('span', 'dish-name', d.name));
    card.appendChild(el('span', 'dish-price', d.price + ' ₽'));
    card.onclick = () => addToCart(d);
    m.appendChild(card);
  });
  if (!(MENU.dishes || []).length) m.textContent = 'Меню пустое';
}

function addToCart(d) {
  const cur = CART.get(d.dishId) || { ...d, quantity: 0 };
  cur.quantity++;
  CART.set(d.dishId, cur);
  renderCart();
}
function changeQty(id, delta) {
  const cur = CART.get(id);
  if (!cur) return;
  cur.quantity += delta;
  if (cur.quantity <= 0) CART.delete(id); else CART.set(id, cur);
  renderCart();
}

function renderCart() {
  const c = $('#cart');
  c.innerHTML = '';
  if (!CART.size) {
    c.textContent = 'Пусто';
    $('#sendBtn').disabled = true;
    $('#cartCount').textContent = '';
    return;
  }
  let total = 0, count = 0;
  for (const it of CART.values()) {
    total += it.price * it.quantity;
    count += it.quantity;
    const row = el('div', 'cart-row');
    row.appendChild(el('span', 'cart-name', it.name));
    const ctr = el('span', 'qty');
    const minus = el('button', 'qbtn', '−'); minus.onclick = () => changeQty(it.dishId, -1);
    const plus = el('button', 'qbtn', '+'); plus.onclick = () => changeQty(it.dishId, 1);
    ctr.append(minus, el('span', 'qn', String(it.quantity)), plus);
    row.appendChild(ctr);
    row.appendChild(el('span', 'cart-sum', it.price * it.quantity + ' ₽'));
    c.appendChild(row);
  }
  c.appendChild(el('div', 'cart-total', 'Итого: ' + total + ' ₽'));
  $('#cartCount').textContent = '· ' + count + ' поз.';
  $('#sendBtn').disabled = false;
}

async function sendOrder() {
  const sel = $('#tableSelect').selectedOptions[0];
  if (!sel) { alert('Выберите стол'); return; }
  const order = {
    idempotencyKey: uuid(),
    table: { tableId: sel.value, hallId: sel.dataset.hall || null, label: sel.dataset.label },
    items: [...CART.values()].map((it) => ({ dishId: it.dishId, name: it.name, price: it.price, quantity: it.quantity })),
    comment: $('#comment').value || '',
    localStatus: 'queued',
    createdAt: Date.now(),
  };
  await IDB.ordPut(order); // сначала в локальную очередь — заказ не теряется даже офлайн
  CART.clear();
  $('#comment').value = '';
  renderCart();
  renderOrders();
  flushQueue();
}

async function flushQueue() {
  const all = await IDB.ordAll();
  for (const o of all.filter((x) => x.localStatus === 'queued')) {
    try {
      const res = await fetch(API + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o),
      });
      // Не-2xx (502 при ошибке создания в QuickResto или офлайн-503 от service worker)
      // НЕ считаем успехом — заказ остаётся в очереди и будет повторён. Дубля не будет:
      // idempotencyKey гарантирует серверную идемпотентность при ретрае.
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !data.id) continue; // нет id (напр. офлайн-маркер) — заказ не теряем
      o.localStatus = 'sent';
      o.remoteId = data.id;
      o.remoteStatus = data.status;
      o.mock = data.mock;
      await IDB.ordPut(o);
    } catch (e) {
      // сеть упала — оставляем в очереди, повторим позже (по таймеру / при возврате сети)
    }
  }
  renderOrders();
}

async function pollStatuses() {
  const all = await IDB.ordAll();
  for (const o of all.filter((x) => x.localStatus === 'sent' && x.remoteId && x.remoteStatus !== 'CLOSED')) {
    try {
      const s = await fetch(API + '/api/orders/' + encodeURIComponent(o.remoteId) + '/status').then((r) => r.json());
      if (s.status) { o.remoteStatus = s.status; await IDB.ordPut(o); }
    } catch (e) { /* офлайн — пропускаем */ }
  }
  renderOrders();
}

async function renderOrders() {
  const box = $('#orders');
  const all = (await IDB.ordAll()).sort((a, b) => b.createdAt - a.createdAt);
  box.innerHTML = '';
  if (!all.length) { box.textContent = 'Пока нет'; return; }
  for (const o of all) {
    const row = el('div', 'order-row');
    const left = el('div', 'order-left');
    left.appendChild(el('div', 'order-table', o.table?.label || '—'));
    left.appendChild(el('div', 'order-items muted', o.items.map((i) => i.name + '×' + i.quantity).join(', ')));
    row.appendChild(left);
    const st = o.localStatus === 'queued' ? 'в очереди ⏳' : o.remoteStatus || o.localStatus;
    const badge = el('div', 'order-status', st);
    badge.classList.add('s-' + (o.localStatus === 'queued' ? 'queued' : (o.remoteStatus || 'sent')).toLowerCase());
    row.appendChild(badge);
    box.appendChild(row);
  }
}

// --- init ---
$('#sendBtn').onclick = sendOrder;
setNet();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadRefData().then(() => { renderOrders(); flushQueue(); });
setInterval(pollStatuses, 5000);
setInterval(() => { if (navigator.onLine) flushQueue(); }, 8000);
