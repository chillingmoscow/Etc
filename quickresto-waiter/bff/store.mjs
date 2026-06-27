// Простое in-memory хранилище для PoC.
// В проде заменяется на Postgres/Supabase (таблица идемпотентности + кэш заказов).

const byKeyMap = new Map(); // idempotencyKey -> результат создания (для идемпотентности)
const byIdMap = new Map();  // id заказа -> { created, order, createdAt }

export const store = {
  byKey(key) {
    return byKeyMap.get(key) || null;
  },
  save(key, created, order) {
    byKeyMap.set(key, created);
    if (created?.id) byIdMap.set(created.id, { created, order, createdAt: Date.now() });
  },
  all() {
    return [...byIdMap.entries()].map(([id, v]) => ({
      id,
      ...v.created,
      table: v.order?.table?.label,
      createdAt: v.createdAt,
    }));
  },
  // Имитация смены статуса во времени — только для MOCK, чтобы показать синхронизацию статусов.
  mockStatus(id) {
    const rec = byIdMap.get(id);
    if (!rec) return { id, status: 'UNKNOWN' };
    const age = (Date.now() - rec.createdAt) / 1000;
    const status = age < 8 ? 'NEW' : age < 20 ? 'COOKING' : age < 35 ? 'READY' : 'CLOSED';
    return { id, status, mock: true, ageSec: Math.round(age) };
  },
};
