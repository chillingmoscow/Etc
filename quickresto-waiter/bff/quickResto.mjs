// Клиент QuickResto API. Единственное место, знающее про схему QuickResto.
// MOCK-режим возвращает демо-данные; REAL-режим ходит в облако с Basic Auth.
// ВАЖНО: точные строки модулей/классов и схема создания заказа подтверждаются
// в Фазе 0 (см. spike/spike.mjs). Здесь они вынесены в CONFIG и в маппер ниже.
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.mjs';
import { MOCK_MENU, MOCK_TABLES } from './mockData.mjs';
import { store } from './store.mjs';

function authHeader() {
  return 'Basic ' + Buffer.from(`${CONFIG.login}:${CONFIG.password}`).toString('base64');
}

async function qrFetch(path, opts = {}) {
  const url = CONFIG.baseUrl + path;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
  if (!res.ok) throw new Error(`QuickResto ${res.status}: ${String(text).slice(0, 300)}`);
  return json;
}

// ---------- МЕНЮ ----------
export async function readMenu() {
  if (CONFIG.mock) return MOCK_MENU;
  // GET /tree?moduleName=warehouse.nomenclature.dish  (паттерн подтверждён прецедентами)
  const tree = await qrFetch(`/tree?moduleName=${encodeURIComponent(CONFIG.menuModule)}`);
  return normalizeMenu(tree);
}

function normalizeMenu(tree) {
  // Толерантный нормализатор: точная форма дерева уточняется на живом ответе (Фаза 0).
  const categories = [];
  const dishes = [];
  const walk = (node, catName) => {
    const arr = Array.isArray(node) ? node : node?.children || node?.items || node?.list || [];
    for (const n of arr) {
      if (!n || typeof n !== 'object') continue;
      const name = n.name || n.title || n.caption;
      const hasChildren = n.children || n.items || n.list;
      const isDish = n.price != null || (/dish/i.test(n.className || '') && !/category/i.test(n.className || ''));
      if (hasChildren) {
        if (name) categories.push({ id: n.id, name });
        walk(n, name);
      }
      if (isDish) {
        dishes.push({ dishId: n.id ?? n.guid ?? n.objectId, name, price: Number(n.price ?? 0), category: catName || null });
      }
    }
  };
  walk(tree, null);
  return { categories, dishes, _note: 'нормализация меню — гипотеза; уточнить форму дерева в Фазе 0' };
}

// ---------- СТОЛЫ ----------
export async function readTables() {
  if (CONFIG.mock) return MOCK_TABLES;
  const list = await qrFetch(
    `/list?moduleName=${encodeURIComponent(CONFIG.tablesModule)}&className=${encodeURIComponent(CONFIG.tablesClass)}`
  );
  return normalizeTables(list);
}

function normalizeTables(list) {
  const arr = Array.isArray(list) ? list : list?.result || list?.list || list?.items || [];
  const tables = arr.map((t) => ({
    hallId: t.roomId ?? t.hallId ?? null,
    tableId: t.id ?? t.objectId ?? t.guid,
    label: t.name ?? t.title ?? String(t.number ?? t.id),
  }));
  return { tables, _note: 'модуль/класс столов — гипотеза; уточнить в Фазе 0' };
}

// ---------- СОЗДАНИЕ ЗАКАЗА ----------
export async function createOrder(order) {
  if (CONFIG.mock) {
    const id = 'mock-' + randomUUID().slice(0, 8);
    return { id, status: 'NEW', mock: true, table: order.table?.label || null };
  }
  const body = { moduleName: CONFIG.createModule, className: CONFIG.createClass, order: buildOrderPayload(order) };
  const res = await qrFetch('/create', { method: 'POST', body: JSON.stringify(body) });
  return { id: res.id ?? res.objectId ?? null, status: res.status ?? 'NEW', raw: res };
}

function buildOrderPayload(order) {
  // ↓ ГИПОТЕЗА схемы (по реальному примеру N-N-Kareev/telegram-bot). Точные поля — Фаза 0.
  const payload = {
    items: (order.items || []).map((it) => ({ dishId: it.dishId, quantity: it.quantity, price: it.price, name: it.name })),
    comment: order.comment || '',
    status: 'NEW',
    externalId: order.idempotencyKey, // если QR поддержит — анти-дубль на стороне сервера
  };
  if (order.table) {
    payload[CONFIG.tableField] = order.table.tableId; // привязка к столу — главная неизвестность
    if (CONFIG.hallField) payload[CONFIG.hallField] = order.table.hallId;
    // План Б: дублируем стол в комментарий, чтобы не потерять привязку, если поле не сработает.
    payload.comment = `[${order.table.label}] ${payload.comment}`.trim();
  }
  return payload;
}

// ---------- СТАТУС ЗАКАЗА ----------
export async function getOrderStatus(id) {
  if (CONFIG.mock) return store.mockStatus(id);
  const res = await qrFetch(
    `/read?moduleName=${encodeURIComponent(CONFIG.ordersModule)}&className=${encodeURIComponent(CONFIG.ordersClass)}&objectId=${encodeURIComponent(id)}`
  );
  return { id, status: res.status ?? res.state ?? 'UNKNOWN', raw: res };
}
