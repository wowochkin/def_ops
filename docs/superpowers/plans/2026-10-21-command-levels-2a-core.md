# Командование по ступеням, этап 2а: каркас штабов-агентов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в ядре агентной модели — директива как данные, два способа её прохождения со слаженностью, управление
каждым штабом (агент / игрок / сценарий), приказ через голову и «взять под управление», журнал документов и общий
штаб-агент, который доводит замысел старшего до дивизий; режимы игры «агенты» и «гибрид» и прогон «Ставка подаёт
исторические директивы».

**Architecture:** новый модуль `crates/agents-core/src/command/` (директива, полосы, прохождение, управление, общий
штаб-агент) поверх нынешнего конвейера приказов (`ScriptOrder` → `in_transit` → `Division.order`). Штаб-агент
получает директиву старшего, делит свою полосу между подчинёнными и отдаёт им директивы своей ступени; до дивизии
директива доходит обычным `Order`. Всё новое включается только режимом игры `Agents`/`Hybrid`: прогон по сценарию и
нынешняя игра (`Legacy`) не меняются ни на бит. Логика ступеней по уставам (советская и немецкая) — этап 2б; здесь
у всех ступеней общий агент.

**Tech Stack:** Rust (`crates/agents-core`, cargo test), TypeScript (сборщики сценариев, vitest), JSON-данные.

**Spec:** `docs/superpowers/specs/2026-10-21-command-levels-design.md` (разделы 1–4, 7).

## Global Constraints

- Язык комментариев, журнала, сообщений коммитов — русский.
- Прогон по сценарию (`Source::Script`, без игры) и игра в режиме `Legacy` дают тот же `digest()`, что до этапа:
  проверяется тестом на Зееловском сценарии в задачах 2, 3, 5, 7.
- Каждое новое число правил — в `packages/sim/data/rules/agents-v0.json`, раздел `command`, с полем `source` или
  `assumption`; строка в `packages/sim/data/rules/norms.json` и вход `RULE_INPUTS`
  (`packages/sim/src/rule-inputs.ts`) — иначе падает `packages/sim/tests/norms.test.ts`.
- Числа (спецификация, разделы 2–3; источник/допущение):
  - подготовленный приказ, часов на ступень получателя: фронт 24, армия 24, корпус 22, дивизия 22 (корпус и
    дивизия — «Сборник боевых документов», вып. 25: приказ корпуса → ~23 ч → приказ дивизии → ~22 ч → полки на
    исходных, A; фронт и армия — допущение по ПУ-39 ст. 83);
  - боевое распоряжение, часов на ступень: фронт 3, армия 2, корпус 2, дивизия 1 (допущение по ПУ-39 ст. 89);
  - слаженность после распоряжения — 0,7, восстановление — +0,03 в час до 1 (допущение);
  - влияние слаженности на силу в бою: множитель `1 − (1 − coord) · 0,5` (допущение);
  - цикл решения общего штаба-агента: фронт 12 ч, армия 6, корпус 3 (спецификация, раздел 2.2; допущение).
- Верхняя инстанция (`Echelon::HighCommand`) — всегда игрок своей стороны или исторические директивы; приказ
  ей самой (`Game::order` с её id) — ошибка «верхней инстанции приказов не отдают».
- Проверки — экономно (CLAUDE.md): точечно `cargo test --release -q -p agents-core <фильтр>` и
  `npx vitest run <файл>`; полный `npm run typecheck`, `npm test`, `cargo test` — перед последним коммитом.
- Работа — в ветке `claude/command-levels-2` от `main`.

## Review Focus

1. Директива адресована штабу, у которого все подчинённые изъяты через голову или выбыли, — штаб не падает и не
   отдаёт пустых директив; в журнале документов — «нет подчинённых для задачи».
2. Директива без разграничительных линий (у исторических немецких решений их нет) или с одной линией — полоса
   строится по положению подчинённых поперёк оси, не NaN и не пустая.
