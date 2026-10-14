# База знаний ↔ моделирование, часть 1 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** факты базы знаний с формальной частью питают обе модели через сборщик «база → модель», с источником у каждого входа; движки исполняют пополнения и переподчинение по датам и сверяют численность и потери с документами; принятие командования начинается с состояния по фактам.

**Architecture:** `Claim` в факте базы (`packages/knowledge`); чистые `resolve` и `compileOperation` там же; поправки (`OperationEdits` редактора) пересобираются при изменении базы и накладываются при чтении сценария и истории, как сейчас; оба движка получают `changes` и контрольные точки; ядро на Rust — через новый вход `edits` команд `run_scenario` / `game_start`.

**Tech Stack:** TypeScript (vitest), React (редактор), Rust (ядро `crates/agents-core`, `cargo test`), IndexedDB (база в браузере).

**Spec:** `docs/superpowers/specs/2026-10-14-kb-model-part1-design.md`

## Global Constraints

- Язык интерфейса, описания и сообщений коммитов — русский; комментарии в коде — по-русски, как в окружающем коде.
- Каждый коммит, меняющий поведение: `docs/system.md` (часть I — система, часть II — модель), при правке части II — `npm run kb:seed` до `npm test`; `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system` (коммитятся `docs/system.pdf`, `docs/system.docx`); в описании нет дат и упоминаний ассистента.
- Перед коммитом: `npm run typecheck`, `npm test`; для ядра — `cargo test -p agents-core`.
- Цифры результатов модели в описании — только из свежего прогона.
- Порядок выбора факта: закрепление → надёжность (A > B > C; без надёжности — C) → меньшее |дата − момент| → более свежий документ.
- Расхождение численности: разница больше 5 % (и порога нынешней сверки `reconcile`).
- Допуск контрольной точки численности или потерь: ±25 %; в мерило калибровки — с весом ¼, только если в обучающей половине точек ≥ 10.
- Состояние при принятии командования: численность — факт не старше суток; положение — не старше суток и неопределённость ≤ допуска ступени (армия 15 км, корпус 8, дивизия 5).
- Начальное состояние — факты в пределах ±2 суток от начала операции (как сейчас в сверке).

## Review Focus

- Факт о формировании, которого нет в сценарии (опечатка в id, другая операция) — сборщик пропускает его и показывает в «Основе модели» как «не сопоставлен»; модель не падает. → тест в Task 3.
- Переподчинение на штаб, которого нет в сценарии (или на самого себя / цикл) — изменение не исполняется, запись в журнал расчёта; ядро не падает. → тесты в Task 4 и Task 5.
- Пополнение до ввода формирования (`at` < `enterAt`) — прибавляется к начальным силам при вводе, а не теряется. → тест в Task 4.
- Закрепление на факт, который потом удалён из базы — закрепление игнорируется, выбор по правилу, в расхождениях — пометка «закреплённый факт удалён». → тест в Task 1.
- Пустая база пользователя (только сид) у своей операции без фактов — поправки пустые, расчёт как раньше, «Основа модели» показывает «всё на допущениях». → тест в Task 3.

---

### Task 1: формальная часть факта и выбор из нескольких

**Files:**
- Modify: `packages/knowledge/src/schema.ts` (тип `Claim`, поле `Fact.claim?`)
- Create: `packages/knowledge/src/resolve.ts`
- Modify: `packages/knowledge/src/index.ts` (экспорт)
- Test: `packages/knowledge/tests/resolve.test.ts`

**Interfaces:**
- Produces:
  - `type Claim` (спецификация, раздел 1) плюс вид `{ kind: 'losses'; subject: string; from: string; to: string; killed?: number; wounded?: number; missing?: number; tanks?: number }` — потери за период.
  - `interface FactRef { entry: string; index: number; fact: Fact; updated: string }` — факт с адресом.
  - `claimFacts(entries: Entry[]): FactRef[]` — все факты с `claim`.
  - `type Pins = Record<string, { entry: string; index: number } | 'none'>`; `pinKey(kind: Claim['kind'], subject: string, moment: string): string` → `` `${kind}|${subject}|${moment}` ``.
  - `resolve(facts: FactRef[], kind: Claim['kind'], subject: string, moment: string, pins: Pins, o?: { window?: number /* сутки, ±; по умолчанию 0 — только at ≤ moment */ }): { chosen: FactRef | null; candidates: FactRef[]; conflict: boolean; pinMissing?: boolean }`.

