# Полный векторный перенос тактических знаков — план реализации

> **Для исполнителя:** выполнять задачи последовательно в текущей изолированной рабочей копии, каждую через failing test → реализацию → зелёный тест. Без отдельных агентов и без автоматического статуса APPROVED.

**Цель:** заменить 19 заготовок полным номерованным векторным справочником из 29 DOC / 83 страниц, сохранив исходный вид и редактируемость линий и областей.

**Архитектура:** отдельный офлайн-импортёр преобразует DOC в PDF/SVG и строит реестр номерованных записей и вариантов. Общий пакет хранит векторные страницы один раз; `SymbolDefinition` ссылается на них через `SourceVectorGeometry`. Runtime не читает DOC и не запрашивает внешние ресурсы.

**Технологии:** TypeScript, React, SVG, MapLibre, Vitest, Playwright, существующие `soffice`, `pdftocairo`, `pdftotext`, `sharp`.

## Общие ограничения

- Исходный ZIP и его SHA-256 не меняются.
- Нельзя выдумывать отсутствующие названия, номера, правила или модификаторы.
- IMPORTED/MAPPED/VERIFIED/APPROVED не присваиваются автоматически без соответствующих доказательств.
- Площадной эталон не становится неизменной географической геометрией сценария.
- Публичные страницы справочника читаются без сессии; API учений остаются закрытыми.

---

### Задача 1: Аудит и извлечение всех номерованных записей

**Файлы:**
- Create: `packages/tactical-symbols/tools/extract-vector-catalog.mjs`
- Create: `packages/tactical-symbols/src/source/vector-extract.ts`
- Test: `packages/tactical-symbols/tests/vector-extract.test.ts`
- Produce: `packages/tactical-symbols/data/vector-catalog-report.json`

**Интерфейсы:**
- `extractNumberedEntries(pageText: string): { number: string; text: string }[]` — извлекает строки, начинающиеся с исходного номера.
- `assertContiguousCoverage(entries): { first: number; last: number; count: number }` — выявляет пропуски и дубликаты.
- `extractVectorCatalog()` — материализует DOC/PDF/SVG во временном каталоге и записывает отчёт, не меняя действующий набор.

- [x] Написать тест с двумя страницами, вариантами 1/2 и номерами 75–82; проверить, что номер и текст не смешиваются с вариантами.
- [x] Запустить `npx vitest run packages/tactical-symbols/tests/vector-extract.test.ts` и увидеть FAIL из-за отсутствующего модуля.
- [x] Реализовать разбор номеров и проверку непрерывности.
- [x] Повторить тест и получить PASS.
- [x] Запустить `node packages/tactical-symbols/tools/extract-vector-catalog.mjs --audit`; получить отчёт по всем 29 DOC и 83 страницам с явным списком неоднозначностей.

### Задача 2: Точный векторный образец и его проверка

**Файлы:**
- Create: `packages/tactical-symbols/src/source-vector.ts`
- Modify: `packages/tactical-symbols/src/model.ts`
- Modify: `packages/tactical-symbols/src/render-svg.ts`
- Test: `packages/tactical-symbols/tests/source-vector.test.ts`

**Интерфейсы:**
- `SourceVectorGeometry = { version: 1; template: 'SOURCE_VECTOR'; parameters: { pageId: string; viewBox: string } }`.
- `renderSourceVector(pageId, viewBox, options)` — возвращает SVG с общим исходным содержимым страницы и точным охватом.
- `sourceVectorPage(pageId)` — возвращает зарегистрированный SVG или выбрасывает понятную ошибку.

- [x] Написать failing test: два разных охвата одной страницы дают разные SVG, сохраняют `<defs>` и не содержат внешних URL/TTF.
- [x] Запустить тест и подтвердить FAIL.
- [x] Реализовать рендер с экранированием исходного viewBox и запретом внешних ресурсов.
- [x] Повторить тест; затем выполнить весь `packages/tactical-symbols/tests`.

### Задача 3: Полный номерованный каталог и варианты

**Файлы:**
- Modify: `packages/tactical-symbols/tools/extract-vector-catalog.mjs`
- Create: `packages/tactical-symbols/data/vector-pages.json`
- Create: `packages/tactical-symbols/data/sets/ru-modern-v2.json`
- Modify: `packages/tactical-symbols/src/registry.ts`
- Test: `packages/tactical-symbols/tests/source-registry.test.ts`