3. Пункт директивы — река без координат («Одер», «р. Шпрее») — точка не попадает в геометрию, рубеж из оставшихся
   пунктов; рубеж из одного пункта — точка, а не линия.
4. Игрок взял штаб и затем вернул его агенту посреди цикла — агент продолжает с текущего замысла, без двойной
   директивы подчинённым в тот же час.
5. Приказ через голову дивизии, у которой уже идёт директива старшего в пути, — пришедшая позже директива старшего
   эту дивизию не перехватывает, пока её не вернули.

---

### Task 1: директива как данные и исторические директивы в сценарии

**Files:**
- Create: `crates/agents-core/src/command/mod.rs`, `crates/agents-core/src/command/directive.rs`
- Modify: `crates/agents-core/src/lib.rs` (`pub mod command;`), `crates/agents-core/src/scenario.rs:81-103`
  (`ScenarioIn.directives`), загрузка — рядом с приказами
- Modify: `packages/sim/tools/agents/build-berlin.ts`, `build-seelow.ts`, `build-vistula.ts` — поле `directives`
- Create: `packages/sim/tools/agents/directives.ts` (общее для сборщиков)
- Modify: `packages/sim/data/scenarios/agents/*.json` (пересборка)
- Test: `crates/agents-core/tests/command.rs`, `packages/sim/tests/agents-directives.test.ts`

**Interfaces:**
- Produces (Rust, `command::directive`):
  - `enum Form { Order, Instruction }` (serde `"order" | "instruction"`; историческая `"directive"` → `Order`);
  - `enum Task { Attack, Defend, Delay, Withdraw, Move, Reserve }` (serde lowercase);
  - `enum Target { Hq(u32), Division(u32) }`;
  - `struct Line { pub pts: Vec<XY>, pub by: Option<u32> }` — `by` — час операции;
  - `struct Directive { pub id: String, pub from: u32, pub to: Target, pub form: Form, pub task: Task,
    pub axis: Vec<XY>, pub immediate: Option<Line>, pub subsequent: Option<Line>,
    pub boundaries: Vec<(Option<u32>, Vec<XY>)>, pub main_blow: Vec<u32>, pub reserve: Vec<u32>,
    pub junction: Option<u32>, pub hasty: bool, pub note: String }` — `boundaries`: (сосед, ломаная);
    `hasty` — по пути хотя бы одна ступень прошла распоряжением;
  - `Sim.historical: Vec<(u32 /*час*/, Directive)>` — исторические директивы сценария, по часу.
- Produces (сценарий JSON, поле `directives`): `[{ id, at: "YYYY-MM-DDTHH:MM", from, to: [id], form, task,
  axis: [[lng,lat]], immediate: { line: [[lng,lat]], by: "YYYY-MM-DD" | null } | null, subsequent: …,
  boundaries: [{ with: id | null, line: [[lng,lat]] }], mainBlow: [id], reserves: [id], note }]`; одна запись
  источника с несколькими `to` → одна запись сценария (ядро размножает по получателям).
- Produces (TS, `directives.ts`): `scenarioDirectives(file: string, hqIds: Set<string>, start: string, idSuffix?: string): unknown[]`
  — читает `docs/sources/*-directives.json`, пункты — через `places` файла (реки и озёра — пропускаются),
  получатели и штабы — только из `hqIds` (Висло-Одерская — с суффиксом `_vo`, кроме `su_stavka`/`de_hc`),
  дата раньше начала сценария → `at` = начало; `task`: советские → `attack`, немецкие «держать» (`goal` содержит
  «держ» / «Halten») → `defend`, остальные немецкие → `attack`; `form` источника `instruction` → `instruction`,
  иначе `order`.

- [ ] **Step 1: тест** (`agents-directives.test.ts`, новый `it`): в собранных сценариях `berlin-1945.json` —
  23 записи `directives`, `vistula-oder-1945.json` — 15, `seelow-1945.json` — только записи, у которых `to`
  содержит штаб сценария; у каждой записи `from` и все `to` — штабы сценария; ни одной точки `[NaN, …]`.
  Запустить — падает (поля нет).
