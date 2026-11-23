# КШВИ: рабочее место и справочник — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** превратить подготовку КШВИ в пошаговое рабочее место, а справочник знаков — в полноценный навигатор по векторам и исходным документам.

**Architecture:** существующие серверные API и доменные модели сохраняются. React-компоненты разделяются на мастер подготовки, экран среды, карту снимка, каталог знаков и карточку знака/документа; визуальное состояние не объявляется официальным без сервера.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, MapLibre GL, Playwright, существующие `@def-ops/kshvi` и `@def-ops/tactical-symbols`.

## Global Constraints

- Не менять ожидания приёмочных тестов ради прохождения; сначала failing test, затем минимальная реализация.
- Неизвестное не подменять нулём, `NORMAL` или центром карты.
- `APPROVED` не присваивать автоматически; AC-30 требует человеческой методической сверки.
- Не читать `localStorage` соседней карты для официальной среды.
- Перед каждым коммитом реализации: `npm run typecheck`, полный `npm test`, обновление `docs/system.md`, PDF/DOCX и затронутых снимков.

---

### Task 1: Стабильная сессия и фактическая карта снимка

**Files:**
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx`
- Modify: `apps/desktop/server/launch.mjs`
- Test: `apps/editor/tests/kshvi-auth.test.tsx`
- Test: `apps/editor/tests/kshvi-initial-map-canvas.test.ts`
- Test: `apps/desktop/tests/launch-services.test.ts`

**Interfaces:**
- Consumes: `ExerciseClient.login`, `createEnvironmentSnapshot`, `InitialMapCanvas`.
- Produces: CSRF в `sessionStorage` для того же `baseUrl`; стиль и тайлы только из `/api/kshvi/environment/snapshots/:id/...`.

- [ ] **Step 1: Добавить failing test повторного клиента после перезагрузки**

```ts
const first = new ExerciseClient({ fetch: fetcher });
await first.login('local-leader', 'local-kshvi');
const second = new ExerciseClient({ fetch: fetcher });
await second.create({ title: 'Учение', purpose: 'planned', scale: 'operational' });
expect(lastRequest.init?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-from-server' });
```

- [ ] **Step 2: Запустить тест и увидеть пустой CSRF**

Run: `npx vitest run apps/editor/tests/kshvi-auth.test.tsx`
Expected: FAIL, `X-CSRF-Token` пуст после создания второго клиента.

- [ ] **Step 3: Сохранить CSRF в границах окна**

```ts
private sessionCsrfToken = '';
private csrfStorageKey() { return `def_ops.kshvi.csrf:${this.baseUrl}`; }
// constructor: безопасно прочитать sessionStorage при наличии
// login: записать result.csrfToken в поле и sessionStorage
```

- [ ] **Step 4: Проверить API, стиль снимка и нативные адреса**

Run: `npx vitest run apps/editor/tests/kshvi-auth.test.tsx apps/editor/tests/kshvi-initial-map-canvas.test.ts apps/desktop/tests/launch-services.test.ts`
Expected: PASS, `CARTOGRAPHY_URL` и `KSHVI_INTERNAL_URL` присутствуют в тесте запуска.

- [ ] **Step 5: Проверить реальную карту и зафиксировать**

В нативном клиенте выполнить вход, создать учение, выбрать атлас, зафиксировать среду, дождаться тайлов. Повторить создание редакции после перезагрузки; 403 быть не должно. Выполнить проверки из Global Constraints и отдельный коммит `КШВИ: стабилизировать сессию и карту снимка`.

---

### Task 2: Пошаговый мастер подготовки

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/preparation-steps.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/preparation.css`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`
- Test: `apps/editor/tests/kshvi-preparation-steps.test.tsx`

**Interfaces:**
- Consumes: существующие `EnvironmentMapPreparation`, `AutonomyEditor`, `CatalogBrowser`, `ReadinessStep`, `LogisticsStep`, `FormationStep`, `EquipmentStep`.
- Produces: `PreparationStep = 'environment' | 'forces' | 'events' | 'readiness' | 'launch'`; одновременно монтируется один шаг.

- [ ] **Step 1: Написать failing test единственного шага**

```tsx
render(<PreparationWorkspace client={client} exerciseId="e1" revision={1} authorId="u1" truthRole="DIRECTOR" onRevision={vi.fn()} />);
expect(screen.getByRole('button', { name: 'Среда' })).toHaveAttribute('aria-current', 'step');
expect(screen.queryByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeNull();
fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
expect(screen.getByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeTruthy();
```

- [ ] **Step 2: Подтвердить одновременный показ всех панелей**

Run: `npx vitest run apps/editor/tests/kshvi-preparation-steps.test.tsx`
Expected: FAIL, панели других шагов видны одновременно.

- [ ] **Step 3: Реализовать шаги и нижние действия**

```tsx
const steps = [
  { id: 'environment', label: 'Среда' }, { id: 'forces', label: 'Силы и МТО' },
  { id: 'events', label: 'События' }, { id: 'readiness', label: 'Готовность' }, { id: 'launch', label: 'Запуск' },
] as const;
// nav: aria-label="Этапы подготовки", aria-current="step"
// footer: «Назад» disabled на первом шаге; «Далее» до launch; «Запуск» связан с SEALED в KshviView
```

- [ ] **Step 4: Убрать локальный редактор из официального пути**

```tsx
{!selectedExercise && <LocalEditor />}
```

- [ ] **Step 5: Прогнать регрессии и применить единые стили**

Run: `npx vitest run apps/editor/tests/kshvi-preparation-steps.test.tsx apps/editor/tests/kshvi-autonomy-integration.test.tsx apps/editor/tests/kshvi-full-navigation.test.tsx`
Expected: PASS; панели имеют единые отступы, подписи, действия и адаптивную компоновку. Выполнить проверки из Global Constraints и коммит `КШВИ: собрать пошаговую подготовку`.

---

### Task 3: Компактная среда и читаемая карта

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/EnvironmentMapPreparation.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/preparation.css`
- Test: `apps/editor/tests/kshvi-preparation-environment.test.tsx`

**Interfaces:**
- Consumes: `EnvironmentMapPreparation`, `InitialMapCanvas`, серверный `map-approval`.
- Produces: компактная форма среды, свёрнутые расширенные параметры, крупная карта и отдельные секции нанесения.

- [ ] **Step 1: Добавить ожидания компактного представления**

```tsx
expect(screen.getByText('Расширенные параметры погоды')).toBeTruthy();
expect(screen.getByLabelText('Атлас района')).toBeTruthy();
// после фиксации: секция «Топографическая карта исходной обстановки» предшествует ручному нанесению
```

- [ ] **Step 2: Проверить исходную длинную форму**

Run: `npx vitest run apps/editor/tests/kshvi-preparation-environment.test.tsx`
Expected: FAIL, расширенная секция отсутствует либо карта не имеет приоритета.

- [ ] **Step 3: Сгруппировать настройки и нанесение**

```tsx
<details><summary>Расширенные параметры погоды</summary>{/* числовые поля */}</details>
<InitialMapCanvas snapshot={snapshot} map={map} />
<details><summary>Ручное нанесение и GeoJSON</summary>{/* существующие поля */}</details>
```

- [ ] **Step 4: Проверить карту и экран 1440×900**

Run: `npx vitest run apps/editor/tests/kshvi-preparation-environment.test.tsx apps/editor/tests/kshvi-initial-map-canvas.test.ts`
Expected: PASS. Визуально карта занимает основную зону, основное действие видно, длинные хеши не растягивают сетку. Выполнить Global Constraints и коммит `КШВИ: упорядочить среду и исходную карту`.

---

### Task 4: Полноценный справочник знаков и исходных документов

**Files:**
- Create: `apps/editor/src/modern/symbols/symbol-labels.ts`
- Create: `apps/editor/src/modern/symbols/SourceDocuments.tsx`
- Modify: `apps/editor/src/modern/symbols/SymbolsView.tsx`
- Modify: `apps/editor/src/modern/symbols/SymbolCard.tsx`
- Modify: `apps/editor/src/modern/symbols/symbols.css`
- Test: `apps/editor/tests/symbols-workspace.test.tsx`

**Interfaces:**
- Consumes: `searchSymbols`, `coverageReport`, `sourceRegistry`, `fragmentUrl`, `SymbolPreview`.
- Produces: режимы `SYMBOLS | DOCUMENTS`; человекочитаемые статусы; выбор документа и страницы без сети.

- [ ] **Step 1: Написать failing test представлений и статусов**

```tsx
render(<SymbolsView />);
expect(screen.getByRole('button', { name: 'По документам' })).toBeTruthy();
expect(screen.getAllByText('Вектор сопоставлен').length).toBeGreaterThan(0);
fireEvent.click(screen.getByRole('button', { name: 'По документам' }));
expect(screen.getByText('Оглавление исходных документов')).toBeTruthy();
fireEvent.click(screen.getByRole('button', { name: /01ПУ\.doc/ }));
expect(screen.getByRole('button', { name: /Страница 1/ })).toBeTruthy();
```

- [ ] **Step 2: Подтвердить отсутствие документального режима**

Run: `npx vitest run apps/editor/tests/symbols-workspace.test.tsx`
Expected: FAIL, переключателя и читаемых статусов нет.

- [ ] **Step 3: Реализовать подписи и представление документов**

```ts
export const statusLabels = {
  IMPORTED: 'Импортирован', MAPPED: 'Вектор сопоставлен', VERIFIED: 'Проверен',
  APPROVED: 'Утверждён', DEPRECATED: 'Устарел',
} as const;
// SourceDocuments: documents → pages → крупный fragment; связанные знаки и gaps рядом
```

- [ ] **Step 4: Собрать карточку знака по зонам**

```tsx
// слева оглавление; в центре крупный SymbolPreview и топооснова;
// справа исходный фрагмент, документ/страница, правило, версии и причина блокировки вставки
```

- [ ] **Step 5: Проверить каталог и визуальную сверку**

Run: `npx vitest run apps/editor/tests/symbols-workspace.test.tsx apps/editor/tests/modern-symbols.test.tsx`
Expected: PASS либо только фактически отсутствующий файл теста уточняется по Glob перед командой. На 1440×900 видны оглавление, крупный вектор и исходник; ограничения не повторяются в каждой строке. Выполнить Global Constraints и коммит `КШВИ: раскрыть справочник знаков и источники`.

---

### Task 5: Визуальная и регрессионная приёмка

**Files:**
- Create: `apps/editor/tests/kshvi-workspace.spec.ts`
- Modify: `docs/system.md`, `docs/img/modern-kshvi-*.jpg`, `docs/img/modern-symbols*.jpg`, `docs/system.pdf`, `docs/system.docx`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: воспроизводимые снимки и итоговые проверки; не подменяет AC-01–AC-30.

- [ ] **Step 1: Записать сквозной пользовательский путь**

```ts
// вход → создание учения → Среда → атлас → снимок → карта → Силы и МТО → События → Готовность
// отдельно: Условные знаки → По знакам → По документам → документ → страница
```

- [ ] **Step 2: Снять экраны 1440×900 и проверить клавиатуру/узкое окно**

Run: `npx playwright test apps/editor/tests/kshvi-workspace.spec.ts --project=chromium`
Expected: PASS; снимки показывают текущий шаг, карту, крупный вектор и исходник, основное действие без длинной прокрутки.

- [ ] **Step 3: Обновить описание и документы**

```bash
PATH="$PWD/.tmp/tools/pandoc-3.1.11.1-arm64/bin:$PATH" npm run docs:system
```

Expected: существуют обновлённые `docs/system.pdf` и `docs/system.docx`.

- [ ] **Step 4: Выполнить финальные проверки и зафиксировать**

```bash
npm run typecheck
TEST_DATABASE_URL=postgres://vladimirabramov@127.0.0.1:5432/postgres DEFOPS_REQUIRE_GAME_TESTS=1 npm test
git add apps/desktop apps/editor services/kshvi docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: завершить рабочее место и справочник"
```

Expected: typecheck без ошибок; полный регресс без failed. Оставшиеся AC/NF и человеческая AC-30 не объявляются пройденными этим коммитом.
