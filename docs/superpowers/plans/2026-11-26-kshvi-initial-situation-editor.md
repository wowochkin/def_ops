# КШВИ: редактор исходной обстановки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Сделать исходную обстановку отдельным рабочим этапом с непосредственным нанесением знаков, понятными атрибутами и фактическими сторонами сценария.

**Architecture:** `ScenarioSide` — необязательное расширение `PreparationDraft` и `InitialSituationMap`, поэтому старые редакции продолжают читаться. `InitialMapEditor` получает самостоятельный шаг после «Силы и МТО»; текущие контроллер истории и MapLibre-взаимодействия расширяются без замены доменной модели.

**Tech Stack:** TypeScript, React, MapLibre GL, Vitest, Testing Library.

## Global Constraints

- `sides` необязателен во всех существующих сценариях; `country` необязательна; `color` только `red|blue`.
- Порядок: **Среда → Силы и МТО → Исходная обстановка → События → Готовность → Запуск**.
- Не требовать связь, неопределённость, числовую достоверность UNKNOWN или дату окончания открытого периода.
- Не запускать полный `npm test` или голосовой прогон; только указанные файлы и типизация.
- Не трогать `docs/release/kshvi/evidence/ac16/recovery-drill.json`.

---

### Task 1: Стороны сценария и цвета знаков

**Files:**
- Create: `packages/kshvi/src/scenario/sides.ts`
- Create: `apps/editor/src/modern/kshvi/ExerciseSidesEditor.tsx`
- Modify: `packages/kshvi/src/scenario/preparation-draft.ts`
- Modify: `packages/kshvi/src/scenario/initial-map.ts`
- Modify: `apps/editor/src/modern/kshvi/LibraryView.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/ForceEditor.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/initial-map-symbol.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx`
- Test: `packages/kshvi/tests/scenario-sides.test.ts`
- Test: `apps/editor/tests/kshvi-library-create.test.tsx`

**Interfaces:**
- `ScenarioSide = { id: string; name: string; country?: string | null; color: 'red' | 'blue' }`.
- `PreparationDraft.sides?: readonly ScenarioSide[]`; `InitialSituationMap.sides?: readonly ScenarioSide[]`.
- `defaultScenarioSides()` возвращает красных и синих; `symbolForSide(definition, side)` меняет только красный цвет на синий для стороны с `color === 'blue'`.

- [x] **Step 1: Добавить failing-тесты**

Проверить создание стороны без страны, две цветовые роли, перенос `sides` в `createInitialSituationMap`, красный знак синей стороны и неизменность чёрного. В форме создания учения проверить название, необязательную страну и отправку обеих сторон в `payload.preparation.sides`.

- [x] **Step 2: Запустить только эти тесты**

Run: `npx vitest run packages/kshvi/tests/scenario-sides.test.ts apps/editor/tests/kshvi-library-create.test.tsx`
Expected: FAIL — типы и редактор сторон отсутствуют.

- [x] **Step 3: Реализовать модель и редактор**

`ExerciseSidesEditor` показывает строки `name`, `country`, `color`, кнопку «Добавить сторону» и удаление с запретом пустого списка. `LibraryView` отправляет `payload.preparation = { ...emptyPreparationDraft(startsAt), sides }`. `ForceEditor` при наличии `draft.sides` заменяет свободный ввод стороны на select, сохраняя fallback для старых сценариев.

В `initial-map-symbol.ts` красные hex-значения сопоставляются по RGB, а не по точной строке; `InitialMapCanvas` передаёт сторону в `editedSymbol` для карты и легенды.

- [x] **Step 4: Повторить тесты**

Expected: PASS, старые данные без `sides` читаются.

---

### Task 2: Отдельный этап и отсутствие лишних блоков

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/preparation-steps.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/EnvironmentMapPreparation.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationStatus.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapEditor.tsx`
- Test: `apps/editor/tests/kshvi-initial-map-editor.test.tsx`

**Interfaces:**
- Новый `PreparationStep = 'initialMap'` между `forces` и `events`.
- `InitialMapEditor` не содержит `ParticipantRosterEditor` и импорт GeoJSON.

- [x] **Step 1: Добавить failing-тест отдельного этапа**

Проверить шесть кнопок в порядке «Среда, Силы и МТО, Исходная обстановка, События, Готовность, Запуск», открытие редактора по «Далее» из «Силы и МТО», отсутствие текста «Состав участников редакции», «Импорт GeoJSON» и выпадающего списка при одном служебном виде.

- [x] **Step 2: Запустить тест**

Expected: FAIL — пять этапов, редактор вложен в «Среду».

- [x] **Step 3: Изменить структуру**

Перенести открытие исходной обстановки в новый шаг. Убрать roster, GeoJSON и связанные состояния `geoJson/importPreview`. «Показ объектов» рендерится только при нескольких вариантах; вместо `TRUTH` — «Все объекты», вместо «Проекция карты» — «Вид обстановки». Варианты формируются из фактических audiences, без выдуманных участников.

- [x] **Step 4: Повторить тест**

Expected: PASS; существующие переходы подготовки не ломаются.

---

### Task 3: Нанесение и редактирование геометрии

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/initial-map-editor-controller.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/initial-map-canvas-interactions.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapEditor.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapSymbolPalette.tsx`
- Test: `apps/editor/tests/initial-map-editor-controller.test.ts`
- Test: `apps/editor/tests/kshvi-initial-map-editor.test.tsx`