- [ ] **Step 2:** `directives.ts` и поле в трёх сборщиках; `npm run agents:berlin-data`, `agents:seelow-data`,
  `agents:vistula-data`; тест проходит.
- [ ] **Step 3: тест** `historical_directives_load` (`tests/command.rs`): берлинский сценарий загружается,
  `sim.historical.len()` ≥ 23 (размноженные по получателям), у директивы `stavka-11059` — `Target::Hq(su_1bf)`,
  `form == Form::Order`, `axis.len() == 2`, `immediate` — рубеж из ≥ 1 точки; у `hitler-1504` —
  `task == Task::Defend`. Запустить — падает.
- [ ] **Step 4:** модуль `command::directive`, загрузка `directives` в `scenario.rs` (час — как у `orders.at`,
  неизвестный штаб — ошибка загрузки с id). Тест проходит; `cargo test --release -q -p agents-core` — всё
  зелёное (прогон по сценарию не читает `historical`).
- [ ] **Step 5:** коммит «Ядро: директива как данные; исторические директивы в сценариях агентной модели».

### Task 2: слаженность и правила раздела `command`

**Files:**
- Modify: `crates/agents-core/src/model.rs:37-65` (`Vars.coord: f64`, по умолчанию 1), `src/scenario.rs:219`
- Modify: `crates/agents-core/src/world.rs:238-246` (`strength`), `:907-930` (`apply`: восстановление)
- Modify: `crates/agents-core/src/rules.rs` (struct `Command`, чтение раздела `command`)
- Modify: `packages/sim/data/rules/agents-v0.json` (раздел `command`), `packages/sim/data/rules/norms.json`,
  `packages/sim/src/rule-inputs.ts`
- Test: `crates/agents-core/tests/command.rs`, `packages/sim/tests/norms.test.ts` (существующий)

**Interfaces:**
- Produces: `Rules.command: Command { prepared_h: [f64; 4], instruction_h: [f64; 4], hasty_coord: f64,
  coord_recover_h: f64, coord_effect: f64, cycle_h: [f64; 3] }` — индексы `[front, army, corps, division]` и
  `[front, army, corps]`; пути JSON: `command.preparedHours.{front,army,corps,division}`,
  `command.instructionHours.{…}`, `command.hastyCoordination`, `command.coordinationRecoverPerHour`,
  `command.coordinationEffect`, `command.cycleHours.{front,army,corps}` — значения из Global Constraints.
- Produces: `Vars.coord` в кадре trace не выводится (поля кадра не меняются).

- [ ] **Step 1: тесты** (`tests/command.rs`): `coordination_one_changes_nothing` — Зееловский сценарий, 48 шагов,
  `digest()` равен значению, снятому до правки (записать константой в тесте, сняв её на `main` до изменений);
  `coordination_weakens_strength` — дивизия с `coord = 0.7` имеет `strength` в 0,85 от той же с `coord = 1`
  (`sim.strength(i)` — сделать `pub(crate)` → `pub` при необходимости); после 10 ч вне боя `coord` = 1,0
  (0,7 + 10 · 0,03).
- [ ] **Step 2:** запустить — падают.
- [ ] **Step 3:** поле, множитель в `strength`, восстановление в `apply`, раздел правил; строки `norms.json`
  (`kind: "param"`, `expr: "agents.command.…"`, коридоры: подготовленный приказ 12–36 ч, распоряжение 0,5–4 ч,
  слаженность 0,5–0,9, восстановление 0,01–0,1, влияние 0,3–0,7, цикл фронта 6–24, армии 3–12, корпуса 1–6) и
  `RULE_INPUTS`.
- [ ] **Step 4:** `cargo test --release -q -p agents-core`, `npx vitest run packages/sim/tests/norms.test.ts`
  — зелёные.
- [ ] **Step 5:** коммит «Ядро: слаженность дивизии и правила прохождения приказа».

### Task 3: управление штабами и журнал документов