- [ ] **Step 1: Write the failing tests** (`resolve.test.ts`):
  - `надёжность важнее даты`: факты strength A на 15.04 и B на 16.04, момент 16.04, window 2 → chosen — A.
  - `при равной надёжности — ближе к моменту`: B на 14.04 и B на 16.04 → 16.04.
  - `при равной надёжности и дате — свежее`: два B на 16.04, `updated` 2026-01 и 2026-05 → второй.
  - `закрепление побеждает правило`: pins[pinKey('strength','su_61a','1945-04-16')] → факт C → chosen C.
  - `закрепление на удалённый факт игнорируется`: pin на index 9 несуществующего факта → выбор по правилу, `pinMissing: true`.
  - `'none' — не брать ничего`: pin `'none'` → chosen null.
  - `расхождение`: personnel 6000 и 6400 (>5 %) → conflict true; 6000 и 6100 → false.
  - `parent действует с from`: parent su_8ga c 16.04 и su_5ua c 24.04, момент 25.04 → su_5ua; момент 20.04 → su_8ga.
- [ ] **Step 2:** `npx vitest run packages/knowledge/tests/resolve.test.ts` → FAIL (нет модуля).
- [ ] **Step 3:** реализовать `Claim`, `claimFacts`, `pinKey`, `resolve` по правилу из Global Constraints; дата факта — `at` / `from` / `to` (для losses — `to`); у `parent` / `crossing` — последний действующий (`from ≤ moment`) среди лучших по надёжности.
- [ ] **Step 4:** тест → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — «База знаний: формальная часть факта и выбор из нескольких».

### Task 2: формальные части в сиде встроенных операций

**Files:**
- Modify: `packages/knowledge/tools/build_seed.ts`
- Regenerate: `packages/knowledge/data/seed.json` (`npm run kb:seed`)
- Test: `packages/knowledge/tests/seed-claims.test.ts`

**Interfaces:**
- Consumes: `Claim` (Task 1).
- Produces: факты сида с `claim` (id записей не меняются):

| Источник (`docs/sources`) | Запись | claim |
|---|---|---|
| `berlin-1945-positions.json` `formations[].strength_16_04.{personnel,tanks,guns}` (+ `vistula-oder-1945.json` аналогично) | запись формирования | `strength` на дату начала операции, reliability источника |
| `formations[].parent`; `berlin-1945-divisions.json` `divisions[].subordination[]` (`date`, `army`/`corps`/`front`) | запись формирования | `parent` с `from` = дата строки (без даты — начало операции) |
| сценарии `packages/sim/data/scenarios/*.json` `formations[].enterAt` с `note`, ссылающимся на источник | запись формирования | `enter` |
| `positions[]` (`formation`, `time`, `at`, `approxKm`, `place`) и выписки ЦАМО (`*-tsamo*/positions.json`) | запись формирования | `position` |
| `*-boundaries.json` | записи обоих объединений | `boundary` |
| `berlin-1945-objects.json` (мосты, переправы с датами) | запись объекта | `crossing` |
| `berlin-1945-losses-daily.json`, `-tsamo.json` `records[]` (`kind: own_losses`, `period` или `date`, `values.{killed,wounded,missing}`) | запись формирования | `losses` (`from`/`to` = период или день) |
| `events` в `berlin-1945-positions.json` | запись операции | `event` |

`division-remnants-1945.json` — правила и текстовые примеры, `claim` не выпускает.

- [ ] **Step 1: Write the failing test** (`seed-claims.test.ts`, читает `data/seed.json`):
  - есть ≥ 1 `strength` на `1945-04-16` у `su_8ga` с reliability A или B;
  - у `su_12gsd` есть `parent` → `su_61a` (по `berlin-1945-divisions.json`);
  - число `losses` = числу записей `own_losses` в двух файлах потерь;
  - у каждого `claim.subject` формирования есть сценарная формация с этим id (Берлин или Висла — Одер) — иначе тест печатает список.
- [ ] **Step 2:** тест → FAIL.
- [ ] **Step 3:** в `build_seed.ts` — функции `strengthClaims`, `parentClaims`, `positionClaims`, `boundaryClaims`, `crossingClaims`, `lossesClaims`, `eventClaims`; каждая добавляет `claim` к факту, который сид и так пишет (или новый факт с тем же `key`, что пишет сейчас), чтобы текст фактов не менялся.
- [ ] **Step 4:** `npm run kb:seed`; тест → PASS; `npm test` (включая `seed-fresh`).
- [ ] **Step 5: Commit** — «База знаний: формальные части в сиде встроенных операций».

