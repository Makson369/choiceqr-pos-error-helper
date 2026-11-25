# ChoiceQR POS data — помічник з помилок

Tampermonkey-скрипт для сторінки
`https://europe-west1-choiceqr-dev.cloudfunctions.net/pos-data/...`.
Витягує помилку POS (Poster / Syrve) з `Payload` / `Response`, зіставляє її з базою правил
і показує праворуч панель із готовим текстом відповіді клієнту (кнопка копіювання на кожен блок).

## Файли

| файл | що це |
|---|---|
| `choiceqr-pos-data-error-helper.user.js` | сам скрипт (ставиться в Tampermonkey) |
| `gen-rules.js` | **єдине джерело правил** — масив `RULES`; генерує `.json` + `.csv` |
| `pos-error-rules.json` | згенерована база правил, її читає скрипт (руками не редагуємо) |
| `pos-error-rules.csv` | те саме у CSV (для варіанта з Google-таблицею) |

## Встановлення скрипта (одноразово)

1. Відкрити
   <https://raw.githubusercontent.com/Makson369/choiceqr-pos-error-helper/main/choiceqr-pos-data-error-helper.user.js>
   — Tampermonkey сам запропонує **Install**.
2. `RULES_URL` уже вказує на `pos-error-rules.json` у цьому репозиторії — нічого налаштовувати не треба.

### Оновлення

- **База правил** — скрипт кешує її на 5 хв; кнопка **⟳** у шапці панелі оновлює негайно.
- **Сам скрипт** — Tampermonkey перевіряє `@updateURL` автоматично (зазвичай раз на добу).
  Оновити одразу: відкрити посилання вище → **Update**, або Tampermonkey → Utilities →
  *Check for userscript updates*.

## Що розпізнає скрипт

Зі сторінки `pos-data` (блоки `Payload` / `Response`) скрипт дістає:

- Syrve — обʼєкт статусу (`creationStatus: Error`, `errorInfo.message`);
- `Error: {...}` — HTTPError з `resultMessage` (Poster);
- голий обʼєкт `{ "resultMessage": ... }` — відповідь Poster (напр. error 210, 211);
- `[Poster|Syrve] Cannot create receipt/delivery: ...` та інші `[handler] {json}`;
- JS-помилки (`Cannot read properties of undefined ...`).

Однакові повідомлення зводяться в одне.

## Формат правила (`RULES` у `gen-rules.js`)

```js
{
  match: {
    code: '209',                          // код помилки POS
    message: 'required modification missing', // підрядок тексту помилки (без регістру)
    regex: '…(?<group>…)…',               // regex по тексту помилки (прапорець i)
    source: 'Poster',                     // Poster | Syrve — точний збіг
    marketplace: true,                    // true — лише маркетплейс, false — лише звичайні
  },
  title: 'Заголовок у панелі',
  solution: 'Текст' | ['Повідомлення 1', 'Повідомлення 2'],
}
```

- Усі поля `match` опційні. Правило спрацьовує, якщо збіглися **всі заповнені**. Перший збіг згори виграє.
- `solution` масивом — кілька окремих повідомлень, кожне зі своєю кнопкою копіювання.
- Підстановки: `{code} {message} {source} {itemId} {productId} {groupName} {modIds} {httpCode} {orderNumber}`
  + іменовані групи з `regex` (`(?<name>…)` → `{name}`). Відсутнє значення → «—».
- Назву позиції, яку треба вписати вручну, пишемо як «назва позиції» (одразу в лапках).
- Poster pos-id: `N--NW` — позиція з доповненнями, `N--NW-NOMOD` — без; доповнення — `id**id_набору`.

## Перевірити правило без реальної помилки (прев'ю)

Відкрити будь-яку сторінку `pos-data/...` з параметрами:

```
?cqr_preview=<текст помилки>
   &cqr_src=Poster|Syrve        (опц., якщо правило вимагає source)
   &cqr_code=209                (опц.)
   &cqr_mp=1                    (опц., замовлення з маркетплейсу)
   &cqr_item=3 &cqr_pid=531 &cqr_group=Соуси &cqr_http=400 &cqr_order=26758   (опц. підстановки)
```

Або сирий шаблон правила без жодних підстановок: `?cqr_rule=<N>` (N — номер у списку нижче).

Приклади (правило #9):

- прев'ю з підстановками —
  <https://europe-west1-choiceqr-dev.cloudfunctions.net/pos-data/CFD8F0A8-2809-4FF9-96C8-F78A11A3B78B?cqr_src=Syrve&cqr_preview=Cannot%20find%20fixed%20group%20modifiers%20'Syrups'%20in%20order%20item%20'Fluff%20Coffee'%20(Id%20%3D%205a85e337-4f23-4164-95c5-cdd501e22664)>
- сирий шаблон —
  <https://europe-west1-choiceqr-dev.cloudfunctions.net/pos-data/CFD8F0A8-2809-4FF9-96C8-F78A11A3B78B?cqr_rule=9>

## Як додати нове правило

1. Дописати обʼєкт у масив `RULES` у `gen-rules.js` (там готові regex-хелпери).
2. `node gen-rules.js` — перегенерує `pos-error-rules.json` і `.csv`.
3. Commit + push у `main` — скрипт підхопить за ≤5 хв (або по кнопці ⟳).

(Це роблю я — від тебе потрібні лише «помилка → рішення».)

## Поточні правила

| # | POS | помилка | що означає |
|---|---|---|---|
| 1 | Poster | `Product ID is undefined` | pos-id позиції не знайдено в Poster (неактуальний) |
| 2 | Poster | `Required modification missing` (209) | обовʼязковий набір доповнень не доданий у Choice |
| 3 | Poster | `Product ID is empty` | у позиції немає pos-id |
| 4 | — | `Cannot read properties of undefined (reading 'order')` | посилання не веде на конкретне замовлення |
| 5 | Syrve | `Product … is inactive` | позиція вимкнена з продажу в Syrve |
| 6 | Syrve | `Product … is excluded from menu` | позиція виключена з меню Syrve |
| 7 | будь-яка | `Creation timeout expired` | немає звʼязку з касою |
| 8 | Syrve | `Order item modifier … has invalid group amount` | некоректна кількість вибору модифікатора |
| 9 | Syrve | `Cannot find fixed group modifiers` | набір доповнень не привʼязаний до позиції в Syrve |
| 10 | Syrve | `Cannot find fixed simple modifiers item` | модифікатор не привʼязаний до позиції в Syrve |
| 11 | Syrve | `Cannot add product … top parent group isn't allowed for current department` | група товару недоступна для департаменту |
| 12 | Syrve | `Error converting value undefined to type System.Guid … productId` (маркетплейс) | немає POS ID + синхронізувати меню маркетплейсу |
| 13 | Syrve | те саме (звичайне замовлення) | у позиції немає POS ID |
| 14 | Syrve | `… in product … has invalid group amount` | як #8, але з назвою позиції |
| 15 | Syrve | `Product … doesn't have cooking place type` | не вказано тип місця приготування |
| 16 | Syrve | `Too small delivery date` | перехід на зимовий / літній час (2 тексти) |
| 17 | Poster | `Wrong dish modifications count` (210) | доповнення є в Choice, але не привʼязане до позиції в Poster |
| 18 | Poster | `Wrong modification(s) id` (211) | доповнення вже видалене з набору в Poster |

Джерело рішень: <https://choiceqr.notion.site/pos-2611788653438096a042db2ffb55eee2>
