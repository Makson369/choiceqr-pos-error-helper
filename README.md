# ChoiceQR POS data — помічник з помилок

Tampermonkey-скрипт для сторінки
`https://europe-west1-choiceqr-*.cloudfunctions.net/pos-data/.../data/...`.
Витягує помилку POS (Poster / Syrve) з `Response`, зіставляє її з базою правил
і показує праворуч панель із готовим текстом рішення.

## Файли

| файл | що це |
|---|---|
| `choiceqr-pos-data-error-helper.user.js` | сам скрипт (ставиться в Tampermonkey) |
| `pos-error-rules.json` | **канонічна база правил** — редагуємо тільки її |
| `pos-error-rules.csv` | те саме у CSV (для варіанта з Google-таблицею) |
| `gen-rules.js` | генератор: з масиву `RULES` у ньому робить `.json` + `.csv` |

## Встановлення скрипта (одноразово)

1. Tampermonkey → Create a new script → вставити вміст `choiceqr-pos-data-error-helper.user.js`.
2. У рядку `const RULES_URL = 'PASTE_URL_HERE';` вставити raw-посилання на `pos-error-rules.json`
   (напр. `https://raw.githubusercontent.com/<user>/<repo>/main/pos-error-rules.json`
   або `https://gist.githubusercontent.com/<user>/<id>/raw/pos-error-rules.json`).
3. Зберегти. Далі скрипт не чіпаємо ніколи.

Скрипт кешує базу на 5 хв; кнопка **⟳** у шапці панелі оновлює негайно.

## Формат правила (`pos-error-rules.json`)

```json
{
  "match": {
    "code": "209",
    "message": "required modification missing",
    "regex": "…(?<group>…)…",
    "source": "Poster"
  },
  "title": "Заголовок у панелі",
  "solution": "Текст. \\n — новий рядок. Підстановки: {code} {message} {source}\n{itemId} {productId} {groupName} {httpCode} + іменовані групи з regex."
}
```

- Усі поля `match` опційні. Правило спрацьовує, якщо збіглися **всі заповнені**.
- Перший збіг згори — виграє.
- `regex` перевіряється по тексту помилки (прапорець `i`). Іменовані групи
  `(?<name>…)` доступні в `solution` як `{name}`.

## Як додати нове правило

1. Дописати обʼєкт у масив `RULES` у `gen-rules.js` (там зручні хелпери).
2. `node gen-rules.js` — перегенерує `pos-error-rules.json` і `.csv`.
3. Закомітити / оновити Gist — скрипт підхопить за ≤5 хв.

## Поточні правила

1. Poster — `Product ID is undefined` (item_id → шаблон pos-id `N--NW`)
2. Poster — `Required modification missing` (error 209; назва набору + product_id)
3. Poster — `Product ID is empty`
4. `Cannot read properties of undefined (reading 'order')` — некоректне посилання на замовлення
5. Syrve — позиція `is inactive` (вимкнена з продажу)
6. Syrve — `Cannot find fixed group modifiers` (набір доповнень не привʼязаний до позиції)

Джерело рішень: <https://choiceqr.notion.site/pos-2611788653438096a042db2ffb55eee2>
