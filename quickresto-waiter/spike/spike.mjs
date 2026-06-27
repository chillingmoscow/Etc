#!/usr/bin/env node
// =====================================================================
//  Фаза 0 — спайк проверки осуществимости QuickResto API.
//  Запускайте на СВОЕЙ машине. Креды передаются ТОЛЬКО через переменные
//  окружения — НЕ вставляйте их в код, скрипты или чаты.
//
//  Примеры:
//    QR_LAYER=acme QR_LOGIN=api QR_PASSWORD=*** node spike.mjs
//        → только чтение: A (авторизация), B (меню), C (поиск столов)
//
//    ... node spike.mjs --create --dish=<dishId>
//        → + D: создать тестовый заказ из одной позиции
//
//    ... node spike.mjs --create --dish=<dishId> --table=<tableId> [--hall=<hallId>]
//        → + E (ГЛАВНЫЙ ТЕСТ): создать заказ с привязкой к столу
//
//    ... node spike.mjs --cancel=<orderId>
//        → F: попытка отмены тестового заказа (или гасите на iPad)
//
//  Запускайте вне часов работы / в тренировочной смене. Логируйте id
//  всех тестовых заказов и убирайте их (шаг F или вручную на iPad).
// =====================================================================

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const LAYER = process.env.QR_LAYER;
const LOGIN = process.env.QR_LOGIN;
const PASSWORD = process.env.QR_PASSWORD;

if (!LAYER || !LOGIN || !PASSWORD) {
  console.error('✗ Нужны переменные окружения QR_LAYER, QR_LOGIN, QR_PASSWORD.');
  console.error('  Креды НЕ вставляйте в код/чаты. Пример:');
  console.error('  QR_LAYER=acme QR_LOGIN=api QR_PASSWORD=*** node spike.mjs');
  process.exit(1);
}

const BASE = `https://${LAYER}.quickresto.ru/platform/online/api`;
const AUTH = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, json, text };
}

function log(step, ok, msg, extra) {
  console.log(`${ok ? '✓' : '✗'} [${step}] ${msg}`);
  if (extra !== undefined) console.log('   ', typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 600));
}
const sample = (v, n = 3) => (Array.isArray(v) ? v.slice(0, n) : v);