**Files:**
- Create: `crates/agents-core/src/command/control.rs`
- Modify: `crates/agents-core/src/world.rs` (поля `Sim.command: CommandState`, `Sim.documents: Vec<Document>`),
  `crates/agents-core/src/trace.rs` (вывод `documents`)
- Test: `crates/agents-core/tests/command.rs`

**Interfaces:**
- Produces (`command::control`):
  - `enum Control { Script, Agent, Player }` — по штабу; по умолчанию `Script` для всех (поведение как сейчас);
  - `struct CommandState { pub control: Vec<Control>, pub led_hq: Vec<bool>, pub led_div: Vec<bool>,
    pub intent: Vec<Option<Directive>>, pub last_cycle: Vec<u32>, pub in_transit: Vec<(u32 /*прибывает*/, Directive)> }`;
  - `fn active_subs(sim: &Sim, h: u32) -> (Vec<u32> /*штабы*/, Vec<u32> /*дивизии*/)` — прямые подчинённые штаба,
    кроме изъятых через голову (`led_*`) и выбывших;
  - `struct Document { pub tick: u32, pub hq: u32, pub kind: DocKind, pub to: Vec<String>, pub text: String, pub rule: Option<String> }`,
    `enum DocKind { Directive, Order, Instruction, Notice, Report }` (serde lowercase);
  - trace: `documents: [{ tick, time, hq: id, kind, to: [id], text, rule }]`.
- [ ] **Step 1: тест** `active_subs_skip_led`: Зееловский сценарий; у армии `su_8gva` — её корпуса; пометить
  `led_hq` у одного корпуса → `active_subs` без него; пометить дивизию напрямую под армией (если такой нет —
  синтетика `scenario::tests::tiny`) → без неё. `trace_has_documents`: документ, добавленный в `sim.documents`,
  выходит в `trace::describe` с id штаба. Запустить — падает.
- [ ] **Step 2:** реализовать; `CommandState` размером по `hqs`/`divisions` при загрузке сценария.
- [ ] **Step 3:** тесты проходят; `digest` Зееловского сценария не изменился (тест задачи 2).
- [ ] **Step 4:** коммит «Ядро: управление штабами (сценарий, агент, игрок) и журнал документов».

### Task 4: полоса штаба и деление её между подчинёнными

**Files:**
- Create: `crates/agents-core/src/command/band.rs`
- Test: `crates/agents-core/src/command/band.rs` (модуль `tests`)

**Interfaces:**
- Produces:
  - `struct Band { pub left: Vec<XY>, pub right: Vec<XY> }` — левая и правая границы по оси наступления;
  - `fn band_of(axis: &[XY], boundaries: &[(Option<u32>, Vec<XY>)], subs_pos: &[XY], min_width_km: f64) -> Band` —
    две линии: слева/справа от оси по знаку векторного произведения; одной или нет — недостающая граница
    параллельна оси на расстоянии крайнего подчинённого + 2 км, но не ближе `min_width_km / 2`; оси нет —
    ось — от центра подчинённых к центру `immediate` (передаётся как `axis` из двух точек вызывающим);
  - `fn split(band: &Band, weights: &[f64]) -> Vec<Band>` — поперёк: обе границы сэмплируются в 16 точках по
    длине, точка `k` дочерней границы — интерполяция между левой и правой по накопленной доле весов;
  - `fn clip_line(line: &[XY], band: &Band) -> Vec<XY>` — часть рубежа внутри полосы; рубеж из одной точки или не
    пересекающий полосу — точка пересечения оси полосы с рубежом, иначе центр рубежа;
  - `fn center(band: &Band) -> Vec<XY>` — ось полосы (середины).
- [ ] **Step 1: тесты**: полоса 10 км поперёк оси с запада на восток, `split` на веса [1, 1] — две полосы по 5 км,
  смежная граница общая (совпадает в каждой точке); веса [2, 1] — 6,67 и 3,33 км; `band_of` без границ с
  подчинёнными на ±3 км — ширина 10 км (3 + 2 с каждой стороны); с одной границей слева — правая параллельна оси;
  `clip_line` рубежа поперёк полосы — отрезок внутри; рубеж из одной точки — эта точка. Ни одной NaN-координаты.