**Интерфейсы:**
- Каждая запись содержит `id: source-<номер>-<вариант>`, `source.symbolNumber`, `source.fragmentId`, `geometry` из задачи 2 и `status: 'MAPPED'` только после формирования векторного образца.
- Вариант без отдельного векторного охвата получает явный блокер в отчёте, а не общий усреднённый значок.

- [x] Добавить failing test: число записей равно числу подтверждённых элементов отчёта; нет имён с «несверенная заготовка», нет дублей `document/page/number/variant`, все fragmentId существуют.
- [x] Запустить тест и подтвердить FAIL на наборе v1.
- [x] Сформировать v2 из исходных SVG, зарегистрировать страницы и связать каждый знак с точным фрагментом.
- [x] Повторить тесты и `node packages/tactical-symbols/tools/import-source.mjs --check`.

### Задача 4: Редактируемые линии и области

**Файлы:**
- Create: `packages/tactical-symbols/src/editable-geometry.ts`
- Modify: `packages/tactical-symbols/src/render-maplibre.ts`
- Test: `packages/tactical-symbols/tests/editable-geometry.test.ts`

**Интерфейсы:**
- `lineFeature(symbolId, coordinates)` — создаёт GeoJSON LineString с сохранённым стилем источника.
- `areaFeature(symbolId, ring)` — создаёт GeoJSON Polygon с исходной границей/заливкой и правилами подписей.
- Оба отклоняют менее двух точек линии и менее четырёх позиций замкнутого кольца области.

- [x] Написать failing tests для произвольного маршрута и нового полигона; проверить, что координаты эталонного образца не подменяют пользовательские.
- [x] Реализовать минимальные GeoJSON-функции и MapLibre-стили.
- [x] Запустить новые и существующие rendering tests.

### Задача 5: Единый интерфейс справочника и локальные источники

**Файлы:**
- Modify: `apps/editor/src/modern/symbols/SymbolsView.tsx`
- Modify: `apps/editor/src/modern/symbols/SymbolCard.tsx`
- Modify: `apps/editor/src/modern/symbols/SourceDocuments.tsx`
- Modify: `apps/editor/src/modern/symbols/symbols-api.ts`
- Modify: `services/kshvi/src/http/symbol-routes.ts`
- Test: `apps/editor/tests/modern-symbols.test.tsx`
- Test: `apps/editor/tests/modern-symbols.spec.ts`
- Test: `services/kshvi/tests/symbol-routes.test.ts`

**Интерфейсы:**
- Каталог использует набор v2, показывает номер, вариант, векторный образец и источник.
- `fragmentUrl(fragmentId)` остаётся тем же локальным API.
- Публичные GET `/kshvi/symbols/*` не требуют сессии; остальные API сохраняют 401 без неё.

- [x] Добавить failing UI test: каталог показывает номер и вариант, изображение источника имеет `naturalWidth > 0`, отсутствуют внешние запросы.
- [x] Реализовать отображение v2 и ошибок загрузки с явным действием «Повторить».
- [x] Запустить Vitest и Playwright при 1440×900; сохранить `docs/img/modern-symbols.jpg` и `docs/img/modern-symbols-documents.jpg`.

### Задача 6: Сквозная приёмка и описание системы

**Файлы:**
- Modify: `docs/system.md`
- Modify: `services/kshvi/tests/acceptance/ac30-symbols.test.ts`
- Produce: `docs/release/kshvi/evidence/ac30/vector-coverage.json`
- Produce: `docs/system.pdf`, `docs/system.docx`

- [x] Сформировать доказательства покрытия всех номеров/вариантов, отсутствия внешних ресурсов, визуальных сравнений и редактируемых линий/областей.
- [x] Обновить описание и снимки фактическим поведением, без заявления человеческого APPROVED.
- [x] Выполнить `npm run docs:system`, `npm run typecheck`, полный `npm test` и зафиксировать итоги.
- [x] Обновить AC-30: технические проверки могут пройти, но человеческое методическое утверждение остаётся отдельным и явным.

## Фактическая реализация

Действующий набор — `ru-modern-v3`: 610 исходных номеров, 905 номерованных вариантов и 20 непронумерованных записей МПО. Изолированные DOC-строки дополнены исходными SVG для шести вариантов с плавающей графикой. Общие глифы дедуплицируются в `vector-definitions.json`; рабочие образцы не содержат пояснительных цифр вариантов. Исходные надписи редактируются с сохранением цвета, положения, гарнитуры, жирности и курсива. Техническая полнота подтверждена, человеческое `APPROVED` отдельно не присвоено.
