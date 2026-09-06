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
2. `RULES_URL` уже вказує на
   `https://raw.githubusercontent.com/Makson369/choiceqr-pos-error-helper/main/pos-error-rules.json`.
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

## Перевірити правило без реальної помилки (прев'ю)

Відкрити будь-яку сторінку `pos-data/...` з параметрами:

```
?cqr_preview=<текст помилки>
   &cqr_src=Poster|Syrve        (опц., якщо правило вимагає source)
   &cqr_code=209                (опц.)
   &cqr_item=3 &cqr_pid=531 &cqr_group=Соуси   (опц. підстановки)
```

Приклад (rule #6):
`…/pos-data/CFD8F0A8-2809-4FF9-96C8-F78A11A3B78B?cqr_src=Syrve&cqr_preview=Cannot%20find%20fixed%20group%20modifiers%20'Syrups'%20in%20order%20item%20'Fluff%20Coffee'%20(Id%20%3D%205a85e337-4f23-4164-95c5-cdd501e22664)`

## Як додати нове правило

1. Дописати обʼєкт у масив `RULES` у `gen-rules.js` (там зручні хелпери).
2. `node gen-rules.js` — перегенерує `pos-error-rules.json` і `.csv`.
3. `git commit -am "..." && git push` — скрипт підхопить за ≤5 хв (або по кнопці ⟳).

(Це роблю я — від тебе потрібні лише «помилка → рішення».)

## Поточні правила

1. Poster — `Product ID is undefined` (item_id → шаблон pos-id `N--NW`)
2. Poster — `Required modification missing` (error 209; назва набору + product_id)
3. Poster — `Product ID is empty`
4. `Cannot read properties of undefined (reading 'order')` — некоректне посилання на замовлення
5. Syrve — позиція `is inactive` (вимкнена з продажу)
6. Syrve — `Cannot find fixed group modifiers` (набір доповнень не привʼязаний до позиції)

Джерело рішень: <https://choiceqr.notion.site/pos-2611788653438096a042db2ffb55eee2>