### Task 3: сборщик «база → модель»

**Files:**
- Create: `packages/knowledge/src/compile.ts`
- Modify: `packages/knowledge/src/index.ts`
- Test: `packages/knowledge/tests/compile.test.ts`

**Interfaces:**
- Consumes: `resolve`, `claimFacts`, `Pins` (Task 1).
- Produces:
  - `interface CompileInput { id: string; start: string; end: string; formations: { id: string; name: string; side: string; echelon: string; parent?: string | null; personnel?: number; tanks?: number; guns?: number; enterAt?: string | null }[]; divisions?: CompileInput['formations'] }` — сценарий (армии) и агентный (дивизии).
  - `interface Provenance { input: string /* 'su_61a.personnel', 'change:3', 'checkpoint:7', 'boundary:2' */; fact: FactRef | null /* null — допущение сценария */; reliability: 'A' | 'B' | 'C' | 'assumption' }`
  - `interface CompiledEdits { formations: Record<string, { personnel?: number; tanks?: number; guns?: number; parent?: string; enterAt?: string }>; changes: ScenarioChangeIn[]; checkpoints: CheckpointIn[]; positions: { formation: string; time: string; at?: [number, number]; place?: string; approxKm: number; reliability: string; source: string }[]; boundaries: unknown[]; crossings: unknown[]; events: unknown[] }`
  - `type ScenarioChangeIn = { at: string; formation: string; kind: 'reinforce'; personnel?: number; tanks?: number; guns?: number } | { at: string; formation: string; kind: 'resubordinate'; parent: string }`
  - `type CheckpointIn = { at: string; formation: string; kind: 'strength'; personnel?: number; tanks?: number; guns?: number } | { at: string; formation: string; kind: 'losses'; from: string; personnel: number /* killed+wounded+missing, накопленно с начала */; tanks?: number }`
  - `compileOperation(entries: Entry[], op: CompileInput, pins: Pins): { edits: CompiledEdits; provenance: Provenance[]; conflicts: { key: string; candidates: FactRef[]; chosen: FactRef | null }[]; unmatched: FactRef[] }`
- Правила: начальное — `strength` в ±2 сут. от `start` (window 2); `parent` с `from ≤ start` — в `formations`, с `from > start` — `resubordinate`; `reinforce` — `changes`; `strength` после начала — `checkpoints(kind:'strength')`; `losses` — накопительно по формированию с `start`: каждая точка — сумма всех `losses` с `to ≤` её `to`; положения, линии, переправы, события — как есть из выбранных фактов. Факт, `subject` которого нет ни в `formations`, ни в `divisions`, — в `unmatched`.

- [ ] **Step 1: Write the failing tests** (`compile.test.ts`):
  - синтетика: начальная численность из A, расхождение A/B → `conflicts.length === 1`, provenance `su_x.personnel` → A;
  - `parent` с `from` после начала → `changes[0].kind === 'resubordinate'`;
  - два `losses` (16.04: 100+300, 17.04: 50+150) → checkpoints `losses` 400 на 16.04 и 600 на 17.04;
  - факт о `su_nope` → `unmatched.length === 1`, исключения нет (Review Focus);
  - пустые факты → `edits` без формирований и изменений, все provenance — `assumption` (Review Focus);
  - **воспроизводимость**: сид (`data/seed.json`) + `packages/sim/data/scenarios/berlin-1945.json` → для каждого формирования, у которого в сценарии `note` ссылается на источник, `edits.formations[id].personnel` (если есть) совпадает со сценарием; расхождения тест печатает списком.
- [ ] **Step 2:** тесты → FAIL.
- [ ] **Step 3:** реализовать `compileOperation` по правилам выше.
- [ ] **Step 4:** тесты → PASS (при расхождении воспроизводимости — исправлять `claim` в сиде, Task 2, а не тест).
- [ ] **Step 5: Commit** — «База знаний: сборщик „база → модель“».

### Task 4: нынешняя модель — изменения по датам и контрольные точки

**Files:**
- Modify: `packages/sim/src/types.ts` (`ScenarioChange`, `Scenario.changes?`, журнал `reinforced` / `resubordinated` / `change-skipped`)
- Modify: `packages/sim/src/step.ts` (шаг 0, рядом с `detachFrom`)
- Modify: `packages/sim/src/history.ts` (`History.checkpoints?`, `compareStrength`)
- Modify: `packages/sim/src/calibrate.ts` (`evaluateRules`), `packages/sim/src/report.ts`, `packages/sim/src/index.ts`
- Test: `packages/sim/tests/changes.test.ts`, `packages/sim/tests/strength.test.ts`

