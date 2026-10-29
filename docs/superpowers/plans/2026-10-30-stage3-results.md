# Этап 3. Итоги и разбор — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ядро считает потери по часам (по дивизиям, без пополнений); вкладка «Итоги» в «Переигровке» и в игре показывает потери сторон рядом с историческими, таблицу «ваша игра / история / переигровка без вмешательства» и разбор каждого хода по ключевым событиям с картой и выбором «разобрать с позиции …».

**Architecture:** Ядро ведёт нарастающие счётчики выбывших (люди, танки, орудия), пленных и пополнений в `Vars` и пишет их в кадр хода (`trace::FIELDS`); отпечатки мира не меняются, потому что счётчики не входят в `digest` и не влияют на расчёт. Всё остальное — чистые функции `packages/sim` над ходом ядра (`AgentTrace`): ряды потерь, сводка операции (события — через ту же функцию, что у мерила сходства), ключевые события хода. Их зовут фоновые потоки: переигровки (`sim/worker.ts`, итог к `SimResult`) и игры (`sim/game-worker.ts`, итог к `TurnView`). Окно показывает их во вкладке «Итоги». «Без вмешательства» — прогон «Истории как замысла» того же сценария и seed, его сводка кэшируется по сценарию, seed и правкам базы.

**Tech Stack:** Rust (agents-core), TypeScript (packages/sim, apps/editor на React), vitest, cargo test, Playwright (снимки через `scripts/agents-bridge.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-30-command-pack-design.md`, раздел «Этап 3. Итоги и разбор» (пункты 3а, 5, 14) и «Проверка».

## Global Constraints

- Язык интерфейса, описания, коммитов — русский; в описании нет дат, упоминаний ассистента и служебных названий веток.
- Прежние режимы модели — прежние отпечатки `SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST`: этап модель не меняет, счётчики потерь в `World::digest`/`Sim::digest` не входят.
- Каждая доработка интерфейса проверяется живым снимком через мост разработки (`scripts/agents-bridge.mjs`); снимки — Playwright, окно 1440×900, JPEG; подписи — то, что действительно видно.
- Правила `CLAUDE.md`: правка `packages/sim/src` или `crates/agents-core/src` → `npm run model:index` в том же коммите (тест сверяет выжимку с исходниками); правка части II описания → `npm run kb:seed`; правка `docs/system.md` → `npm run docs:system` (`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), `docs/system.pdf` и `docs/system.docx` в тот же коммит. Числа в описании — из свежего прогона, не по памяти.
- Проверки — только итог: `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `cargo test -p agents-core 2>&1 | grep "test result"`; во время работы — точечно (`npx vitest run <файл>`, `cargo test -p agents-core --test <имя>`); полный `npm test` — один раз перед коммитом.
- Исторические потери — только числа из базы знаний с источником и надёжностью (`seed.json`); где их нет — так и написать, ничего не придумывать.
- Проверка этапа (спецификация): на Берлинской «переигровка без вмешательства» против истории даёт те же события и те же сроки, что мерило сходства (`agentsScore`).
- Разбор хода строится по данным хода без языковой модели; модель на связи — дополнительно её связный текст по тем же фактам, с пометкой.
- Ветка `claude/desktop-app`; в main — только по просьбе пользователя.

## Review Focus

1. **Ход без ключевых событий** (оборона на месте, ночь, первый ход после передачи командования): разбор не пустой и не падает — «за ход ключевых событий нет», продвижение и потери хода одной строкой, на карте ни одной метки; голосовой разбор хода — без шагов-событий. Тесты — задача 4 `quiet turn`, задача 5 `debrief quiet`.
2. **Штаб разгромлен или снят** (все дивизии рассеяны, сведены; вмешательство `remove` переводит дивизии в «не введена»): он остаётся в выборе «с позиции …» с пометкой «снят с операции» или «разгромлен», оценка — «войск в строю нет»; дивизии снятой армии не считаются ни потерями, ни «в строю». Тесты — задача 2 `removed army is not a loss`, задача 4 `perspective of removed hq`.
3. **Переигровка и игра берут данные по-разному**: в переигровке сводка — по всему ходу; в игре — только по сыгранным часам (с часами до передачи командования), события впереди — «ещё не наступило», а не «не случилось»; окно разбора хода — из хода ядра (`frames.length − 1 − turnHours`, не раньше `game.takeover`), так что продолженная игра даёт тот же разбор, что непрерывная. Тесты — задача 3 `summary up to hour`, задача 4 `window from game trace`.
4. **Старые ходы без полей потерь** (сохранённые переигровки и игры до задачи 1): итоги считаются оценкой по убыли численности с пояснением «пополнения и передачи не различаются», без падения; у сохранённой переигровки без `operation` сводка пересчитывается из сохранённого хода. Тесты — задача 2 `old trace estimate`, задача 3 `saved replay without operation`.
5. **Игрок за немецкую сторону**: оценки цветом и словами обращены (позднее советское событие и меньшее удаление советских фронтов от Берлина — «лучше» для немцев только наоборот), исторические немецкие потери — с пометкой «по советскому донесению», разбор — с позиции немецких штабов, советские войска вне разведки не показываются. Тесты — задача 3 `compare rows for de`, задача 4 `de side events and fog`.

---

### Task 1: Ядро — потери по часам

**Files:**
- Modify: `crates/agents-core/src/model.rs` (`Vars`), `crates/agents-core/src/world.rs` (`lose`, `apply_changes` — пополнение, `apply_remnants` — сведение остатков, переход в «рассеяна» в `apply`), `crates/agents-core/src/pocket.rs` (вынос техники при прорыве, капитуляция), `crates/agents-core/src/trace.rs` (`FIELDS`, `frame`), `packages/sim/src/agents.ts` (`agentsStateAt` — потери в состоянии игры), `packages/sim/src/types.ts` (`Formation.losses?`)
- Test: `crates/agents-core/tests/losses.rs` (новый), `packages/sim/tests/agents.test.ts`

**Interfaces:**
- Produces:
  - `Vars.lost: [f64; 3]` — выбывшие нарастающим итогом: люди (убитые, раненые, пленные, рассеянные), танки, орудия; `#[serde(default)]`.
  - `Vars.captured: f64` — из них пленные (капитуляция в котле); `#[serde(default)]`.
  - `Vars.reinforced: [f64; 3]` — пополнения по датам нарастающим итогом (люди, танки, орудия); `#[serde(default)]`. Остатки, принятые от сведённой дивизии, — не пополнение (передача внутри стороны).
  - `trace::FIELDS: [&str; 16]` — прежние 11 и в конце `"lost", "lostTanks", "lostGuns", "captured", "reinforced"` (люди пополнений); в кадре — `round()`.
  - `Formation.losses?: { personnel: number; tanks: number; guns: number }` — заполняет `agentsStateAt`, если в `t.fields` есть `lost`.
- Правила учёта (где ставится счётчик):
  - `lose(d, frac, …)` — `lost[i] += до − после` по каждому из трёх (бой, соприкосновение, артподготовка, прорыв из котла идут через неё).
  - сведение немецких остатков (`apply_remnants`): у сведённой `lost += (personnel − p, tanks − t, guns − g)` до обнуления; принявшая получает `p, t, g` без счётчика.
  - «рассеяна» (численность меньше `destroyed_personnel`): `lost += (personnel, tanks, guns)` оставшихся; переменные не обнуляются (отпечаток прежний).
  - капитуляция (`pocket.rs`): `lost += оставшиеся`, `captured += personnel`.
  - вынос техники при прорыве (`breakout_keep`): `lost[1], lost[2] += сброшенное`.
  - пополнение (`ChangeKind::Reinforce`): `reinforced += (p, t, g)`.
  - факт состояния при передаче командования (`game.rs`, `takeover_state`) счётчики не трогает: это поправка, а не потери.

- [ ] **Step 1: Падающие тесты** (`tests/losses.rs`):
  - `balance_berlin_48h` — Берлинская (`scenario::load` как в `tests/core.rs`), 48 шагов; по каждой стороне и по каждому из трёх: `Σ(не Destroyed и не Merged) vars + Σ lost == Σ vars на шаге 0 + Σ reinforced` с точностью `1e-6 × Σ на шаге 0`; `Σ lost[0] > 0` у обеих сторон.
  - `merge_remainder_is_loss` — Зееловская, как `remnants_withdraw_and_merge` (`personnel = 0.2 × p0`): на шаге, когда дивизия стала `Merged`, её `lost[0]` выросло на `personnel_до − p` (принятое по журналу «приняла остатки … N человек»), у принявшей `lost` и `reinforced` не изменились.
  - `reinforce_counts_separately` — правка `{"changes":[{"at":"1945-04-16T08:00","formation":<советская дивизия Берлинской>,"kind":"reinforce","personnel":1000,"guns":20}]}` (через `scenario::load` с правками, как в `scenario.rs::change_reinforce_at_hour`): после шага 4 `reinforced == [1000, 0, 20]`, `lost` не уменьшился.
  - `frame_has_loss_fields` — `trace::FIELDS.len() == 16`, последние пять — как в Interfaces; длина строки `frame(&sim)` — 16.
  - `digest_unchanged` — не новый тест: `cargo test -p agents-core --test command` — `SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST` прежние.
  - `packages/sim/tests/agents.test.ts`, `agentsStateAt carries losses`: ход из двух дивизий с 16 полями (`lost` = 500 на часе 3) → `formations[0].losses.personnel === 500`; ход с 11 полями → `losses` нет.
- [ ] **Step 2:** `cargo test -p agents-core --test losses 2>&1 | tail -5` — не компилируется (нет полей); `npx vitest run packages/sim/tests/agents.test.ts` — FAIL `losses`.
- [ ] **Step 3:** Поля `Vars`, счётчики в местах из Interfaces, `FIELDS` и `frame`; `agentsStateAt` — по индексам `F('lost')` и т. д., при `-1` поле не ставится.
- [ ] **Step 4:** `cargo test -p agents-core 2>&1 | grep "test result"` — всё зелёное, отпечатки прежние; `npx vitest run packages/sim/tests/agents.test.ts packages/sim/tests/agents-score.test.ts` — PASS.
- [ ] **Step 5:** Описание: часть II — новый раздел «19.15. Потери по часам» (что считается выбывшими, пленные, пополнения отдельно, передача остатков — не потери, факт при передаче командования — не потери); проверить ссылки на 19.x. `npm run kb:seed`, `npm run model:index`, `npm run docs:system`; `npm run typecheck`, `npm test`; коммит `feat(итоги): ядро считает потери по часам — выбывшие, пленные, пополнения`.

### Task 2: Потери сторон — ряды, исторические потери, вкладка «Итоги»

**Files:**
- Create: `packages/sim/src/results.ts`, `apps/editor/src/results-view.ts`, `apps/editor/src/ResultsTab.tsx`, `apps/editor/src/ResultsCharts.tsx`, `apps/editor/src/voice/actions/results.ts`
- Modify: `packages/sim/src/agents.ts` (`AgentHistory.losses?`, `AgentHistory.operationLosses?`), `packages/sim/src/index.ts` (экспорт), `packages/sim/data/scenarios/agents/berlin-1945.history.json` (поле `operationLosses`), `packages/sim/tools/agents/build-berlin.ts` (то же поле при сборке), `apps/editor/src/sim/protocol.ts` и `apps/editor/src/sim/worker.ts` (`SimResult.operation`), `apps/editor/src/sim/game-protocol.ts` и `apps/editor/src/sim/game-worker.ts` (`TurnView.results`), `apps/editor/src/ReplayView.tsx` (вкладка «Итоги» в боковой панели), `apps/editor/src/CommandView.tsx` (вкладка `results`), `apps/editor/src/voice/actions/command.ts` (`CmdTab`, `TAB_TITLE`, `TAB_STEMS`), `apps/editor/src/styles.css`, `apps/editor/tests/voice-completeness.test.ts` (`FILES`: `ResultsTab.tsx`)
- Test: `packages/sim/tests/results.test.ts` (новый), `apps/editor/tests/results-view.test.ts` (новый)

**Interfaces:**
- Consumes: поля кадра задачи 1.
- Produces (`packages/sim/src/results.ts`):
  - `export const LOSS_FIELDS = ['lost', 'lostTanks', 'lostGuns', 'captured', 'reinforced'] as const;`
  - `export interface Loss { personnel: number; tanks: number; guns: number }`
  - `export function hasLosses(t: AgentTrace): boolean` — все `LOSS_FIELDS` есть в `t.fields`.
  - `export function divisionLoss(t: AgentTrace, k: number, h: number): Loss & { captured: number; reinforced: number }` — нарастающий итог дивизии `k` к часу `h`; без полей — оценка: сумма часовых убылей `max(0, prev − cur)` людей, танков, орудий, пока дивизия не «не введена»; `captured = reinforced = 0`.
  - `export interface LossRow { id: string; name: string; side: 'su' | 'de'; echelon: 'side' | 'front' | 'army'; parent: string | null; total: Loss; captured: number; reinforced: number; byDay: Loss[] }`
  - `export interface LossSeries { exact: boolean; upTo: number; days: string[]; rows: LossRow[] }` — `days[i] = addHours(t.start, 24 i).slice(0, 10)`, сутки `i` — часы `(24 i, min(24 (i+1), upTo)]`; строки: две стороны (`id` = `'su'`/`'de'`), фронты (группы армий), армии; дивизия — в армию-предка по `parent` (корпус → армия), без армии — во фронт, без фронта — только в сторону.
  - `export function lossSeries(t: AgentTrace, upTo = t.frames.length - 1): LossSeries`
  - `export interface HistoricalLoss { scope: string /* 'su' | 'de' | id штаба */; from?: string; to: string; irrecoverable?: number; sanitary?: number; total?: number; killed?: number; captured?: number; tanks?: number; guns?: number; perDay?: number; source: string; reliability: 'A' | 'B' | 'C'; kb?: string; note?: string }`
  - `export function historicalLosses(h: AgentHistory): HistoricalLoss[]` — `h.operationLosses` как есть и `h.losses` (`{ formation, until, value, source, reliability }` → `{ scope: formation, to: until, total: value, source, reliability }`).
  - `export interface OperationSummary { version: 1; scenario: string; seed: number; start: string; upTo: number; over: boolean; losses: LossSeries; history: { losses: HistoricalLoss[] } }` и `export function operationSummary(base: SimContext, t: AgentTrace, h: AgentHistory, baseHistory: History | null, o: { upTo?: number; over?: boolean } = {}): OperationSummary` — здесь только потери; задача 3 дописывает в тип и в функцию `events`, `distance`, `sides` (подпись функции не меняется).
- Данные `operationLosses` (Берлинская; числа — из `seed.json`, не править на память):
  - `{ scope: 'su', from: '1945-04-16', to: '1945-05-08', irrecoverable: 78291, sanitary: 274184, total: 352475, perDay: 15325, source: 'Кривошеев 2001, гл. V', reliability: 'A', kb: 'op:berlin' }`
  - `{ scope: 'su', from: '1945-04-16', to: '1945-05-08', tanks: 1997, guns: 2108, source: 'Кривошеев 1993, с. 220 (по статье «Штурм Берлина»)', reliability: 'C', kb: 'battle:berlin-storm' }`
  - `su_1bf` 37610 / 141880 / 179490, `su_1uf` 27580 / 86245 / 113825, `su_2bf` 13070 / 46040 / 59110 (`irrecoverable / sanitary / total`, те же `from/to/source/reliability/kb`, что у первой строки)
  - `{ scope: 'de', from: '1945-04-16', to: '1945-05-09', killed: 218691, captured: 250534, tanks: 1030, source: 'справка из ЖБД 1 БФ о потерях противника (док. № 91)', reliability: 'A', kb: 'f:su_1bf', note: 'по советскому донесению, только полоса 1 БФ' }`
  - Висло-Одерская: поля нет — в базе знаний потерь этой операции нет.
  - В файл истории поле вносится правкой (сборка `agents:berlin-data` требует переписи); `build-berlin.ts` пишет то же поле из той же таблицы, чтобы следующая сборка его не потеряла.
- Produces (окно):
  - `SimResult.operation?: OperationSummary` (переигровка) и `TurnView.results?: OperationSummary` (игра, только агентная модель).
  - `apps/editor/src/results-view.ts`: `export type ResultsPart = 'turn' | 'losses' | 'compare'`; `export type BaselineState = { state: 'off' } | { state: 'wait' } | { state: 'ready'; summary: OperationSummary } | { state: 'error'; text: string }`; `export function lossesNote(s: OperationSummary): string[]` — пояснения части «Потери» (оценка для старого хода; нет исторических).
  - `ResultsTab.tsx`: `export function ResultsTab(p: { summary: OperationSummary | null; baseline: BaselineState; side: 'su' | 'de'; part: ResultsPart; parts: ResultsPart[]; turn?: ReactNode })` — переключатель частей — `ActButton action="results.show" params={{ part }}`; в этой задаче `baseline` всегда `{ state: 'off' }`.
  - `apps/editor/src/voice/actions/results.ts`: `export interface ResultsDeps { section(): 'replay' | 'command' | null; summary(): OperationSummary | null; side(): 'su' | 'de'; setPart(p: ResultsPart): void }` (задачи 5 и 6 дополняют) и `export function resultsActions(get: () => ResultsDeps): Action[]` с действием `results.show` `{ part }` — открывает вкладку «Итоги» (в игре — `setTab('results')`, в переигровке — вкладка боковой панели) и часть; в переигровке `part 'turn'` недоступно: «разбор хода — в игре». Регистрируют `ReplayView` и `CommandView` (как `replayActions` / `turnActions`).
  - `export function LossChart(p: { s: LossSeries; side: 'su' | 'de' }): JSX.Element` (`ResultsCharts.tsx`) — по суткам столбцы людей своей стороны и линия противника, оформление как у `RivalryChart` (классы `cm-chart`, ось — даты через сутки, `niceStep`).
  - `CmdTab` + `'results'`, `TAB_TITLE.results = 'Итоги'`, `TAB_STEMS` + `['итог', 'results']`.
  - Переигровка: вкладка боковой панели `'results'` («Итоги») рядом с «Расчёт» и «Сохранённые» — только у агентного расчёта; части `losses`, `compare`.
- Вид части «Потери»: две карточки сторон (всего выбыло людей, из них пленных; танков; орудий; пополнено людей), `LossChart`, таблица «по фронтам и армиям» (фронт раскрывает армии; столбцы — люди, танки, орудия, «в сутки»; рядом — исторические по этому штабу, если есть: число, период, источник, надёжность), блок «История операции» — строки `historicalLosses` по сторонам и фронтам с периодом и источником и строка «расчёт за N сут — в сутки M; история — в сутки K» (сравнение среднесуточно: периоды разные). Нет исторических — «Исторических потерь этой операции в базе знаний нет». `exact === false` — пометка «оценка по убыли численности: ход записан до учёта потерь — пополнения и передачи не различаются».

- [ ] **Step 1: Падающие тесты** (`packages/sim/tests/results.test.ts`, ход-заготовка как в `agents-score.test.ts`, 16 полей, 3 дивизии: `su_x` под `su_8gva` (армия) → `su_1bf` (фронт), `su_y` под `su_1bf` напрямую, `de_z` под `de_9a`; 49 кадров):
  - `lossSeries totals and days` — у `su_x` `lost` растёт на 100 в час, у `de_z` на 50: `rows.find(id 'su').total.personnel === 4800`, `byDay.length === 2`, `byDay[0].personnel === 2400`, `days[0] === '1945-04-16'`; строка `su_8gva` (`echelon 'army'`, `parent 'su_1bf'`) — 4800; `su_y` — только во фронте.
  - `reinforcement is not netted` — `su_x` пополнена на 1000 на часе 10 (`reinforced` 1000, численность выросла): потери прежние, `reinforced === 1000`.
  - `old trace estimate` (Review Focus 4) — те же кадры с 11 полями, численность падает на 100 в час и на часе 10 растёт на 1000: `exact === false`, потери людей `su_x` — сумма убылей (4700), не «начало − конец».
  - `removed army is not a loss` (Review Focus 2) — дивизия переходит в «не введена в операцию» на часе 20 (вмешательство `remove`): её `lost` не растёт, потери стороны не меняются.
  - `historicalLosses` — заготовка `AgentHistory` с `losses` и `operationLosses` → по строке на каждую, `scope`/`to`/`total` перенесены.
  - `operationLosses come from the knowledge base` — для каждой строки `operationLosses` в `berlin-1945.history.json` каждое число (без пробелов) встречается в тексте факта `losses` записи `kb` в `packages/knowledge/data/seed.json` (текст без пробелов и неразрывных пробелов).
  - `apps/editor/tests/results-view.test.ts`, `losses part texts` — `lossesNote(s)`: `exact false` → пометка об оценке; нет исторических → «Исторических потерь этой операции в базе знаний нет».
  - `apps/editor/tests/voice-results.test.ts` (новый), `results.show` — в игре открывает вкладку `results` и часть `compare`; в переигровке `part 'turn'` недоступно с текстом «разбор хода — в игре».
- [ ] **Step 2:** `npx vitest run packages/sim/tests/results.test.ts apps/editor/tests/results-view.test.ts` — FAIL (нет модуля).
- [ ] **Step 3:** `results.ts` (ряды, исторические), данные `operationLosses`, `build-berlin.ts`; фоновые потоки кладут `operationSummary(...)` в `SimResult.operation` (переигровка, после `checkEvents` в `agents()`) и `TurnView.results` (игра, `postView`, только `agents`, `upTo` — последний кадр; сырая история — сохранить при старте в `agentRawHistory` рядом со строкой 184); `ResultsTab` с частью «Потери», `LossChart`, вкладки в обоих окнах. Нынешняя модель (не агентная): вкладка «Итоги» есть, в ней — «Итоги и разбор — на агентной модели». Обработчики в командовании — через `act`/`ActButton` (`command.tab` с `tab: 'results'`, `results.show`); кнопка вкладки «Итоги» в боковой панели переигровки — как соседние «Расчёт» и «Сохранённые» (вне `voice-entry`), голосом — `results.show`.
- [ ] **Step 4:** Тесты зелёные; `npx vitest run apps/editor/tests/voice-completeness.test.ts` — PASS.
- [ ] **Step 5:** Живая проверка через мост: Берлинская, агентная, «История как замысел», seed 1 → вкладка «Итоги» → «Потери»; затем «Принять командование», ход → «Итоги». Снимки `evals-out/ui/results-losses-replay.jpg`, `evals-out/ui/results-losses-game.jpg` (1440×900, JPEG) — посмотреть самому: числа не налезают, график и таблица в панели без прокрутки вбок.
- [ ] **Step 6:** Описание: часть I, раздел 6 — абзац «**Итоги: потери сторон.**» (где вкладка, что в ней, сравнение среднесуточно, источники, оценка для старых записей); снимок `docs/img/replay-results-losses.jpg` с подписью курсивом. `npm run model:index`, `npm run docs:system`, `npm run typecheck`, `npm test`; коммит `feat(итоги): потери сторон по суткам, фронтам и армиям рядом с историческими`.

### Task 3: Сравнение с историей и с переигровкой без вмешательства

**Files:**
- Modify: `packages/sim/src/agents-score.ts` (`agentsEvents`, `SCORE_STEP_HOURS`), `packages/sim/src/results.ts` (`distanceSeries`, `operationSummary`), `packages/sim/src/index.ts`, `apps/editor/src/sim/protocol.ts` (`SimRequest.summaryOnly`, ответ `summary`), `apps/editor/src/sim/worker.ts`, `apps/editor/src/sim/game-worker.ts`, `apps/editor/src/results-view.ts`, `apps/editor/src/ResultsTab.tsx` (часть «Сравнение»), `apps/editor/src/ResultsCharts.tsx` (`DistanceChart`), `apps/editor/src/ReplayView.tsx` (сводка сохранённой переигровки без `operation`, запоминание базовой), `apps/editor/src/CommandView.tsx`, `apps/editor/src/commander-view.ts` (`OBJECTIVE_AT.berlin.at` — из `OBJECTIVE`)
- Create: `apps/editor/src/sim/baseline.ts`, `packages/sim/tools/agents/compare.ts`
- Test: `packages/sim/tests/results.test.ts`, `packages/sim/tests/agents-score.test.ts`, `apps/editor/tests/results-view.test.ts`, `apps/editor/tests/baseline.test.ts` (новый)

**Interfaces:**
- Consumes: `lossSeries`, `historicalLosses`, `OperationSummary` (задача 2).
- Produces (`packages/sim`):
  - `export const SCORE_STEP_HOURS = 6;` и `export function agentsEvents(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null, stepHours = SCORE_STEP_HOURS): EventResult[]` — `agentsToRun` + `agentsHistory` + `checkEvents`; `agentsScore` берёт события из неё (одно определение событий на мерило и сравнение).
  - `export const OBJECTIVE: LngLat = [13.3777, 52.5186];` — центр Берлина (как `OBJECTIVE_AT.berlin`).
  - `export interface DistanceRow { hq: string; name: string; game: (number | null)[]; history: (number | null)[] }` и `export function distanceSeries(t: AgentTrace, h: AgentHistory, upTo = t.frames.length - 1, objective = OBJECTIVE): { days: string[]; rows: DistanceRow[] }` — по советским фронтам; `game[i]` — расстояние, км (одна цифра после запятой), от центра живых дивизий фронта на часе `min(24 i, upTo)` до объекта, `null` — дивизий нет или сутки впереди `upTo`; `history[i]` — от среднего исторических положений армий фронта (`h.armies`, дата `== days[i]`), `null` — положений нет.
  - `export interface SideTotals { strength0: number; strength: number[]; divisions: number[]; manningFromTable: number[] | null }` — по суткам: людей в строю (дивизии введены и не выбыли), дивизий в строю, укомплектованность «от штата» (этап 1).
  - `OperationSummary` (задача 2) дополняется полями `events: EventResult[]; distance: { days: string[]; rows: DistanceRow[] }; sides: Record<'su' | 'de', SideTotals>`; `operationSummary` (та же подпись) их заполняет: `upTo` меньше конца хода → события по усечённому ходу (`frames.slice(0, upTo + 1)`), `over` по умолчанию `true`.
  - Укомплектованность «от штата»: этап 1 (п. 10, план `2026-10-30-stage1-fixes.md`, задача 9) вводит `establishmentOf(side, kind)` в `packages/sim/src/establishment.ts`. Есть он — `manningFromTable[i] = Σ personnel / Σ establishmentOf(d.side, d.kind).personnel` по дивизиям в строю, у которых штат есть (нет ни одной — `null`). Модуля нет (этап 1 не исполнен) — `manningFromTable: null`, в таблице — укомплектованность «от начала операции» и пояснение «мерило „от штата“ вводит этап 1 (п. 10)».
- Produces (окно):
  - `export const COMPARE_EVENTS: { id: string; title: string }[] = [{ id: 'seelow', title: 'Прорыв Зееловских высот' }, { id: 'ring', title: 'Окружение Берлина — соединение фронтов (Кетцин)' }, { id: 'torgau', title: 'Выход к Эльбе (Торгау)' }, { id: 'pocket', title: 'Котёл 9-й армии' }, { id: 'breakout', title: 'Исход котла: остатки 9-й армии у 12-й' }, { id: 'reichstag_taken', title: 'Взятие рейхстага' }]` — в данных окружение Берлина и соединение 1 БФ с 1 УФ — одно событие `ring` (47 А и 4 гв. ТА у Кетцина), поэтому одна строка; событий, которых нет в истории сценария, в таблице нет; остальные события сверки — строкой «остальные события: N из M в пределах ±2 сут».
  - `export type Cell = { kind: 'date'; date: string } | { kind: 'num'; value: number; unit: string } | { kind: 'pending' } | { kind: 'never' } | { kind: 'none'; why: string }`
  - `export interface Diff { tone: 'better' | 'worse' | 'same' | 'none'; text: string }`
  - `export interface CompareRow { id: string; title: string; game: Cell; history: Cell; baseline: Cell; vsHistory: Diff; vsBaseline: Diff }`
  - `export const SAME_DAYS = 1; export const SAME_SHARE = 0.1;` — «как в истории» в пределах ±1 сут и ±10 %.
  - `export function compareRows(game: OperationSummary, baseline: OperationSummary | null, side: 'su' | 'de'): CompareRow[]` — строки: события `COMPARE_EVENTS`; по каждому советскому фронту — «темп, км/сут» (`(game[0] − game[last]) / сутки`) и «удаление от Берлина к концу, км»; «потери людей в сутки», «танков», «орудий» (своей стороны; история — `perDay` или `total / сутки периода`); «укомплектованность» (от штата, иначе от начала); «дивизий в строю». Событие: нет даты и `!over` → `pending` («ещё не наступило»), нет и `over` → `never`. Тон: для `su` раньше и ближе — `better`, меньше своих потерь — `better`; для `de` — обратное по событиям и удалению; `none` — сравнивать не с чем. Текст: «на 2 сут раньше истории», «на 15 % меньше», «как в истории», «не случилось», «нет данных».
  - `export function summaryNeeded(r: SimResult): boolean` — агентный расчёт без `operation` (сохранён до этапа).
  - `apps/editor/src/sim/baseline.ts`: `export const BASELINE_KEY = 'def_ops.baseline.v1'`; `export function baselineKey(scenario: string, seed: number, edits: unknown): string` (`${BASELINE_KEY}:${scenario}:${seed}:${fnv1a(JSON.stringify(edits ?? null))}`); `export function rememberBaseline(scenario: string, seed: number, edits: unknown, s: OperationSummary): void`; `export function baselineSummary(scenario: string, seed: number, deps?: { run?: typeof runAgents; summarize?(trace: AgentTrace, history: AgentHistory): Promise<OperationSummary>; edits?(scenario: string): Promise<unknown> }): Promise<OperationSummary>` — кэш `localStorage` (чтение и запись в `try/catch`; без хранилища — просто считать), иначе `runAgents(scenario, { seed, edits, command: 'intent' })`, сводка — новым `sim/worker.ts` с `summaryOnly: true`; одновременные вызовы с одним ключом — один прогон.
  - `SimRequest.summaryOnly?: boolean` → ответ `{ kind: 'summary'; summary: OperationSummary }`.
  - Переигровка: расчёт в режиме `intent` без варианта параметров — сам и есть «без вмешательства»: `rememberBaseline` его сводкой, отдельный прогон не нужен. Сохранённая переигровка без `result.operation` — сводка пересчитывается из `SavedReplayData.agents` (`summaryOnly`).
  - Игра: `TurnView.results = operationSummary(agentBase, agentTrace, agentRawHistory, history, { upTo: agentTrace.frames.length - 1, over: isOver() })`; базовая — `baselineSummary(view.scenario, view.seed)` в окне при первом открытии части «Сравнение».
  - `export function DistanceChart(p: { s: OperationSummary; baseline: OperationSummary | null; side: 'su' | 'de' }): JSX.Element` — по фронту цвет (`COLORS` как у `RivalryChart`), игра — сплошная, без вмешательства — штрих, история — точки; ось — км и даты.
  - `packages/sim/tools/agents/compare.ts --scenario berlin --trace <путь>` — печатает JSON `{ ok, events: [{ id, summary, score }] }` (даты события в `operationSummary` и в `agentsScore`), код выхода 1 при расхождении.

- [ ] **Step 1: Падающие тесты:**
  - `packages/sim/tests/agents-score.test.ts`, `agentsScore events = agentsEvents` — для заготовки хода `agentsScore(...).events` совпадает с `agentsEvents(...)` по `id`, `days`.
  - `packages/sim/tests/results.test.ts`: `summary events are the score events` — `operationSummary(...).events` по `id/simulated/days` равны `agentsScore(...).events` (Берлинская база `contextFrom(get, 'berlin-1945-tasks')`, заготовка хода с дивизией `su_x` у Мюнхеберга на часе 80); `summary up to hour` (Review Focus 3) — с `upTo: 24` и `over: false` событие часа 80 — `simulated === null`, `distance.rows[0].game[2] === null`; `distanceSeries` — дивизия фронта в 50 км к востоку от `OBJECTIVE` → `game[0]` в пределах 50 ± 0,5; история фронта из двух армий — среднее; `sides divisions and strength` — дивизия «не введена» в строю не считается, `strength0` — по введённым.
  - `apps/editor/tests/results-view.test.ts`: `compare rows su` — событие на 2 сут раньше истории → `vsHistory.tone 'better'`, текст «на 2 сут раньше истории»; ±1 сут → `same`; `pending` и `never`; потери в сутки на 15 % меньше истории → `better`, «на 15 % меньше»; без базовой → `baseline.kind 'none'`, `vsBaseline.tone 'none'`; `compare rows for de` (Review Focus 5) — те же данные с `side 'de'`: тон по событиям и удалению обращён, по потерям — свои (немецкие) потери, история немецких — с пометкой «по советскому донесению»; `manning without stage 1` — `manningFromTable null` → ячейка — от начала операции и пояснение «мерило „от штата“ вводит этап 1 (п. 10)».
  - `apps/editor/tests/baseline.test.ts`: `cached by scenario seed edits` — второй вызов с тем же ключом не зовёт `run`; другие правки — новый прогон; два одновременных вызова — один `run`; `localStorage` бросает — сводка всё равно возвращается.
  - `saved replay without operation` (Review Focus 4) — в `results-view.test.ts`: `summaryNeeded(result)` (`results-view.ts`) истинно для агентного `SimResult` без `operation` и ложно для нынешней модели.
- [ ] **Step 2:** `npx vitest run packages/sim/tests/results.test.ts packages/sim/tests/agents-score.test.ts apps/editor/tests/results-view.test.ts apps/editor/tests/baseline.test.ts` — FAIL.
- [ ] **Step 3:** Реализовать по Interfaces; часть «Сравнение» — таблица (ячейка истории — с источником во всплывающей подсказке; цвет тона — классы `better/worse/same`, слова — `Diff.text`), `DistanceChart` под таблицей; базовая «считается…» — строка состояния, ошибка — текстом, таблица без столбца не ломается.
- [ ] **Step 4:** Тесты зелёные.
- [ ] **Step 5: Проверка этапа на Берлинской:** `cargo run --release -q --bin agents-run -- --scenario packages/sim/data/scenarios/agents/berlin-1945.json --command intent --runs 1 --seed 1 --out evals-out/agents/berlin-intent`, затем `npx tsx packages/sim/tools/agents/compare.ts --scenario berlin --trace evals-out/agents/berlin-intent/trace.json` — Expected: `"ok": true`, у каждого события `summary` = `score`.
- [ ] **Step 6:** Живая проверка через мост: переигровка (часть «Сравнение», столбец «без вмешательства» — тот же расчёт), игра после двух ходов (события впереди — «ещё не наступило»). Снимки `evals-out/ui/results-compare-replay.jpg`, `evals-out/ui/results-compare-game.jpg` — посмотреть самому.
- [ ] **Step 7:** Описание: часть I, раздел 6 — абзац «**Сравнение с историей.**» (показатели, «без вмешательства» — что это и как кэшируется, тон и слова, игра — по сыгранным часам); часть II, раздел 20 — сравнение итогов использует те же события, что мерило (одна функция), и числа потерь Берлинской «История как замысел», seed 1, против Кривошеева — из прогона шага 5. Снимок `docs/img/command-compare.jpg` с подписью. `npm run kb:seed`, `npm run model:index`, `npm run docs:system`, `npm run typecheck`, `npm test`; коммит `feat(итоги): сравнение с историей и с переигровкой без вмешательства`.

### Task 4: Ключевые события хода — правила без модели

**Files:**
- Create: `packages/sim/src/turn-events.ts`
- Modify: `packages/sim/src/agents.ts` (экспорт `CUT_H` — сутки отрезанности, уже используются в `agentsToRun`), `packages/sim/src/index.ts`, `apps/editor/src/sim/game-protocol.ts` (`TurnView.debrief?`), `apps/editor/src/sim/game-worker.ts`
- Test: `packages/sim/tests/turn-events.test.ts` (новый)

**Interfaces:**
- Consumes: `agentsEvents` (задача 3), `divisionLoss` (задача 2), `postureOf`, `CUT_H`.
- Produces:
  - `export type KeyEventKind = 'breakthrough' | 'encirclement' | 'capture' | 'counterattack' | 'withdrawal' | 'destroyed';`
  - `export interface KeyCause { kind: 'document' | 'decision' | 'order'; side: 'su' | 'de'; hq: string; tick: number; text: string }`
  - `export interface KeyEvent { id: string; kind: KeyEventKind; side: 'su' | 'de'; tick: number; title: string; text: string; at: LngLat; from: LngLat | null; to: LngLat | null; divisions: string[]; hqs: string[] /* все штабы-предки участников */; km: number | null; lost: number; causes: KeyCause[]; weight: number; seen: boolean }`
  - `export interface DebriefHq { id: string; name: string; echelon: string; side: 'su' | 'de'; parent: string | null; alive: number; state: 'line' | 'removed' | 'destroyed'; points: LngLat[]; center: LngLat | null; task: { tick: number; text: string } | null; goal: { title: string; kmBefore: number | null; kmAfter: number | null } | null; histKm: number | null }`
  - `export interface TurnDebrief { from: number; to: number; time: string; side: 'su' | 'de'; events: KeyEvent[]; hqs: Record<string, DebriefHq>; quiet: { maxAdvanceKm: number; lost: number } }`
  - `export function turnEvents(base: SimContext, t: AgentTrace, h: AgentHistory, baseHistory: History | null, from: number, to: number, o: { side: 'su' | 'de'; seen?: (division: string) => boolean; reveal?: boolean }): TurnDebrief`
  - `export type GameWindowTrace = Pick<AgentTrace, 'frames'> & { game?: { takeover: number } }` и `export function debriefWindow(t: GameWindowTrace, turnHours: number): { from: number; to: number }` — `to = frames.length − 1`, `from = max(game?.takeover ?? 0, to − turnHours)` (`AgentGameTrace` окна ему соответствует).
  - `export function debriefFor(d: TurnDebrief, hq: string | null): { events: KeyEvent[]; hq: DebriefHq | null; verdict: string[] }` — `null` — верхняя инстанция (Ставка / ОКХ): все события своей стороны и видимые события противника; штаб — события, у которых `hqs` содержит его, или место в пределах `BAND_PAD_KM` от любой его точки `points`; `verdict` — задача штаба (`task.text`), «до {goal.title} {kmAfter} км, за ход ближе на N км» (или «дальше»), «от исторического положения — N км» (`histKm`; нет — «исторического пути этого штаба в данных нет»), `alive === 0` — «войск в строю нет: штаб снят с операции» / «… разгромлен».
  - Пороги (экспорт): `BREAK_KM_DAY = 10`, `COUNTER_MIN = 2`, `WITHDRAW_KM = 3`, `CAUSE_LOOKBACK_H = 24`, `BAND_PAD_KM = 15`, `KEY_EVENTS_MAX = 8`, `CAUSES_MAX = 3`. Это пороги показа, не правила модели: в `norms.json` не входят.
- Правила (окно `(from, to]`, по армиям — предок `echelon 'army'`, без армии — фронт):
  - `breakthrough` — наступавшие за окно дивизии армии сместились в среднем не меньше `BREAK_KM_DAY × (to − from) / 24` (не меньше 4 км); `from/to` — их центр в начале и в конце; `km` — среднее смещение.
  - `counterattack` — в начале окна большинство живых дивизий армии в обороне, за окно не меньше `COUNTER_MIN` из них перешли в «наступление»; стрелка — от их центра к ближайшей дивизии другой стороны в конце окна.
  - `withdrawal` — не меньше половины живых дивизий армии были в «отход»/«отступление»/«остатки» и сместились не меньше `WITHDRAW_KM`.
  - `encirclement` — дивизии, у которых отрезанность (`encircled`) перешла `CUT_H` внутри окна, по армиям; и события сверки вида `cut` с моментом в окне.
  - `capture` — события сверки `agentsEvents` видов `reach`/`meet` с моментом `at` в окне (взятие пункта, соединение); место — пункт события.
  - `destroyed` — дивизии, ставшие «небоеспособна» или «сведена» в окне (капитуляция — по `captured`), по армиям.
  - `lost` — потери участников за окно (`divisionLoss`); `weight` — по виду (`capture` 5, `encirclement` 4, `breakthrough` 3, `counterattack` 3, `destroyed` 2, `withdrawal` 1) плюс `lost / 1000`; оставляются `KEY_EVENTS_MAX` самых весомых, по `tick`.
  - Причины: документы хода (`t.documents`, час в `[from − CAUSE_LOOKBACK_H, to]`, штаб — предок участника или участник в `to`), решения командующих (`t.commanders[].decisions`, тот же час и штаб, текст — `why`), полученные приказы участников (журнал «получен приказ …»); не больше `CAUSES_MAX`, свежие первыми. Причины противника — только при `reveal` (посредник показывает всё); иначе вместо них — «решения противника известны только посреднику».
  - Туман (игра): событие противника, где ни один его участник не `seen`, остаётся, только если затрагивает свои войска (место — центр своих участников, названия противника — «противник»), `seen = false`; иначе выпадает.
  - `hqs`: свои штабы с `points` (дивизии поддерева в конце окна), `state` — `removed`, если все дивизии «не введены» после ввода, `destroyed`, если все выбыли; `task` — последний документ `kind 'directive' | 'order'` с ним в `to` до `to` (игра — и `command.historical` к нему, уже поданный); `goal` — ближайшее по исторической дате не наступившее событие сверки вида `reach` стороны штаба, расстояния от `center` в начале и в конце окна; `histKm` — от `center` до исторического положения штаба (`h.armies`, ближайшее время в пределах 12 ч; нет — до среднего исторических положений его дивизий в тот же день; нет — `null`).
  - Игра: `postView` кладёт `TurnView.debrief = turnEvents(agentBase, agentTrace, agentRawHistory, history, w.from, w.to, { side: human, seen: (id) => fog()(id, last snapshot), reveal })` при `rec.turns.length > 0`, `w = debriefWindow(agentTrace, agents.turnHours)`.

- [ ] **Step 1: Падающие тесты** (`packages/sim/tests/turn-events.test.ts`, заготовки ходов на 24 кадра, база — `contextFrom(get, 'berlin-1945-tasks')`):
  - `breakthrough by army` — три дивизии `su_8gva` в «наступление: бой в глубине» сместились на 8 км за 12 ч → одно событие `breakthrough`, `km ≈ 8`, `hqs` содержит `su_8gva` и `su_1bf`.
  - `counterattack` — две немецкие дивизии `de_9a` из обороны в наступление → `counterattack`, `side 'de'`.
  - `encirclement and destroyed` — `encircled` 30 у трёх немецких дивизий одной армии; одна стала «небоеспособна» → `encirclement` и `destroyed`.
  - `capture from score events` — дивизия у Мюнхеберга в окне → `capture` с `id` события `seelow`; та же дивизия вне окна — события нет.
  - `quiet turn` (Review Focus 1) — все в обороне на месте → `events.length === 0`, `quiet.maxAdvanceKm < 1`, `quiet.lost` — потери окна.
  - `causes` — документ армии за 6 ч до окна и решение командующего фронта в окне → причины обоих, порядок — свежие первыми; немецкий документ без `reveal` в причинах нет, текст-заглушка есть; с `reveal` — есть.
  - `de side events and fog` (Review Focus 5) — `side 'de'`, `seen` ложно для всех советских: советский прорыв, не задевший немецких дивизий, выпал; задевший — остался с `seen false` и местом у немецких участников.
  - `perspective of removed hq` (Review Focus 2) — все дивизии `su_1gta` «не введены» с часа 6 → `hqs.su_1gta.state === 'removed'`, `debriefFor(d, 'su_1gta').verdict` содержит «войск в строю нет: штаб снят с операции»; все рассеяны → `destroyed`, «… разгромлен».
  - `perspective filter` — событие с участником `su_8gva` есть в `debriefFor(d, 'su_8gva')`, нет в `debriefFor(d, 'su_33a')`, если оно дальше `BAND_PAD_KM` от его дивизий; ближе — есть; `debriefFor(d, null)` — все свои.
  - `window from game trace` (Review Focus 3) — `debriefWindow({ frames: 61 кадр, game: { takeover: 54 } }, 12)` → `{ from: 54, to: 60 }`; 73 кадра → `{ from: 60, to: 72 }`.
- [ ] **Step 2:** `npx vitest run packages/sim/tests/turn-events.test.ts` — FAIL.
- [ ] **Step 3:** Реализовать `turn-events.ts`; `TurnView.debrief` в игре.
- [ ] **Step 4:** Тесты зелёные; `npx vitest run packages/sim/tests` — без падений.
- [ ] **Step 5:** `npm run model:index`, `npm run typecheck`, `npm test`; коммит `feat(разбор): ключевые события хода по правилам — прорыв, окружение, взятие, контрудар, отход`.

### Task 5: Разбор хода — карта, «разобрать с позиции …», связный текст модели

**Files:**
- Create: `apps/editor/src/TurnDebrief.tsx`, `apps/editor/src/DebriefOverlay.tsx`, `apps/editor/src/debrief-view.ts`
- Modify: `apps/editor/src/CommanderOverlay.tsx` (`export` у `Arrow`), `apps/editor/src/ResultsTab.tsx` (часть `turn`), `apps/editor/src/voice/actions/results.ts` (действия разбора), `apps/editor/src/CommandView.tsx` (часть «Ход» вкладки «Итоги» по умолчанию после хода; слой разбора на карте; ссылка «Итоги хода ▸» рядом с «Разбор хода на карте ▸» в «Донесениях»; карта шагов — `createTourMap` хранится и в `tourMapRef`), `apps/editor/src/styles.css`, `apps/editor/tests/voice-completeness.test.ts` (`FILES`: `TurnDebrief.tsx`)
- Test: `apps/editor/tests/debrief-view.test.ts` (новый)

**Interfaces:**
- Consumes: `TurnDebrief`, `KeyEvent`, `debriefFor` (задача 4); `TourMap`, `createTourMap` (`voice/tour-map.ts`); `UmpireModel` и `umpireModel()` из `CommandView`.
- Produces (`debrief-view.ts`):
  - `export function perspectiveOptions(d: TurnDebrief, terms: CommandTerms): { id: string | null; label: string; depth: number; note: string | null }[]` — первая — верхняя инстанция (`terms` — «Ставка» / «ОКХ»), дальше дерево своих штабов по `parent` (фронт → армия → корпус); `note` — «снят с операции» / «разгромлен».
  - `export function eventMap(e: KeyEvent): TourMap` — `{ at: e.at, level: e.kind === 'capture' ? 'army' : 'division', fit: [e.at, e.from, e.to].filter(Boolean), spot: e.at, box: [...] }`.
  - `export function eventLines(e: KeyEvent): { what: string; where: string; why: string[]; meaning: string }` — «что» — `e.text`; «где» — место словами (`placeName` ближайшего пункта сценария, как `UnitReport.place`); «почему» — `causes` текстом с часом и штабом; «что значит» — для выбранной позиции: изменение расстояния до `goal` или «угроза окружения», «объект взят», «потери N человек».
  - `export const DEBRIEF_SYSTEM: string` — от лица посредника: связный разбор хода по фактам ниже, только по ним, без новых чисел и названий, 5–8 фраз, по-русски, без разметки.
  - `export function debriefInput(d: TurnDebrief, hq: string | null, names: Record<string, string>): string` — позиция, окно хода, события с причинами и смыслом, `verdict`.
  - `export function narrativeFits(text: string, input: string): boolean` — ответ годится, если не пуст и каждое число из ответа есть во входе (иначе показывается «ответ модели не годится — разбор по данным хода»).
- Produces (окно):
  - `TurnDebrief.tsx`: `export function TurnDebriefPanel(p: { d: TurnDebrief; terms: CommandTerms; hq: string | null; open: number | null; narrative: NarrativeState; modelOn: boolean })` — сверху выбор «Разобрать с позиции …» (`perspectiveOptions`), строки `verdict`, нумерованный список событий (номер = метка на карте; щелчок — `act('command.debrief.event', { n })`: карта переезжает `tourMapRef.current.show(eventMap(e))`, событие раскрывается: «что / где / почему / что значит»); пустой — «За ход ключевых событий нет» и строка `quiet`; кнопка «Связный разбор (модель)» — `act('command.debrief.narrate')`, без модели — недоступна с подсказкой «модель не на связи — разбор по данным хода». `NarrativeState = { state: 'off' } | { state: 'wait' } | { state: 'ready'; text: string } | { state: 'unfit' } | { state: 'error'; text: string }`.
  - `DebriefOverlay.tsx`: `export function DebriefOverlay(p: { engine: MapEngine; events: KeyEvent[]; open: number | null })` — по образцу `CommanderOverlay` (`engine.project`, перерисовка на `engine.on('view')`): круг с номером у `at`, стрелка `Arrow` от `from` к `to` (класс по стороне: свои — красная, противник — синяя), раскрытое — крупнее; виден, пока открыта вкладка «Итоги», часть «Ход».
  - Перспектива и раскрытое событие — состояние `CommandView` (`debriefHq`, `debriefOpen`), сбрасываются новым ходом; связный текст — по `(view.time, hq)`, новый ход отменяет ждущий запрос.
  - `ResultsDeps` дополняется: `debrief(): TurnDebrief | null; terms(): CommandTerms; setHq(hq: string | null): void; openEvent(n: number): void; narrate(): void; modelOn(): boolean`. Действия (в `resultsActions`, без разбора фраз — он в задаче 6): `command.debrief.as` `{ name }` — штаб по названию или id (выбор в панели передаёт id; «Ставка»/«ОКХ» → `null`), не найден — «такого штаба нет»; `command.debrief.event` `{ n }` — нет такого — «событий за ход N»; `command.debrief.narrate` — без модели недоступно: «модель не на связи — разбор по данным хода». Выбор позиции, щелчок по событию, «Связный разбор», «Итоги хода ▸» — только через них.

- [ ] **Step 1: Падающие тесты** (`apps/editor/tests/debrief-view.test.ts`, `TurnDebrief`-заготовка):
  - `perspective options` — первая `{ id: null, label: 'Ставка' }` (для `terms` советской стороны), армия — глубже фронта, снятая — с `note 'снят с операции'`; немецкая сторона — «ОКХ».
  - `event map` — прорыв с `from/to` → `fit` из трёх точек, `level 'division'`; `capture` → `level 'army'`.
  - `event lines` — причины с часом и штабом, «что значит» для позиции с `goal`: «до Берлина 42 км, за ход ближе на 9 км».
  - `debrief quiet` (Review Focus 1) — пустые события → `debriefInput` содержит «ключевых событий нет», `eventLines` не зовётся, список пуст.
  - `narrative fits` — ответ с числом, которого нет во входе, → `false`; только числа входа → `true`; пустой → `false`.
  - `voice-results.test.ts`: `debrief.as removed hq` — ответ с «снят с операции»; `debrief.event out of range` — «событий за ход 2»; `narrate without model` — недоступно с текстом про модель.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/debrief-view.test.ts` — FAIL.
- [ ] **Step 3:** Реализовать; связный текст — `umpireModel()` (`DEBRIEF_SYSTEM`, `debriefInput`), проверка `narrativeFits`, показ под разбором с пометкой «связный текст модели по тем же фактам».
- [ ] **Step 4:** Тесты зелёные; `npx vitest run apps/editor/tests/voice-completeness.test.ts` — PASS.
- [ ] **Step 5:** Живая проверка через мост: игра Берлинской с 17.04, три хода; «Итоги» → «Ход»: метки и стрелки на карте, щелчок по событию — карта переезжает; «с позиции» 8 гв. А и Ставки — разные списки; ход без событий (оборона) — пустой разбор. Снимки `evals-out/ui/debrief-*.jpg` — посмотреть самому.
- [ ] **Step 6:** Описание: часть I, раздел 6 — абзац «**Разбор хода по событиям.**» (что считается ключевым событием и по каким порогам, метки и стрелки, «почему», «что значит», «с позиции …», связный текст модели и его проверка, туман войны); снимок `docs/img/command-debrief.jpg` с подписью. `npm run docs:system`, `npm run typecheck`, `npm test`; коммит `feat(разбор): разбор хода на карте и с позиции штаба, связный текст модели`.

### Task 6: Голос и описание голоса

**Files:**
- Modify: `apps/editor/src/voice/actions/results.ts` (фразы `say`, разбор фраз, `results.losses.read`), `apps/editor/src/voice/actions/command.ts` (подключить разбор фраз итогов в `parseCommand` до общих «покажи …»), `apps/editor/src/voice/tours/turn.ts` (шаги-события в `turnReview`), `apps/editor/src/ReplayView.tsx`, `apps/editor/src/CommandView.tsx` (регистрация действий с состоянием), `scripts/voice-e2e.mjs` (часть `game`: «Штаб, итоги хода», «Штаб, разбери ход с позиции Ставки»), `scripts/agents-shots.mjs` (`--results`: снимки задач 2, 3, 5 для описания), `docs/system.md` (раздел 9.1 — фразы)
- Test: `apps/editor/tests/voice-results.test.ts` (новый), `apps/editor/tests/voice-review.test.ts`

**Interfaces:**
- Consumes: `ResultsPart`, `TurnDebrief`, `debriefFor`, `perspectiveOptions`, `eventMap`, `lossSeries` — задачи 2–5.
- Produces:
  - Фразы `say` у действий задач 2 и 5: `results.show` — «штаб, итоги хода» (`turn`), «штаб, покажи потери» (`losses`), «штаб, сравни с историей» (`compare`), «штаб, покажи итоги»; `command.debrief.as` — «штаб, разбери ход с позиции Ставки / восьмой гвардейской армии» (штаб по названию — тем же поиском `findWho`, что у вкладки штаба); `command.debrief.event` — «штаб, покажи событие два»; `command.debrief.narrate` — «штаб, расскажи ход связно».
  - Новое действие `results.losses.read` — «штаб, доложи потери»: ответ — `export function lossesSay(s: OperationSummary, side: 'su' | 'de'): string` (свои и противника за всё время и за последние сутки, числа словами — `numberWords`; рядом — история среднесуточно, если есть).
  - `export function parseResults(rest: string, section: string): PhraseHit | null` — фразы выше (числа и порядковые — словами и цифрами), подключается в `parseCommand` до общих «покажи …».
  - `turnReview(v, prev)`: боёв с местом нет и есть `v.debrief?.events` — после «Ход в целом» до трёх шагов `kind 'battle'` по самым весомым событиям: заголовок `e.title`, текст `say(e.text)`, `map = eventMap(e)`; событий нет — шагов нет, в «Ход в целом» — строка `quiet`.

- [ ] **Step 1: Падающие тесты:**
  - `voice-results.test.ts`: разбор фраз — «итоги хода» → `results.show {part 'turn'}`, «сравни с историей» → `compare`, «разбери ход с позиции восьмой гвардейской армии» → `command.debrief.as {name: 'восьмой гвардейской армии'}`, «разбери ход с позиции Ставки» → `{ name: 'Ставки' }`, «покажи событие два» и «покажи событие 2» → `{ n: 2 }`; `lossesSay` — числа словами, история среднесуточно, без исторических — без этой части.
  - `voice-review.test.ts`: `turn review uses key events` — `TurnView` без боёв с `debrief` из двух событий → шагов-событий два, у второго `map.spot === e.at`; `turn review quiet` — `debrief.events` пуст → шагов-событий нет.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/voice-results.test.ts apps/editor/tests/voice-review.test.ts` — FAIL.
- [ ] **Step 3:** Реализовать; `voice-completeness` — без новых исключений.
- [ ] **Step 4:** Тесты зелёные; сквозная проверка голоса в фоне: `node scripts/voice-e2e.mjs --only game` — `grep -c '^ok'` растёт на число новых проверок, `grep -v '^ok' | tail` — пусто.
- [ ] **Step 5:** Снимки описания: `node scripts/agents-shots.mjs --results --doc` (нужны `cd apps/editor && npx vite` и `target/release/agents-game`) → `docs/img/replay-results-losses.jpg`, `docs/img/command-compare.jpg`, `docs/img/command-debrief.jpg` пересняты в одном окружении; подписи под ними сверить со снимками. Описание: раздел 9.1 — фразы итогов и разбора; раздел «Разбор хода на карте» — шаги-события агентной модели.
- [ ] **Step 6:** `npm run docs:system`, `npm run typecheck`, `npm test`; коммит `feat(итоги): голосом — итоги, потери, сравнение, разбор с позиции штаба`.
