# База знаний ↔ моделирование, часть 3 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** нормативы — факты базы (`param`, `outcome`); сборщик «база → правила» даёт коридоры множителей, происхождение ~50 входов правил и профилей и нормативы-итоги; калибровка обеих моделей подбирает в коридорах и учитывает итоги в мериле; «Основа правил» в интерфейсе.

**Architecture:** `packages/sim/src/rule-inputs.ts` — перечень входов и пересчёт коридоров в множители (без зависимости от базы); `packages/knowledge/src/compile-rules.ts` — выбор нормативов и сборка (перечень входов приходит параметром: пакеты по-прежнему не зависят друг от друга); склейка в редакторе (`apps/editor/src/sim/kb-rules.ts`) и в инструментах (`sim:calibrate`, `sim:norms`).

**Tech Stack:** TypeScript, vitest, React; Rust не меняется (агентная калибровка — в редакторе).

**Spec:** `docs/superpowers/specs/2026-10-14-kb-model-part3-design.md`

## Global Constraints

- Язык интерфейса, описания, коммитов — русский; в описании нет дат и упоминаний ассистента-разработчика и веток.
- Допуски коридора: A 0,10, B 0,20, C 0,35; вес нормативов-итогов в мериле 1/8 при ≥ 3 итогах операции; «упирается в границу» — итог в пределах 2 % ширины коридора от края. Все четыре — строки-допущения в `norms.json` (`assume-corridor-tolerance`, `assume-outcome-weight`, `assume-outcome-min`, `assume-corridor-edge`).
- Без норматива или у допущения коридор = `CALIB_SPACE`; коридор источника шире `CALIB_SPACE` — коридор источника с пометкой.
- Наборы правил (`packages/sim/data/rules/*.json`) не переписываются; новая калибровка в коридорах — отдельный набор `ww2-berlin-cor`.
- `packages/sim` и `packages/knowledge` не зависят друг от друга.
- По правилам репозитория: описание, снимки, `kb:seed`, `sim:norms -- --doc docs/norms-check.md`, `model:index`, `docs:system`; перед коммитом `npm run typecheck` и `npm test`.

## Review Focus

1. Норматив на параметр, которого нет в перечне входов (опечатка в пути, новый параметр в документе) — сомнение «неизвестный параметр» при приёме и пропуск в сборщике, а не падение. Тест — задачи 1 и 3.
2. Пересчёт через таблицу при нулевом или отрицательном значении таблицы, показатель местности при исходной поправке 1,0 (`ln 1 = 0`) — вход без коридора (прежние границы) с пометкой, без деления на ноль и `NaN`. Тест — задача 2.
3. Коридор, пересечение которого по нескольким видам местности пусто, — расхождение, коридор — у выбранного по правилу норматива. Тест — задача 3.
4. Калибровка, начатая из точки вне коридора (откалиброванный набор старше норматива), — стартовая точка переносится в коридор, без зацикливания. Тест — задача 4.
5. `sim:norms` для встроенных нормативов после переноса в базу даёт тот же отчёт, что до. Тест — задача 4.

---

### Task 1: Нормативы — виды фактов и сид

**Files:**
- Modify: `packages/knowledge/src/schema.ts` (`Claim` — `param`, `outcome`), `packages/knowledge/tools/build_seed.ts`, `packages/knowledge/src/resolve.ts` (subject/date для новых видов), `packages/sim/data/rules/norms.json` (четыре допущения из Global Constraints)
- Test: `packages/knowledge/tests/seed-norms.test.ts`, дополнить `packages/knowledge/tests/resolve.test.ts`

**Interfaces — Produces:**
- `Claim` += `{ kind: 'param'; param: string; value?: number; range?: [number, number]; unit?: string; side?: 'su' | 'de'; why?: string }` и `{ kind: 'outcome'; measure: string; scenario: string; subject?: string; from: string; to: string; range: [number, number]; unit: string }`.
- В `resolve`: о ком — `param` (с `side`: `param@su`), у `outcome` — `outcome:<scenario>:<measure>:<subject>`; дата — для `param` нет (состояние «всегда», сравнение по надёжности и свежести), для `outcome` — `to`.
- Сид: строка `norms.json` с `measure.kind` `param` → `param` (значение/диапазон из `expect`, `rules[0]` или `measure.expr` как путь); `assumption` → `param` без надёжности, `why` = `measure.why`, путь — `measure.expr`; `pace`/`loss`/`frontage` → `outcome`; `unmodelled` — текстовый факт без формальной части. Факт — в запись `kb` норматива, иначе в запись «Нормативы модели» (`gen:model-norms`).

- [ ] **Step 1:** тесты: каждая строка `norms.json` (кроме `unmodelled`) — ровно один факт с `param` или `outcome`; у допущений нет `reliability`, есть `why`; `pace-1gta-seelow` → `outcome` с `range [1,5]`, `measure 'pace'`, `subject 'su_1gta'`; `resolve` по `param`: A побеждает B, закрепление действует.
- [ ] **Step 2:** FAIL → реализация → `npm run kb:seed` → PASS; `npm run typecheck && npm test`.
- [ ] **Step 3:** коммит «База знаний: нормативы — факты значений правил и итогов».

