// Конфигурация BFF. Читает .env (если есть) и переменные окружения.
// БЕЗ кредов QuickResto → автоматически MOCK-режим (демо без реального API).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- крошечный загрузчик .env (без зависимостей) ---
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const envBool = (v) => v === '1' || (v || '').toLowerCase() === 'true';

const layer = process.env.QR_LAYER || '';
const login = process.env.QR_LOGIN || '';
const password = process.env.QR_PASSWORD || '';
const hasCreds = Boolean(layer && login && password);

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  layer, login, password,
  // MOCK, если явно включён (QR_MOCK=1) ИЛИ если нет кредов
  mock: envBool(process.env.QR_MOCK) || !hasCreds,
  baseUrl: layer ? `https://${layer}.quickresto.ru/platform/online/api` : '',

  // --- Параметры, которые ПОДТВЕРЖДАЮТСЯ в Фазе 0 (спайк). Дефолты — гипотезы. ---
  menuModule: process.env.QR_MENU_MODULE || 'warehouse.nomenclature.dish',
  tablesModule: process.env.QR_TABLES_MODULE || 'front.rooms',                                   // ГИПОТЕЗА
  tablesClass: process.env.QR_TABLES_CLASS || 'ru.edgex.quickresto.modules.front.rooms.RestaurantTable', // ГИПОТЕЗА
  ordersModule: process.env.QR_ORDERS_MODULE || 'front.orders',
  ordersClass: process.env.QR_ORDERS_CLASS || 'ru.edgex.quickresto.modules.front.orders.OrderInfo',
  createModule: process.env.QR_CREATE_MODULE || 'order.order',                                    // подтверждено прецедентом
  createClass: process.env.QR_CREATE_CLASS || 'ru.edgex.quickresto.modules.order.order.Order',    // подтверждено прецедентом
  tableField: process.env.QR_TABLE_FIELD || 'tableId',  // ГИПОТЕЗА: имя поля привязки заказа к столу
  hallField: process.env.QR_HALL_FIELD || '',           // опционально
};