- [ ] **Step 2:** запустить — падает. **Step 3:** реализовать. **Step 4:** проходит.
- [ ] **Step 5:** коммит «Ядро: полоса штаба и её деление между подчинёнными».

### Task 5: прохождение директивы и общий штаб-агент

**Files:**
- Create: `crates/agents-core/src/command/passing.rs`, `crates/agents-core/src/command/agent.rs`
- Modify: `crates/agents-core/src/world.rs:294-336` (фаза 0 шага: доставка директив, циклы штабов-агентов,
  отбор приказов сценария по управлению штаба)
- Test: `crates/agents-core/tests/command.rs`

**Interfaces:**
- Consumes: `Directive`, `Form` (задача 1); `Rules.command` (задача 2); `CommandState`, `active_subs`,
  `Document` (задача 3); `band_of`, `split`, `clip_line`, `center` (задача 4).
- Produces (`command::passing`):
  - `fn passing_hours(rules: &Command, recipient: Echelon /* или дивизия */, form: Form) -> f64` — получатель-
    дивизия — индекс 3;
  - `fn issue(sim: &mut Sim, d: Directive, tick: u32)` — в `command.in_transit` с часом прибытия
    `tick + passing_hours`; документ вида `Directive` (от верхней инстанции и фронта), `Order` (армия, корпус) или
    `Instruction` (`Form::Instruction`); у `hasty` — `true`, если `form == Instruction` или у замысла старшего `hasty`.
- Produces (`command::agent`):
  - `fn plan(sim: &Sim, h: u32, intent: &Directive, tick: u32) -> Vec<Directive>` — общий штаб-агент: полоса
    `band_of` (ось и границы замысла, положения активных подчинённых); веса подчинённых: в `main_blow` замысла или
    ближе всех к оси — 1, остальные — 1,5 (шире на вспомогательном направлении); подчинённым — по полосе `split`,
    `immediate` — `clip_line(intent.immediate)`, `subsequent` — `clip_line(intent.subsequent)` (ПУ-39 ст. 89 — у
    подчинённого ближайшая и последующая в пределах задачи старшего), `axis` — `center` своей полосы, `task` —
    как у замысла; `form` — `Instruction`, если замысел пришёл распоряжением (срочность наследуется) или это
    перепланирование по циклу, иначе `Order`;
  - дивизии-получателю директива при прибытии становится `Order { kind, target }`: `target` — середина
    `immediate` в полосе дивизии, после выхода на неё (≤ 2 км) — `subsequent`; `kind`: Attack/Move/Defend/
    Withdraw/Hold по `Task` (Delay → Defend, Reserve → Move); у `hasty` — `vars.coord = min(coord, hastyCoordination)`;
  - цикл: штаб с `Control::Agent` и замыслом решает при новом замысле и раз в `cycle_h` своей ступени; в цикле
    отдаёт директиву подчинённому, только если его задача изменилась (цель сдвинулась > 2 км или другой `task`);
    нет активных подчинённых — документ `Notice` «нет подчинённых для задачи», директив нет;
  - приказы сценария (`script`) штаба с `Control::Agent` или `Control::Player` при доставке пропускаются
    (их дивизии ведут агент или игрок).