### Task 2: Перечень входов и пересчёт коридоров

**Files:**
- Create: `packages/sim/src/rule-inputs.ts`
- Modify: `packages/sim/src/index.ts`, `packages/sim/src/calibrate.ts` (`Calibrator` принимает `space?: Partial<Record<CalibKey, [number, number]>>`, по умолчанию `CALIB_SPACE`)
- Test: `packages/sim/tests/rule-inputs.test.ts`

**Interfaces — Produces:**
- `interface RuleInput { path: string; title: string; unit?: string; group: 'бой' | 'оборона и местность' | 'движение' | 'подвоз' | 'усталость' | 'окружение' | 'профили' | 'агентная модель'; table?: true; calib?: CalibKey; engine: 'army' | 'agents'; read(rules: Rules, profiles: Record<string, SideProfile>, agents?: unknown): number | null }` — около 50 входов правил и профилей + параметры `agents-v0.json`, у которых есть норматив (`combat.penetrationKmDay`, `march.kmh.foot` и др. по `norms.json`).
- `RULE_INPUTS: RuleInput[]`; `ruleInput(path: string): RuleInput | undefined`.
- `TOLERANCE = { A: 0.10, B: 0.20, C: 0.35 }`.
- `corridorOf(v: { value?: number; range?: [number, number] }, rel: 'A' | 'B' | 'C' | undefined): [number, number] | null` — `null` для допущения.
- `toMultiplier(key: CalibKey, corridor: [number, number], rules: Rules, profiles): [number, number] | null` — прямые / через таблицу (`advance` ← `advanceMax`, потери ← значение таблицы при соотношении) / `terrainExp` = `ln(коридор)/ln(исходная поправка)` / `fortAdvance` ← `fortAdvanceKm` / `movement` ← темп марша профилей; `null` при нулевом знаменателе или `ln 1` (Review Focus 2).

- [ ] **Step 1:** тесты: каждый `CalibKey` имеет вход с `calib`; `corridorOf({value:1.35},'B')` = `[1.08, 1.62]`; `corridorOf({range:[25,45]},'C')` = `[16.25, 60.75]`; без надёжности — `null`; `advance` при `advanceMax` 25–45 и исходном наибольшем темпе 30 → `[0.833, 1.5]` (±допуск уже в коридоре); `terrainExp` при исходной поправке 1,0 → `null`; таблица с нулём → `null`; `Calibrator` с `space` не выходит за него.
- [ ] **Step 2:** FAIL → реализация → PASS; typecheck, test.
- [ ] **Step 3:** коммит «Модель: перечень входов правил и пересчёт коридоров».

### Task 3: Сборщик «база → правила»

**Files:**
- Create: `packages/knowledge/src/compile-rules.ts`, `apps/editor/src/sim/kb-rules.ts`
- Modify: `packages/knowledge/src/checks.ts` (для `param`: путь известен — `ctx.knownParams?.has(path)`, иначе сомнение «неизвестный параметр»; диапазон упорядочен; для `outcome` — соединение и даты), `packages/knowledge/src/extract.ts` (виды `param`, `outcome` в схеме извлечения и промпте), `apps/editor/src/kb/fact-form.ts` и `FactForm.tsx` (поля новых видов, параметр — из перечня), `apps/editor/src/sim/kb-recompile.ts` (пересборка правил и запись в журнал при изменении)
- Test: `packages/knowledge/tests/compile-rules.test.ts`, дополнить `checks.test.ts`, `apps/editor/tests/fact-form.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Claim`), Task 2 (`RULE_INPUTS`, `corridorOf`, `toMultiplier`) — передаются параметром.
- Produces: `compileRules(entries: Entry[], inputs: { path: string; calib?: string; engine: string; value: number | null }[], pins: Pins, o: { corridorOf; toMultiplier: (key: string, c: [number, number]) => [number, number] | null; space: Record<string, [number, number]> }) → { corridors: Record<string, { range: [number, number]; fact: FactRef | null; wider?: true; tableMissing?: true }>; provenance: { path: string; fact: FactRef | null; reliability: 'A' | 'B' | 'C' | 'assumption' }[]; outcomes: { fact: FactRef; claim: Extract<Claim, { kind: 'outcome' }> }[]; conflicts: { path: string; facts: FactRef[] }[] }`.
- `apps/editor/src/sim/kb-rules.ts`: `rulesBasis(rulesId: string): Promise<ReturnType<typeof compileRules>>` (правила, профили, `agents-v0.json`, база, закрепления).

