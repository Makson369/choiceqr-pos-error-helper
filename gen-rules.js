// Єдине джерело правил. Генерує pos-error-rules.json (канонічний, для GitHub)
// і pos-error-rules.csv (для тих, хто веде базу в Google-таблиці).
const fs = require('fs');
const NOTION = 'https://choiceqr.notion.site/pos-2611788653438096a042db2ffb55eee2';
const Q = "[\\u0022\\u0027\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB]";
const NQ = "[^\\u0022\\u0027\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB]";

const rxInactive =
  'Product\\s+' + Q + '?(?<name>.+?)' + Q + '?\\s*\\((?<pid>[0-9a-f-]{20,})\\)\\s+is inactive';
const rxFixedGroup =
  'Cannot find fixed group modifiers\\s+' + Q + '(?<group>' + NQ + '+)' + Q +
  '\\s+in order item\\s+' + Q + '(?<item>' + NQ + '+)' + Q +
  '\\s*\\(Id\\s*=\\s*(?<id>[0-9a-f-]{8,})\\)';

const L = (...a) => a.join('\n');

const RULES = [
  {
    match: { message: 'product id is undefined', source: 'Poster' },
    title: 'Poster: pos-id страви не знайдено',
    solution: L(
      '123Poster не може знайти у своїй системі pos-id страви (item_id: {itemId}).',
      '',
      'До позиції [назва позиції] вказано неактуальний POS ID.',
      'Має бути: [актуальний pos-id]',
      '',
      'Посилання на позицію: [посилання]',
      '',
      'Детальніше про вирішення помилок: ' + NOTION
    ),
  },
  {
    match: { message: 'required modification missing', source: 'Poster' },
    title: 'Poster: не додано обовʼязковий модифікатор',
    solution: [
      L(
        'У страви (product_id: {productId}) є набір доповнень «{groupName}», але в Choice не доданий',
        'обовʼязковий (single) модифікатор — тому Poster не може обробити чек.'
      ),
      'Ось це доповнення має бути обовʼязково до цієї позиції: [посилання на позицію з фото цього доповнення]',
    ],
    docs: NOTION,
  },
  {
    match: { message: 'product id is empty', source: 'Poster' },
    title: 'Poster: у страви немає pos-id',
    solution: L(
      'У якоїсь страви в чеку немає pos-id або він доданий неправильно.',
      '',
      '1. Функції → Інтеграції з POS-системою → «Меню» — завантажити вивантаження меню Poster.',
      '2. Через CTRL+F знайти потрібну страву у файлі.',
      '3. Звірити pos-id у Poster і в Choice; у Choice виправити pos-id на той, що у файлі',
      '   (напр. «82--NW» → «82--NW-NOMOD»).',
      '4. Повторити замовлення.',
      '',
      'Детальніше: ' + NOTION
    ),
  },
  {
    match: { message: "cannot read properties of undefined (reading 'order')" },
    title: 'Посилання не веде на конкретне замовлення',
    solution: L(
      'У URL немає selectedOrderId, тому бекенд не може дістати order.',
      '',
      '1. Адмінка → Orders.',
      '2. Клікнути потрібне замовлення — у URL зʼявиться ?selectedOrderId=<id>.',
      '3. Скопіювати ПОВНИЙ URL і вставити у поле Order URL.'
    ),
  },
  {
    match: { regex: rxInactive, source: 'Syrve' },
    title: 'Syrve: позиція вимкнена з продажу',
    solution: L(
      'Позиція «{name}» зараз вимкнена з продажу в Syrve — її треба увімкнути.',
      '',
      'Syrve productId: {pid}',
      '',
      '1. Відкрити цю позицію в номенклатурі Syrve.',
      '2. Увімкнути її (прибрати зі стоп-листа / «виключено з меню»).',
      '   Або — прибрати позицію з меню ChoiceQR / позначити недоступною.',
      '3. Синхронізувати меню ChoiceQR ↔ Syrve.',
      '4. Повторити замовлення.'
    ),
  },
  {
    match: { regex: rxFixedGroup, source: 'Syrve' },
    title: 'Syrve: набір доповнень не привʼязаний до позиції',
    solution: [
      L(
        'Помилочка повідомляє, що до позиції «{item}» у чеку додано доповнення «{group}»,',
        'але в системі Syrve цей набір доповнень до цієї позиції не доданий.'
      ),
      L(
        'Для вирішення потрібно одне з двох:',
        '• вимкнути доповнення «{group}» у цієї позиції в меню Choice;',
        '• або додати доповнення «{group}» до цієї позиції в Syrve.',
        '',
        'Після внесення всіх змін, будь ласка, синхронізуйте актуальне меню для маркетплейсів, щоб уникнути подібних помилок при наступних замовленнях!🙌'
      ),
    ],
  },
];

const OUT = __dirname; // файли лежать поруч зі скриптом (D:\Claude\POS)

// --- JSON (канонічний) ---
fs.writeFileSync(OUT + '/pos-error-rules.json', JSON.stringify(RULES, null, 2) + '\n', 'utf8');

// --- CSV (дзеркало, для варіанта з Google-таблицею) ---
const csvCell = (v) => {
  v = String(v == null ? '' : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const csvRows = [['match_code', 'match_message', 'match_regex', 'match_source', 'title', 'solution', 'docs']];
for (const r of RULES) {
  csvRows.push([
    r.match.code ?? '',
    r.match.message ?? '',
    r.match.regex ?? '',
    r.match.source ?? '',
    r.title ?? '',
    Array.isArray(r.solution) ? r.solution.join('\n\n') : r.solution ?? '', // у CSV — одне поле
    r.docs ?? '',
  ]);
}
const BOM = String.fromCharCode(0xfeff);
fs.writeFileSync(
  OUT + '/pos-error-rules.csv',
  BOM + csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
  'utf8'
);

console.log('wrote pos-error-rules.json (' + RULES.length + ' rules) + pos-error-rules.csv');