- [ ] **Step 1: тесты** (`tests/command.rs`, на `scenario::tests::tiny` или Зееловском с правкой `seelow_with`):
  - `directive_reaches_divisions_through_agents`: `Control::Agent` у фронта, армий и корпусов советской стороны;
    в час 0 `issue` директивы фронту «наступать» с осью на Берлин и рубежом в 30 км; через сумму подготовленных
    часов (фронт 24 + армия 24 + корпус 22 + дивизия 22 = 92 ч) у каждой активной советской дивизии — `Order`
    вида Attack с целью в своей полосе; в `documents` — директива фронта армиям, приказы армий корпусам и корпусов
    дивизиям; цели соседних дивизий разнесены поперёк оси не меньше 1 км;
  - `instruction_is_faster_and_hasty`: та же директива `Form::Instruction` фронту, у агентов перепланирование —
    распоряжения: первая дивизия получает приказ не позже 3 + 2 + 2 + 1 = 8 ч, `coord` у неё 0,7;
  - `script_orders_skipped_for_agent_hq`: у армии с `Control::Agent` приказы сценария её дивизиям не доставляются,
    у армии с `Control::Script` — доставляются как раньше;
  - `no_subs_notice`: все дивизии корпуса помечены `led_div` — директива корпусу даёт документ «нет подчинённых
    для задачи» и ни одной директивы;
  - `scenario_run_unchanged`: прогон Зееловского сценария без игры — `digest` как в задаче 2.
- [ ] **Step 2:** запустить — падают. **Step 3:** реализовать. **Step 4:** проходят; `cargo test --release -q -p
  agents-core` — зелёное.
- [ ] **Step 5:** коммит «Ядро: прохождение директив и общий штаб-агент».

### Task 6: игра — режимы, через голову, взять и вернуть

**Files:**
- Modify: `crates/agents-core/src/game.rs:17-31, 115-202` (режим, новые методы), `crates/agents-tauri/src/lib.rs:168-214`
  (параметр `mode` в `game_start`, команды `game_directive`, `game_take`, `game_release`)
- Test: `crates/agents-core/tests/game.rs`

**Interfaces:**
- Produces (`game.rs`):
  - `enum Mode { Legacy, Agents, Hybrid }` (serde lowercase), `Game.mode`; `Game::start_free(…, mode: Mode)` —
    новый последний параметр, `Game::start` — `Mode::Legacy`;
  - `Legacy` — как сейчас (штабы стороны игрока — `Source::Script`, приказы сценария сняты, `order` размножает
    по дивизиям);
  - `Agents` — у штабов стороны игрока ниже верхней инстанции `Control::Agent`, у верхней — `Control::Player`;
    приказы сценария стороны игрока остаются в `script`, но не доставляются (задача 5);
  - `Hybrid` — как `Agents`, плюс: исторические директивы, которые игрок подаёт без изменений
    (`Game::issue_historical`), переводят поддерево получателя в `Control::Script` — его ведут приказы сценария;
  - `fn directive(&mut self, d: DirectiveIn) -> Result<(), String>` — директива игрока штабу или дивизии
    (через `command::passing::issue`); получатель ниже прямых подчинённых верхней инстанции — это приказ через
    голову: `led_hq`/`led_div` = true, каждому пропущенному штабу — документ `Notice` «приказ через голову:
    {получатель}», исполнитель — в журнал «доносит {непосредственный начальник}»;
  - `fn issue_historical(&mut self, id: &str) -> Result<(), String>` — историческая директива из
    `sim.historical` от имени игрока, в час `max(час директивы, текущий)`;
  - `fn take(&mut self, hq: &str)` → `Control::Player` (его замысел старшего остаётся `intent`, в документах —
    «штаб взят под управление»), `fn release(&mut self, id: &str)` — снятие `led_*` и возврат взятого штаба агенту
    (`Control::Agent`) с тем же `intent`; в один час после `release` агент решает не больше одного раза;
  - `Game::order` с id верхней инстанции — `Err("верхней инстанции приказов не отдают")`.