**Interfaces:**
- Consumes: формы `ScenarioChangeIn`, `CheckpointIn` (Task 3) — в `packages/sim` объявить собственные `ScenarioChange` и `StrengthCheckpoint` той же формы (пакеты не зависят друг от друга).
- Produces:
  - `Scenario.changes?: ScenarioChange[]`, `History.checkpoints?: StrengthCheckpoint[]`;
  - `compareStrength(ctx: SimContext, run: RunResult, history: History, tol = 0.25): { n: number; within: number; medianRel: number; byFormation: { key: string; n: number; within: number }[] }` — относительная ошибка: strength — |расч − док| / док по personnel; losses — накопленные потери расчёта (начальные + пополнения − текущие) против документа;
  - `CalibScore.strength?: { n: number; within: number }`; `total` при `n ≥ 10` в обучающей половине: `total × 0.75 + (1 − within) × 50 × 0.25` (масштаб км нынешнего мерила).
- Исполнение в `step.ts`: изменение с `at ≤ now`, ещё не исполненное (множество id в состоянии `GameState`/`SimState.done`); `reinforce` — к текущим и к `initial`; если формирование ещё не введено (`enterAt > now`) — откладывается до ввода (Review Focus); `resubordinate` — только если `parent` есть среди формирований, не сам и не потомок, иначе журнал `change-skipped` с причиной (Review Focus).

- [ ] **Step 1: Write the failing tests:**
  - `changes.test.ts`: сценарий Берлина (`loadContext`) + `reinforce` su_8ga +5000 на 18.04 → после хода 18.04 personnel больше, чем в прогоне без изменения, ровно на 5000 за вычетом потерь того же хода (сравнить с прогоном того же seed без изменения: разница в начале шага = 5000); `resubordinate` su_8ga → su_1uf на 20.04 → `parent` после 20.04; на несуществующий штаб → `change-skipped` в журнале, `parent` прежний; пополнение до ввода резерва → прибавлено при вводе.
  - `strength.test.ts`: искусственная история с 12 точками, где расчёт ровно на документе → `within === 1`; точки ×2 → `within === 0`; `evaluateRules` с ≥ 10 точками → `score.strength.n ≥ 10` и `total` отличается от прогона без точек.
- [ ] **Step 2:** `npx vitest run packages/sim/tests/changes.test.ts packages/sim/tests/strength.test.ts` → FAIL.
- [ ] **Step 3:** реализовать; в `report.ts` — раздел «Численность и потери против документов» (n, доля в ±25 %, медиана, худшие 10 формирований).
- [ ] **Step 4:** тесты → PASS; `npm test` (прежние результаты без `changes` и `checkpoints` не меняются).
- [ ] **Step 5: Commit** — «Модель: пополнения и переподчинение по датам, сверка численности и потерь».

### Task 5: агентная модель (ядро) — поправки, изменения, состояние при передаче

**Files:**
- Modify: `crates/agents-core/src/scenario.rs` (`EditsIn`, `load_with(..., edits: Option<&EditsIn>)`)
- Modify: `crates/agents-core/src/world.rs` (`Sim.changes`, исполнение в `step` рядом с вводом `Pending`)
- Modify: `crates/agents-core/src/game.rs` (`Game::start_free(..., takeover_state: Option<&TakeoverIn>)`)
- Modify: `crates/agents-tauri/src/lib.rs` (`run_scenario`, `game_start`: параметр `edits: Option<serde_json::Value>`, `game_start` — ещё `takeover_state`), `crates/agents-core/src/bin/agents-game.rs` (то же в командах JSON)
- Test: тесты в `scenario.rs` / `game.rs` (`#[cfg(test)]`, синтетический сценарий как в `world.rs`)

**Interfaces:**
- Produces (JSON, имена полей — camelCase через serde):
  - `EditsIn { divisions: HashMap<String, DivEdit>, changes: Vec<ChangeIn> }`; `DivEdit { personnel?, tanks?, guns?, hq?: String, enterAt?: String }`; `ChangeIn { at: String, formation: String, kind: "reinforce"|"resubordinate", personnel?, tanks?, guns?, parent?: String }` — `formation` может быть id дивизии или штаба (для штаба `resubordinate` меняет `Hq.parent`).
  - `TakeoverIn { divisions: HashMap<String, { personnel?, tanks?, guns?, pos?: [f64;2], hq?: String }> }`.
  - Журнал: «пополнение +N», «переподчинение → X», «изменение пропущено: …».

