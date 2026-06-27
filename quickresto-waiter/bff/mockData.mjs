// Демо-данные для MOCK-режима (когда нет кредов QuickResto).
// В REAL-режиме эти данные приходят из QuickResto через /tree и /list.

export const MOCK_MENU = {
  categories: [
    { id: 'c1', name: 'Кофе' },
    { id: 'c2', name: 'Завтраки' },
    { id: 'c3', name: 'Десерты' },
  ],
  dishes: [
    { dishId: 'd1', name: 'Капучино', price: 280, category: 'Кофе' },
    { dishId: 'd2', name: 'Латте', price: 300, category: 'Кофе' },
    { dishId: 'd3', name: 'Эспрессо', price: 200, category: 'Кофе' },
    { dishId: 'd4', name: 'Сырники', price: 420, category: 'Завтраки' },
    { dishId: 'd5', name: 'Омлет', price: 380, category: 'Завтраки' },
    { dishId: 'd6', name: 'Чизкейк', price: 390, category: 'Десерты' },
    { dishId: 'd7', name: 'Тирамису', price: 410, category: 'Десерты' },
  ],
  _note: 'MOCK-меню. В REAL-режиме придёт из QuickResto /tree?moduleName=warehouse.nomenclature.dish',
};

export const MOCK_TABLES = {
  tables: [
    { hallId: 'h1', tableId: 't1', label: 'Стол 1' },
    { hallId: 'h1', tableId: 't2', label: 'Стол 2' },
    { hallId: 'h1', tableId: 't3', label: 'Стол 3' },
    { hallId: 'h2', tableId: 't4', label: 'Терраса 1' },
    { hallId: 'h2', tableId: 't5', label: 'Терраса 2' },
  ],
  _note: 'MOCK-столы. В REAL-режиме придут из QuickResto (модуль/класс уточняется в Фазе 0).',
};