- [ ] **Step 1: тесты** (`tests/game.rs`):
  - `legacy_unchanged`: игра `Mode::Legacy` на Зееловском — тот же `digest` после 24 ч, что до этапа (константа,
    снятая на `main`);
  - `agents_mode_player_is_high_command`: `Mode::Agents` за советскую сторону — `su_stavka` `Control::Player`,
    `su_1bf` и армии — `Control::Agent`; `issue_historical("stavka-11059")` — через ≤ 92 ч у дивизий 1 БФ приказы
    от своих корпусов;
  - `over_head_marks_and_notifies`: директива игрока дивизии под корпусом — `led_div`, документы `Notice` у
    корпуса, армии и фронта; следующая директива корпуса эту дивизию не задаёт (Review Focus 5);
  - `take_and_release`: `take("su_8gva")` — армия не решает сама; `release` — решает в следующий свой цикл, в час
    возврата не больше одной директивы каждому подчинённому (Review Focus 4);
  - `hybrid_historical_keeps_script`: `Mode::Hybrid`, `issue_historical("stavka-11059")` — дивизии 1 БФ получают
    приказы сценария (как в `Legacy`), а не агентов;
  - `high_command_not_orderable`: `order` с `su_stavka` — ошибка.
- [ ] **Step 2:** запустить — падают. **Step 3:** реализовать (Tauri: `mode` по умолчанию `legacy`, редактор не
  меняется до этапа 3). **Step 4:** проходят; `cargo test --release -q -p agents-core`, `cargo build -p agents-tauri`
  — зелёные.
- [ ] **Step 5:** коммит «Игра на агентной модели: режимы «агенты» и «гибрид», приказ через голову, взять и вернуть».

### Task 7: прогон «Ставка подаёт исторические директивы»

**Files:**
- Modify: `crates/agents-core/src/bin/agents-run.rs` (флаги `--command agents|hybrid --side su|de|both`)
- Test: `crates/agents-core/tests/game.rs`

**Interfaces:**
- Consumes: `Game::start_free(…, mode)`, `Game::issue_historical` (задача 6).
- Produces: `agents-run --command agents --side su` — игра с часа 0 за выбранную сторону, все исторические
  директивы стороны подаются в свой час, ход до конца сценария; отчёт и `trace.json` — как у обычного прогона
  (`score.ts` считает итог без изменений).
- [ ] **Step 1: тест** `historical_directives_run`: Зееловский сценарий, `Mode::Agents`, сторона su, все
  исторические директивы — 96 ч без паники; к концу больше половины советских дивизий продвинулись на запад
  (положение `x` меньше исходного); `Mode::Hybrid` с теми же директивами — `digest` равен прогону по сценарию
  (все директивы исторические → всё ведут приказы сценария).
- [ ] **Step 2:** запустить — падает. **Step 3:** флаги и цикл подачи. **Step 4:** проходит.
- [ ] **Step 5:** снять итоги: `agents-run --command agents --side su` и `--command hybrid --side su` на трёх
  сценариях, `score.ts` по каждому; записать в сообщение коммита (итог «агенты» ниже «по сценарию» — ожидаемо до
  этапа 2б, это исходная точка для калибровки).
- [ ] **Step 6:** коммит «Прогон «Ставка подаёт исторические директивы»: режимы «агенты» и «гибрид»».

### Task 8: описание системы, нормативы, выжимка

**Files:**
- Modify: `docs/system.md` (часть I, раздел 6 «Игра на агентной модели» и раздел 7; часть II — где описана агентная
  модель: слаженность, прохождение приказа), `docs/system.pdf`, `docs/system.docx`,
  `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`, `docs/norms-check.md`

- [ ] **Step 1:** описание: директива и её поля; два способа прохождения с числами и источниками; слаженность и её
  влияние; управление штабом (агент / игрок / сценарий), приказ через голову с извещением, взять/вернуть; режимы
  игры (в интерфейсе пока недоступны — этап 3: сказать «режимы ядра», без дат и названий веток); итоги прогона
  задачи 7 — из свежего прогона.
- [ ] **Step 2:** `npm run docs:system` (`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`),
  `npm run kb:seed`, `npm run model:index`, `npm run sim:norms -- --doc docs/norms-check.md`.
- [ ] **Step 3:** `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`,
  `cargo test --release -q -p agents-core 2>&1 | grep "test result"` — зелёные.
- [ ] **Step 4:** коммит «Описание: каркас штабов-агентов, прохождение приказа, режимы игры» и
  `git push -u origin claude/command-levels-2`.