- [ ] **Step 1: Write the failing tests:** `edits_apply_initial` (personnel и hq дивизии из `EditsIn`); `change_reinforce_at_hour` (на часе `at` personnel дивизии +N, `strength0` пересчитан); `change_resubordinate_bad` (неизвестный штаб → событие «изменение пропущено», hq прежний — Review Focus); `takeover_state_sets` (после `start_free` с `TakeoverIn` personnel и pos дивизии — из входа).
- [ ] **Step 2:** `cargo test -p agents-core` → FAIL.
- [ ] **Step 3:** реализовать; `load_with` без `edits` ведёт себя как сейчас.
- [ ] **Step 4:** `cargo test -p agents-core` → PASS; `cargo build -p agents-tauri`.
- [ ] **Step 5: Commit** — «Ядро: поправки сценария, пополнения и переподчинение по часам, состояние при передаче».

### Task 6: оценка агентной модели с контрольными точками

**Files:**
- Modify: `packages/sim/src/agents-score.ts`, `packages/sim/src/agents.ts` (`agentsHistory` переносит `checkpoints`)
- Modify: `apps/editor/src/sim/agent-scenarios.ts` (`AgentRunOptions.edits?`, передача в `run_scenario`)
- Test: `packages/sim/tests/agents-score.test.ts` (дополнить)

**Interfaces:**
- Consumes: `compareStrength` (Task 4), `EditsIn` (Task 5).
- Produces: `AgentsScore.strength?: { n: number; within: number }`; `score` при `n ≥ 10`: `(within + eventsHit/eventsTotal)/2 × 0.75 + strength.within × 0.25`.

- [ ] **Step 1:** тест: трасса с 10 точками на документе → `strength.within === 1`, `score` выше, чем у той же трассы с точками ×2.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать. **Step 4:** → PASS. **Step 5: Commit** — «Агентная модель: сверка численности и потерь в оценке».

### Task 7: редактор — сборка поправок из базы, закрепления, журнал

**Files:**
- Modify: `apps/editor/src/kb/store.ts` (хранилище `pins`, версия БД +1), `apps/editor/src/kb/kb.ts` (`getPins`, `setPin`, выгрузка/загрузка с закреплениями; событие `def_ops.kb-changed` после любой записи)
- Create: `apps/editor/src/sim/kb-compile.ts`
- Modify: `apps/editor/src/sim/userdata.ts` (`OperationEdits.compiled?: CompiledEdits`, наложение `formations.parent/enterAt`, `Scenario.changes`, `History.checkpoints`, `events`; `ChangeLog.kind` + `'kb'`)
- Modify: `apps/editor/src/modeling/sync.ts` (ручное «принять» и `dismissed` → закрепления)
- Modify: `vitest.config.ts` — `include` дополнить `'apps/*/tests/**/*.test.ts'`
- Test: `apps/editor/tests/kb-compile.test.ts` (vitest, без браузера: функции над массивами)

**Interfaces:**
- Consumes: `compileOperation`, `Pins` (Tasks 1, 3).
- Produces:
  - `recompile(opId: string): Promise<{ changed: string[] }>` — читает записи базы и закрепления, сценарий и агентный сценарий операции, пишет `edits.compiled`; если выход изменился — `logChange(opId, 'kb', 'изменено из базы: …')`;
  - `diffCompiled(a: CompiledEdits | undefined, b: CompiledEdits): string[]` — человекочитаемый перечень изменённых входов (чистая, тестируется);
  - подписка: на `def_ops.kb-changed` — `recompile` всех операций (встроенных и своих) с задержкой 1 с;
  - `getData` накладывает `compiled` после нынешних ручных правок; ручные правки численности, ставшие закреплениями, из `formations` убираются (миграция при первой сборке).

- [ ] **Step 1:** тесты `diffCompiled` (новое пополнение → «пополнение su_8ga 18.04 +5000»; смена начальной численности → «su_61a: людей 54000 → 52000»); наложение `compiled` на сценарий (`applyCompiled(sc, compiled)` — чистая функция в `kb-compile.ts`).
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать. **Step 4:** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — «Редактор: поправки операции собираются из базы знаний».

### Task 8: принятие командования по фактам (обе модели)