- [ ] **Step 1:** тесты: коридор `prepared` из норматива B; два норматива на одну поправку — выбор по надёжности, непересекающиеся — расхождение (Review Focus 3); норматив на неизвестный путь — пропуск без исключения и сомнение при проверке кандидата (Review Focus 1); коридор шире `CALIB_SPACE` — `wider`; происхождение у всех входов, допущение — `assumption`; итоги по операции.
- [ ] **Step 2:** FAIL → реализация → PASS; typecheck, test.
- [ ] **Step 3:** коммит «База знаний: сборщик правил — коридоры, происхождение, итоги».

### Task 4: Калибровка в коридорах, мерило с итогами, проверка нормативов

**Files:**
- Modify: `packages/sim/src/calibrate.ts` (мерило с итогами: `scoreRules`/`evaluateRules` принимают `outcomes?: Norm[]`; при ≥ 3 — `7/8 × нынешнее + 1/8 × (1 − доля в допуске) × 50`; `calibratedRules` записывает `calibration.corridors`), `packages/sim/src/norms.ts` (`evaluateNorms` принимает таблицу, собранную из базы), `packages/sim/tools/run/calibrate.ts` и `packages/sim/tools/run/norms.ts` (собрать коридоры и итоги из сида базы), `packages/sim/src/agents-score.ts` (итоги с тем же весом и порогом), `apps/editor/src/modeling/CalibrateTab.tsx`, `apps/editor/src/modeling/AgentsTab.tsx` (множители вне коридора не пробуются), отчёт калибровки (`report.ts` или где формируется таблица множителей)
- Test: `packages/sim/tests/calibrate-corridors.test.ts`, дополнить `packages/sim/tests/norms.test.ts`, `apps/editor/tests/agents-corridor.test.ts`

**Interfaces — Produces:** `edgeOf(v: number, c: [number, number]): 'low' | 'high' | null` (2 % ширины); `outcomesScore(results: NormResult[]): number | null` (`null` при < 3).

- [ ] **Step 1:** тесты: калибратор с коридором не выходит за него; старт вне коридора переносится внутрь (Review Focus 4); мерило с 3 итогами — формула, с 2 — прежнее; `edgeOf` у края; отчёт `sim:norms` по нормативам, собранным из сида, равен отчёту по `norms.json` (Review Focus 5); агентная калибровка пропускает множитель вне коридора.
- [ ] **Step 2:** FAIL → реализация → PASS; `npm run sim:norms -- --doc docs/norms-check.md`; typecheck, test.
- [ ] **Step 3:** коммит «Калибровка: коридоры из нормативов, итоги в мериле».

### Task 5: «Основа правил» и коридоры в интерфейсе

**Files:**
- Create: `apps/editor/src/modeling/RulesBasis.tsx`
- Modify: `apps/editor/src/modeling/ModelsTab.tsx` (блок у набора правил), `apps/editor/src/modeling/CalibrateTab.tsx` (коридор с источником у множителя, пометка «упирается в границу»), `apps/editor/src/KnowledgeView.tsx` / `apps/editor/src/modeling/basis.ts` (`claimText` для `param`/`outcome`), `apps/editor/src/styles.css`
- Test: `apps/editor/tests/rules-basis.test.ts` (сводка: доли A/B/C/допущений, отдельно подбираемые; группы)

**Interfaces — Consumes:** `rulesBasis`, `RULE_INPUTS`, `edgeOf`.

- [ ] **Step 1:** тест сводки → FAIL → реализация → PASS.
- [ ] **Step 2:** блок «Основа правил» по разделу 4 проекта (итог, входы по группам со значком и коридором, раскрытие источника, у откалиброванного набора — исходное значение и множитель, расхождения с закреплением, итоги с результатом последней проверки); коридоры в «Калибровке»; формальные факты новых видов словами.
- [ ] **Step 3:** typecheck, test; коммит «Моделирование: основа правил, коридоры в калибровке».

### Task 6: Прогон, описание, снимки

**Files:** `packages/sim/data/rules/ww2-berlin-cor.json` (новый набор), `docs/system.md` (часть I — «Основа правил», коридоры в «Калибровке»; часть II — «Калибровка», «Данные»), `docs/img/*.jpg`, `docs/norms-check.md`, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`

- [ ] **Step 1:** `npm run sim:calibrate` Берлинской операции в коридорах → набор `ww2-berlin-cor`; записать: мерило обучения и проверки против `ww2-berlin-cal`, упёршиеся множители, доля итогов в допуске до/после; `npm run sim:demo` для набора.
- [ ] **Step 2:** снимки: «Основа правил» (итог и входы, раскрытый источник), коридоры в «Калибровке», формальный факт-норматив в записи базы; подписи — ровно то, что видно.
- [ ] **Step 3:** описание (цифры — только из шага 1), `npm run kb:seed`, `npm run sim:norms -- --doc docs/norms-check.md`, `npm run model:index`, `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system`, typecheck, test.
- [ ] **Step 4:** коммит «База знаний ↔ моделирование, часть 3: описание, снимки, результаты».
