// Єдине джерело правил. Генерує pos-error-rules.json (канонічний, для GitHub)
// і pos-error-rules.csv (для тих, хто веде базу в Google-таблиці).
const fs = require('fs');
const NOTION = 'https://choiceqr.notion.site/pos-2611788653438096a042db2ffb55eee2';
const Q = "[\\u0022\\u0027\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB]";
const NQ = "[^\\u0022\\u0027\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB]";

const rxInactive =
  'Product\\s+' + Q + '?(?<name>.+?)' + Q + '?\\s*\\((?<pid>[0-9a-f-]{20,})\\)\\s+is inactive';
const rxExcluded =
  'Product\\s+' + Q + '?(?<name>.+?)' + Q + '?\\s*\\((?<pid>[0-9a-f-]{20,})\\)\\s+is excluded from menu';
const rxFixedGroup =
  'Cannot find fixed group modifiers\\s+' + Q + '(?<group>' + NQ + '+)' + Q +
  '\\s+in order item\\s+' + Q + '(?<item>' + NQ + '+)' + Q +
  '\\s*\\(Id\\s*=\\s*(?<id>[0-9a-f-]{8,})\\)';
const rxInvalidGroupAmount =
  'Order item modifier\\s+' + Q + '(?<mod>' + NQ + '+)' + Q +
  '\\s*\\((?<modId>[0-9a-f-]{8,})\\)\\s+has invalid group amount';

const L = (...a) => a.join('\n');

const RULES = [
  {
    match: { message: 'product id is undefined', source: 'Poster' },
    title: 'Poster: pos-id страви не знайдено',
    solution: L(
      'Poster не може знайти у своїй системі pos-id страви (POS ID: {itemId}).',
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
      'У позиції [назва позиції] є обовʼязковий набір доповнень «{groupName}», але в Choice він не доданий - тому Poster не може обробити чек',
      L(
        'Ось це доповнення має бути обовʼязково до цієї позиції: [посилання на позицію з фото цього доповнення]',
        '',
        'Детальніше про вирішення помилок: ' + NOTION
      ),
    ],
  },
  {
    match: { message: 'product id is empty', source: 'Poster' },
    title: 'Poster: у страви немає pos-id',
    solution: L(
      'До позиції (назва позиції) відсутній POS ID',
      'Ось цей POS ID має бути до цієї позиції: ',
      '',
      'Посилання на позицію:',
      '',
      'Детальніше про вирішення помилок: ' + NOTION
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
      'Замовлення не передалось до POS системи через те, що позиція «{name}» вимкнена для замовлення в POS системі. Вам потрібно її увімкнути в Syrve або вимкнути для замовлення в Choice.',
      '',
      'POS ID: {pid}'
    ),
  },
  {
    match: { regex: rxExcluded, source: 'Syrve' },
    title: 'Syrve: позиція виключена з меню',
    solution: L(
      'Замовлення не передалось у Syrve: позиція «{name}» виключена з меню (is excluded from menu). Найімовірніше її вимкнено в Syrve або її немає у вивантаженні меню Syrve. Треба увімкнути / повернути її в Syrve — або прибрати з меню Choice.',
      '',
      'POS ID: {pid}'
    ),
  },
  {
    match: { message: 'creation timeout expired' },
    title: 'POS: немає звʼязку з касою (creation timeout)',
    solution: L(
      'Не було звʼязку із касою (Creation timeout expired).',
      '',
      'Спробуйте перезавантажити касу і перевірити наявність мережі.',
      'Це замовлення можна пробити вручну, а наступні перенесуться як зазвичай, якщо з мережею все добре 😊'
    ),
  },
  {
    match: { regex: rxInvalidGroupAmount, source: 'Syrve' },
    title: 'Syrve: не вибрано обовʼязковий модифікатор',
    solution: [
      L(
        'Замовлення #{orderNumber}',
        '',
        'Помилка повідомляє, що відсутній обовʼязковий модифікатор «{mod}» ({modId}) до позиції [назва позиції].'
      ),
      L(
        'Ось це доповнення потрібно увімкнути до цієї позиції.',
        '',
        'Посилання на позицію: [посилання]',
        '+ фото'
      ),
    ],
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
        '• або додати доповнення «{group}» до цієї позиції в Syrve.'
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