**Files:**
- Modify: `packages/sim/src/game.ts` (`startGame(..., takeoverState?: TakeoverState)`)
- Create: `apps/editor/src/sim/takeover-state.ts`
- Modify: `apps/editor/src/sim/game-worker.ts` (передача состояния в `startGame` и в `game_start`), `apps/editor/src/CommandView.tsx` (`TakeoverDialog` — сводка)
- Test: `packages/sim/tests/takeover-state.test.ts`, `apps/editor/tests/takeover-state.test.ts`

**Interfaces:**
- Consumes: `resolve` (Task 1), `TakeoverIn` (Task 5).
- Produces:
  - `type TakeoverState = Record<string, { personnel?: number; tanks?: number; guns?: number; position?: [number, number]; parent?: string }>` (`packages/sim`);
  - `takeoverState(entries: Entry[], pins: Pins, ids: { id: string; echelon: string }[], moment: string): { state: TakeoverState; summary: { strength: number; position: number; parent: number; assumed: number } }` — правила из Global Constraints (не старше суток; допуск ступени).
- [ ] **Step 1:** тесты: факт численности 16.04 при передаче 17.04 12:00 → не берётся (старше суток); положение армии с неопределённостью 20 км → не берётся; дивизия 4 км → берётся; `startGame` с состоянием → у формирования personnel и position из состояния.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать; в `TakeoverDialog` строка «по фактам поправлено N соединений (численность X, положение Y, подчинённость Z); на допущениях — M» и ссылка на «Основу модели». **Step 4:** → PASS.
- [ ] **Step 5: Commit** — «Принятие командования: состояние соединений по фактам базы».

### Task 9: вкладка «Основа модели» и факты в записи базы

**Files:**
- Create: `apps/editor/src/modeling/BasisTab.tsx`
- Modify: `apps/editor/src/modeling/OperationsTab.tsx` (вкладка в карточке операции), `apps/editor/src/KnowledgeView.tsx` (таблица формальных фактов с пометкой использования), `apps/editor/src/styles.css`
- Test: `apps/editor/tests/basis.test.ts` (`basisSummary` — чистая функция)

**Interfaces:**
- Consumes: `CompiledEdits`, `Provenance`, `conflicts`, `unmatched` (Task 3), `setPin` (Task 7).
- Produces: `basisSummary(prov: Provenance[]): Record<'strength' | 'parent' | 'position' | 'boundary' | 'crossing', { A: number; B: number; C: number; assumption: number }>`; `factUse(entryId: string, index: number, compiled: { provenance: Provenance[]; conflicts: …[] }): 'used' | { overriddenBy: FactRef } | 'unused'`.
- Разделы вкладки: «Формирования» (дерево по подчинённости, значки A/B/C/допущение, щелчок — источник, страницы, цитата, переход к записи), «Расхождения» (кандидаты, «закрепить этот» / «снять»), «Не сопоставлено», «Итог» (`basisSummary` полосами по видам).
- [ ] **Step 1:** тест `basisSummary` на синтетическом provenance. **Step 2:** → FAIL. **Step 3:** реализовать функции и интерфейс. **Step 4:** → PASS; ручная проверка в браузере (Playwright, 1440×900): вкладка Берлинской операции, расхождение, закрепление → число в модели меняется, в журнале операции запись `kb`.
- [ ] **Step 5: Commit** — «Моделирование: вкладка „Основа модели“».

### Task 10: прогон, описание, снимки

**Files:**
- Modify: `docs/system.md` (часть I: «Основа модели», принятие командования по фактам, закрепления; часть II: формальные факты, сборщик, изменения по датам, сверка численности и потерь, мерило калибровки), `docs/img/*.jpg` (новые: `modeling-basis.jpg`, `modeling-basis-conflicts.jpg`, `game-takeover-facts.jpg`), `packages/knowledge/data/seed.json`, `docs/system.pdf`, `docs/system.docx`, при новом правиле — строка в `packages/sim/data/rules/norms.json` (допуск ±25 % — допущение без опоры) и `npm run sim:norms -- --doc docs/norms-check.md`.
- [ ] **Step 1:** `npm run sim:demo` (и прогон агентной модели Берлина через стенд) до и после — цифры положений, событий и новой доли численности в описание (раздел «Результаты»).
- [ ] **Step 2:** снимки (Playwright, 1440×900, JPEG) с подписями курсивом по видимому.
- [ ] **Step 3:** `npm run kb:seed`, `npm run typecheck`, `npm test`, `cargo test -p agents-core`, `npm run docs:system`.
- [ ] **Step 4: Commit and push** — «База знаний ↔ моделирование, часть 1: описание, снимки, результаты».