(async () => {
  console.log(`\n=== QuickResto spike → ${BASE} ===\n`);

  // --- A. Авторизация / связь (read-only) ---
  let r = await call('GET', `/list?moduleName=front.zreport&className=${encodeURIComponent('ru.edgex.quickresto.modules.front.zreport.Shift')}`);
  log('A: auth', r.ok, r.ok ? '200 OK — авторизация работает' : `HTTP ${r.status}`, r.ok ? undefined : r.text.slice(0, 300));
  if (!r.ok) {
    console.error('\nОстанавливаюсь: авторизация/связь не прошла.');
    console.error('Проверьте QR_LAYER/логин/пароль и что API включён на тарифе.');
    process.exit(2);
  }

  // --- B. Меню (номенклатура) ---
  r = await call('GET', `/tree?moduleName=warehouse.nomenclature.dish`);
  log('B: menu', r.ok, r.ok ? 'дерево номенклатуры получено' : `HTTP ${r.status}`, sample(r.json));
  const rmods = await call('GET', `/list?moduleName=warehouse.nomenclature.mods`);
  log('B: mods', rmods.ok, rmods.ok ? 'модификаторы доступны' : `модификаторы: HTTP ${rmods.status}`);
  console.log('   ⓘ Запишите, какими полями приходят блюда: id / guid / articul, price, модификаторы.');

  // --- C. Залы / столы — перебор гипотез (нет публичного прецедента) ---
  console.log('\n--- C: поиск модуля столов/залов (перебор гипотез) ---');
  const candidates = [
    ['front.rooms', 'ru.edgex.quickresto.modules.front.rooms.Room'],
    ['front.rooms', 'ru.edgex.quickresto.modules.front.rooms.RestaurantTable'],
    ['front.halls', 'ru.edgex.quickresto.modules.front.halls.Hall'],
    ['settings.restaurant', 'ru.edgex.quickresto.modules.settings.restaurant.RestaurantSection'],
    ['front.tables', 'ru.edgex.quickresto.modules.front.tables.Table'],
  ];
  for (const [mod, cls] of candidates) {
    const rr = await call('GET', `/list?moduleName=${encodeURIComponent(mod)}&className=${encodeURIComponent(cls)}`);
    log(`C: ${mod}`, rr.ok, rr.ok ? `НАЙДЕНО (${cls})` : `нет (HTTP ${rr.status})`, rr.ok ? sample(rr.json) : undefined);
  }
  console.log('   ⓘ Если ничего не найдено — спросите у поддержки QuickResto точный модуль/класс столов (см. план).');

  // --- D / E. Создание заказа ---
  if (args.create) {
    const dishId = args.dish || null;
    if (!dishId) console.log('\n⚠ D/E: не задан --dish=<dishId> (возьмите id из вывода B). Пробую без позиций — может отклониться.');
    const order = {
      items: dishId ? [{ dishId, quantity: 1 }] : [],
      comment: 'TEST спайк — удалить',
      status: 'NEW',
      externalId: 'spike-' + (args.table ? 'tbl-' : '') + Math.floor(Date.now() / 1000),
    };
    if (args.table) {
      order.tableId = args.table; // ГИПОТЕЗА имени поля привязки к столу
      if (args.hall) order.hallId = args.hall;
      order.comment = `[стол ${args.table}] ` + order.comment; // План Б: стол в комментарий
    }
    const payload = { moduleName: 'order.order', className: 'ru.edgex.quickresto.modules.order.order.Order', order };
    console.log('\n--- ' + (args.table ? 'E: create + привязка к столу' : 'D: create') + ' (POST /create) ---');
    console.log('   payload:', JSON.stringify(payload));
    const rc = await call('POST', '/create', payload);
    const newId = rc.json?.id ?? rc.json?.objectId;
    log(args.table ? 'E: create+table' : 'D: create', rc.ok, rc.ok ? `заказ создан → id=${newId}` : `HTTP ${rc.status}`, rc.text.slice(0, 600));
    if (rc.ok) {
      console.log('\n   ⓘ Проверьте НА iPad-терминале (это решает архитектуру):');
      console.log('     [ ] заказ виден' + (args.table ? ' НА НУЖНОМ СТОЛЕ' : '') + '   [ ] ушёл на кухню');
      console.log('     [ ] можно сделать дозаказ   [ ] можно закрыть/оплатить');
      console.log(`   Уборка: node spike.mjs --cancel=${newId}   (или погасите на iPad)`);
    }
  } else {
    console.log('\nⓘ Запись пропущена (нет флага --create).');
    console.log('  Сначала убедитесь в A–C, затем: node spike.mjs --create --dish=<id> [--table=<id>]');
  }

  // --- F. Отмена / уборка ---
  if (args.cancel) {
    console.log('\n--- F: попытка отмены ' + args.cancel + ' ---');
    // Путь отмены — гипотеза; уточняется в Фазе 0. Гарантированный способ — погасить на iPad.
    const r1 = await call('POST', '/update', {
      moduleName: 'order.order',
      className: 'ru.edgex.quickresto.modules.order.order.Order',
      order: { id: args.cancel, status: 'CANCELLED', deleted: true },
    });
    log('F: cancel', r1.ok, r1.ok ? 'запрос отмены принят (проверьте на iPad)' : `HTTP ${r1.status} — отмените на iPad вручную`, r1.text.slice(0, 300));
  }

  console.log('\n=== Готово. Зафиксируйте в заметке: ===');
  console.log('  1) точную схему ответа /create (поля заказа);');
  console.log('  2) какое поле дало привязку к столу (если дало);');
  console.log('  3) рабочий способ отмены;');
  console.log('  4) вердикт: GREEN / YELLOW / RED (см. план, Фаза 0).\n');
})().catch((e) => {
  console.error('Ошибка спайка:', e);
  process.exit(1);
});