**Interfaces:**
- Новые действия `DELETE_PENDING_VERTEX`, `MOVE_PENDING_VERTEX`, `DELETE_VERTEX`.
- `InitialMapEditor` обрабатывает Enter, Backspace, двойной щелчок по вершине и drop из палитры.

- [x] **Step 1: Добавить failing-тесты**

Для pending: добавить три точки, удалить последнюю Backspace-действием, переместить вершину и удалить её двойным щелчком. Для сохранённой LineString: удалить вершину без потери корректности. Для палитры: `dataTransfer.symbolId` при drop создаёт точку или начинает маршрут в координатах карты.

- [x] **Step 2: Запустить только эти тесты**

Expected: FAIL — действий нет.

- [x] **Step 3: Реализовать контроллер и события**

Enter вызывает `finish()`, Backspace удаляет последнюю pending-вершину. Двойной щелчок по вершине вызывает удаление, по пустому месту — завершение. `mousedown` разрешает перетаскивание pending-вершин. Палитра получает `draggable`, `onDragStart`; карта — `dragover/drop`. Переключение знака не требует Escape при пустом списке вершин.

- [x] **Step 4: Повторить тесты**

Expected: PASS; валидатор не допускает финальную LineString с совпадающими точками.

---

### Task 4: Атрибуты, проверка и календарь

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/MapObjectInspector.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapEditor.tsx`
- Modify: `packages/kshvi/src/scenario/initial-map-validation.ts`
- Test: `packages/kshvi/tests/initial-map-validation-open-period.test.ts`
- Test: `apps/editor/tests/kshvi-initial-map-editor.test.tsx`

**Interfaces:**
- Русские состояния `Наблюдается`, `Предполагается`, `Запланировано`, `Не оценивается`.
- `validUntil === ''` означает открытый срок.
- Связь и неопределённость необязательны; дополнительные параметры свёрнуты.

- [x] **Step 1: Добавить failing-тесты**

Проверить принятие `validUntil === ''`, `links = {}`, `radiusM = null`, `note = ''` и UNKNOWN с `confidence = null`. Проверить автоматическое название знака, select стороны, отсутствие полей автора и обязательной связи, явный результат повторной проверки.

- [x] **Step 2: Запустить тесты**

Expected: FAIL — прежние обязательные поля блокируют объект.

- [x] **Step 3: Реализовать значения и форму**

`chooseSymbol` создаёт имя `symbol.name · N`, `sourceId = 'manual:initial-situation'`, `eventId = 'manual:initial-situation'`, текущего автора, начало операции, `validUntil = endsAt ?? ''`, UNKNOWN и пустую неопределённость. Основная форма содержит имя, сторону, необязательные силу/задачу и надписи; остальные поля свёрнуты. Проходимость: «Определяется местностью», «Проходимо», «Закрыто».

`validateInitialMap` и серверный `validatePreparationDraft` принимают открытый срок и не требуют LINK/UNCERTAINTY для каждого знака. «Проверить карту» очищает старое уведомление и всегда показывает ошибки или «Ошибок нет». Календарь атрибутов выносится через `floating` за границы прокручиваемой панели; прозрачная обёртка не перекрывает рабочий экран, а сама панель остаётся привязанной к полю и не меняет компоновку.

- [x] **Step 4: Повторить затронутые тесты и типизацию**

Run: `npx vitest run packages/kshvi/tests/scenario-sides.test.ts packages/kshvi/tests/initial-map-validation-open-period.test.ts apps/editor/tests/kshvi-library-create.test.tsx apps/editor/tests/initial-map-editor-controller.test.ts apps/editor/tests/kshvi-initial-map-editor.test.tsx`
Run: `npm run typecheck 2>&1 | tail -3`
Expected: PASS.

---

### Task 5: Документация и визуальный контроль

**Files:**
- Modify: `docs/system.md`, `docs/img/kshvi-map-editor.jpg`
- Generate: `docs/system.pdf`, `docs/system.docx`

- [x] **Step 1: Проверить шесть этапов, нанесение и календарь**

Playwright при 1440 × 900: отдельная исходная обстановка, доступная палитра, создание маршрута, редактирование вершины и календарь без полноэкранного квадрата. Снимок заменяет `docs/img/kshvi-map-editor.jpg`; временные процессы остановить.

- [x] **Step 2: Обновить описание и проверить артефакты**

Описать порядок этапов, стороны, взаимодействие, русские состояния, открытый период и необязательные параметры. Выполнить `npm run docs:system`; проверить наличие нового текста в PDF/DOCX и размер снимка 1440 × 900.
