# История как замысел — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Режим `intent` («История как замысел»): исторические распоряжения обеих сторон подаются цепочками, пока имеют
смысл; армия, ушедшая от истории, переходит к командующему, который ставит ей задачи по объектам плана своего фронта;
режим — по умолчанию в «Переигровке» и в «Принять командование».

**Architecture:** Новый модуль ядра `crates/agents-core/src/intent/` (цепочки, условия смысла, след эталона, подача,
уход и возврат) вызывается в фазе командования вместо подачи по часам (`control::feed`) для советских распоряжений и
как пропускник приказов сценария (`world.rs` шаг 0) для немецких. Командующие (`commander/`) в этом режиме решают только
за армии вне истории; новый вариант «задача армии на объект плана». Ход прогона пишет состояние каждого штаба.

**Tech Stack:** Rust (agents-core, agents-run, agents-game, agents-tauri), TypeScript (packages/sim, apps/editor на React), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-10-29-history-intent-design.md`

## Global Constraints

- Режим `intent` («История как замысел») — по умолчанию: «Переигровка» → «Советские штабы»; окно «Принять командование» → своя сторона и противник.
- Пороги: уход дальше `intent.leaveKm` = 30 км от исторического места; возврат ближе `intent.returnKm` = 15 км; «не дальше двух суточных переходов» (`march.enemyTerritoryKmDay` по виду армии × 2); выполнение — в пределах `contactKm`.
- Эталон: среднее положение армий по часам за 10 seed прогона `intent` без вмешательства, файл `<сценарий>.intent-track.json` рядом со сценарием, с отпечатком входа.
- Старые режимы (`script`, `agents`, `hybrid`, `fronts`, `journals`, `commanders`) — прежние отпечатки `SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST`.
- Мерило 1: Берлинская, 20 seed — итог не ниже «фронтов по истории» − 0,02; котёл 9-й армии — в доле прогонов не меньше, чем при немцах по приказам сценария.
- Мерило 2: четыре вмешательства (3 гв. ТА не поворачивает на Берлин; 1 гв. ТА снята; Гитлер разрешает 9 А отход 20.04; 1 БФ задержан на сутки у Зеелова) — признаки правдоподобия.
- Правила CLAUDE.md: язык — русский; `docs/system.md` и снимки (Playwright, 1440×900, JPEG); `docs:system`, `kb:seed`, `model:index`; новые параметры — строки `norms.json` + `sim:norms`; перед коммитом `npm run typecheck`, `npm test`; вывод проверок — только итог.
- Ветка `claude/desktop-app`; в main — по просьбе пользователя.

## Review Focus

1. **Принятие командования посреди операции** (игра с часа T): задачи цепочек до T не подаются повторно, штаб игрока и его подчинённые сняты с истории, соседи продолжают. Тест — задача 3, `takeover_mid_operation`.
2. **Армия, которой нет в эталоне** (новая по правке «Редактора», другая операция без следа) — без проверки ухода по расстоянию, без паники. Тест — задача 3, `army_without_track_no_leave`.
3. **Правки «Редактора» не устаревают эталон**: отпечаток — по файлу сценария, не по правкам; след с чужим отпечатком — уход по расстоянию выключен с предупреждением в журнале. Тест — задача 2, `track_fingerprint`.
4. **Старые ходы прогона и сохранённые игры без поля `intent`** — интерфейс не падает, бейдж состояния не показывается. Тест — задача 6, `no-intent-trace`.
5. **Игрок за немецкую сторону** (`player = De`): советская сторона по истории как замыслу, взятый немецкий штаб снят с истории. Тест — задача 5, `intent_game_player_de`.

---

### Task 1: Цепочки и условия смысла

**Files:**
- Create: `crates/agents-core/src/intent/mod.rs`, `crates/agents-core/src/intent/chain.rs`, `crates/agents-core/src/intent/sense.rs`
- Modify: `crates/agents-core/src/lib.rs` (`pub mod intent;`), `packages/sim/data/rules/agents-v0.json` (раздел `intent`: `leaveKm` 30 [15, 60], `returnKm` 15 [5, 30], `reachDays` 2 [1, 3] — `value/range/note`, допущения), `crates/agents-core/src/rules.rs` (`Rules.intent: IntentRules { leave_km, return_km, reach_days }`), `packages/sim/data/rules/norms.json` (строки `intent-*` как допущения)
- Test: `crates/agents-core/tests/intent.rs`

**Interfaces:**
- Produces:
  - `pub enum Step { Dir(Directive) /* советская: Ставка→фронт или фронт→армия */, Order(ScriptOrder) /* немецкий приказ сценария */ }`
  - `pub enum Goal { Attack, Defend, Withdraw, Move }` — вид задачи (из `directive::Task` или `OrderKind`; `Hold` → `Defend`).
  - `pub struct Task { pub at: u32, pub step: Step, pub goal: Option<XY> /* пункт или середина рубежа */, pub kind: Goal }`.
  - `pub struct Chain { pub owner: u32 /* штаб-получатель: армия (советская) или армия-владелец немецких дивизий */, pub tasks: Vec<Task>, pub next: usize }`
  - `pub fn build(sim: &Sim, side: Side) -> Vec<Chain>` — советские: из `sim.historical` (Ставка и фронты, без `:journal`), получатель-армия (фронт для директив Ставки); немецкие: из `sim.script` приказы штабов стороны De, сгруппированные по армии-владельцу получателей (подняться по `parent` до `Echelon::Army`; нет армии — сам штаб).
  - `pub enum Reason { Taken, Behind, TooFar, OwnLost, RetreatCut, Unfit, Strayed { km: f64 }, ChainEnd, Player }` и `pub fn reason_text(r: &Reason) -> String` («объект уже взят», «объект позади армии», «объект дальше двух переходов», «рубеж потерян», «путь отхода перерезан», «армия не способна выполнять», «армия в N км от исторического места», «цепочка кончилась», «под командованием игрока»).
  - `pub fn sense(sim: &Sim, owner: u32, t: &Task) -> Result<(), Reason>` — правила спецификации раздел 1.4: Attack/Move — цель впереди по направлению армии (угол между направлением армии к цели и её осью ≤ 90°; ось — от исторического начала к цели, иначе к цели), у противника (нет своих дивизий в пределах `contactKm`), не дальше `reach_days × enemyTerritoryKmDay(вид)`; Defend/Hold — рубеж у своих (своя дивизия в пределах `contactKm`, нет противника ближе); Withdraw — нет дивизий противника в пределах `contactKm` от отрезка «армия — рубеж»; общая — у армии есть живые дивизии, большинство не `cut_since`, средняя слаженность > `attackStop` порога.
  - `pub fn done(sim: &Sim, owner: u32, t: &Task) -> bool` — центр армии в пределах `contactKm` от цели (Attack/Move/Withdraw); Defend — никогда (только по часу).

- [ ] **Step 1: Падающие тесты** (`tests/intent.rs`, Берлинская): `chains_built` — у `su_8gva`, `su_1gta`, `su_3gta` цепочки по возрастанию часа, число задач советской стороны = числу распоряжений фронтов и Ставки без `:journal`; у немецкой стороны есть цепочка армии `de_9a`; `sense_attack_cases` — вручную поставленные дивизии: цель впереди у противника → Ok; своя дивизия у цели → `Taken`; цель за спиной → `Behind`; цель в 3 переходах → `TooFar`; `sense_withdraw_cut` — противник на пути → `RetreatCut`; `sense_unfit` — большинство дивизий `cut_since` → `Unfit`; `done_on_reach`; `intent_rules_load` — значения и пределы из `agents-v0.json`, поправка `{"intent.leaveKm": 40}` применяется.
- [ ] **Step 2:** `cargo test -p agents-core --test intent 2>&1 | tail -5` — не компилируется.
- [ ] **Step 3:** Реализовать `chain.rs`, `sense.rs`, правила.
- [ ] **Step 4:** Тесты зелёные; `cargo test -p agents-core 2>&1 | grep "test result"` — прежние отпечатки.
- [ ] **Step 5:** `npm run sim:norms -- --doc docs/norms-check.md`, `npm run kb:seed`, `npm run model:index`; коммит `feat(история как замысел): цепочки задач и условия смысла`.

### Task 2: След эталона

**Files:**
- Create: `crates/agents-core/src/intent/track.rs`
- Modify: `crates/agents-core/src/bin/agents-run.rs` (`--intent-track <путь>`: прогнать `--runs N` в режиме `intent` и записать след)
- Test: `crates/agents-core/tests/intent.rs`

**Interfaces:**
- Produces:
  - `pub struct Track { pub fingerprint: String, pub hours: u32, pub armies: BTreeMap<String /* id штаба */, Vec<Option<LngLat>>> }` (serde, camelCase).
  - `pub fn fingerprint(scenario_text: &str) -> String` — 16-значный hex от FNV-1a (или существующего хеша крейта) текста файла сценария; правки «Редактора» в отпечаток не входят.
  - `pub fn record(traces: &[Value /* trace.json */]) -> Track` — среднее по прогонам центров армий (живые дивизии, подъём по `parent`) по часам.
  - `pub fn load(scenario_path: &str) -> Option<Track>` — файл `<сценарий без .json>.intent-track.json`; отпечаток не совпал → `None` и запись в `sim.journal`: «след эталона устарел — уход по расстоянию выключен».
  - `impl Track { pub fn at(&self, hq_id: &str, tick: u32) -> Option<LngLat> }`.
- Данные: `packages/sim/data/scenarios/agents/berlin-1945.intent-track.json`, `vistula-oder-1945.intent-track.json` — собираются после задачи 3 (шаг 6 задачи 3), до того след отсутствует (уход по расстоянию выключен — `Reason::NoTrack` не ставится, просто нет проверки).

- [ ] **Step 1: Тесты:** `track_record_mean` (два фиктивных хода → среднее центров); `track_fingerprint` (Review Focus 3: отпечаток по тексту сценария; `load` с чужим отпечатком → `None`; правки `EditsIn` не меняют отпечаток); `track_at_missing` (нет армии или часа → `None`).
- [ ] **Step 2–4:** не компилируется → реализовать → зелёные.
- [ ] **Step 5:** Коммит `feat(история как замысел): след эталона`.

### Task 3: Подача, уход и возврат

**Files:**
- Create: `crates/agents-core/src/intent/dispatch.rs`
- Modify: `crates/agents-core/src/world.rs` (`Sim.intent: crate::intent::State`; в шаге 0 приказы сценария стороны с включённым `intent` идут через `intent::gate`), `crates/agents-core/src/command/control.rs` (`command_mode(sim, "intent", side)`: как `fronts` для советской стороны — фронты и Ставка `Control::Script`, армии и ниже `Agent`; немецкие штабы — `Script`; `intent::enable(sim, side)`; возвращает пустой список — подаёт `intent::step`), `crates/agents-core/src/command/agent.rs:124` (`phase`: до решений штабов — `crate::intent::step(sim, tick)`), `crates/agents-core/src/trace.rs` (поле `intent`, только если режим включён)
- Test: `crates/agents-core/tests/intent.rs`

**Interfaces:**
- Consumes: задачи 1–2.
- Produces:
  - `pub enum Status { History, Shifted, Own }`; `pub struct HqState { pub status: Status, pub reason: Option<Reason>, pub since: u32 }`.
  - `pub struct State { pub enabled: [bool; 2], pub chains: Vec<Chain>, pub hq: Vec<HqState> /* по штабам мира */, pub track: Option<Track>, pub log: Vec<(u32, u32 /* штаб */, Status, Option<Reason>)> }`.
  - `pub fn enable(sim: &mut Sim, side: Side)` — строит цепочки, грузит след по пути сценария (`Meta`), ставит всем `History`.
  - `pub fn step(sim: &mut Sim, tick: u32)` — для каждой цепочки с владельцем на истории: подать задачу при `at <= tick` или `done(предыдущей)`; без смысла — пропустить (статус `Shifted`, причина) и взять следующую; подача — `passing::issue` (советская; через `control::with_axis`) или постановка в очередь приказов сценария (немецкая); уход: расстояние до `track.at` > `leaveKm` → `Own`, `Strayed { km }`; в цепочке не осталось задачи со смыслом → `Own`, `ChainEnd`; у немецкой армии при уходе — `Control::Agent` её и подчинённых; возврат: `Own`, расстояние < `returnKm` и у задачи на этот час есть смысл → `History`, немецкие — обратно `Script`.
  - `pub fn gate(sim: &Sim, o: &ScriptOrder) -> bool` — немецкий приказ сценария проходит, только если его армия на истории и задача имеет смысл (иначе отбрасывается — его заменяет цепочка или командующий).
  - `pub fn off_history(sim: &Sim, hq: u32) -> bool`; штаб игрока (`Control::Player`) и все его подчинённые — всегда `Own`, `Reason::Player`.
  - Ход прогона: `intent: [{ hq, changes: [{ tick, status: "history"|"shifted"|"own", reason: string|null }] }]`.

- [ ] **Step 1: Тесты:** `issue_by_hour` (без вмешательства задача подана в свой час, получатель — армия); `issue_on_done` (армию поставили на объект раньше — следующая подана сразу, статус `Shifted`); `skip_senseless` (объект занят своими → задача пропущена, взята следующая); `leave_and_return` (армию сдвинули на 35 км от следа → `Own`, `Strayed`; вернули на 10 км → `History`); `german_leave_to_agent` (немецкая армия ушла → её штаб `Control::Agent`, приказы сценария её дивизиям не проходят `gate`); `takeover_mid_operation` (Review Focus 1: игра с часа 72, игрок взял `su_1bf` → его армии `Own` «под командованием игрока», задачи до 72 ч не подаются повторно, `su_1uf` продолжает цепочки); `army_without_track_no_leave` (Review Focus 2: армии нет в следе → нет ухода по расстоянию, прогон идёт); `intent_no_intervention_digest` (два прогона 48 ч с одним seed — одинаковый отпечаток); старые режимы — прежние отпечатки.
- [ ] **Step 2–4:** не компилируется → реализовать → зелёные.
- [ ] **Step 5:** `cargo build --release -p agents-core --bin agents-run`; `agents-run --scenario packages/sim/data/scenarios/agents/berlin-1945.json --command intent --seeds 1-10 --intent-track packages/sim/data/scenarios/agents/berlin-1945.intent-track.json` (и Висло-Одерская) — Expected: два файла следа.
- [ ] **Step 6:** Замер `calibrate.ts --measure --mode intent --seeds 1-20` (добавить режим `intent` в калибровщик: `--command intent`, без `--side`) — Expected: итог ≥ 0,70; если ниже — записать числа и причину в отчёт, не подгонять.
- [ ] **Step 7:** Коммит `feat(история как замысел): подача цепочек, уход и возврат, след эталона Берлинской и Висло-Одерской`.

### Task 4: Командующие за армии вне истории

**Files:**
- Modify: `crates/agents-core/src/commander/decide.rs` (`active`: при включённом `intent` стороны допускает `Control::Script` у фронта; варианты строятся только для армий `intent::off_history`; нет таких — решения нет), `crates/agents-core/src/commander/options.rs` (`Kind::Assign { army: u32, at: XY, from_plan: bool }`), `crates/agents-core/src/commander/options_su.rs` (вариант `Assign` для каждой армии вне истории без действующей задачи или с выполненной), `crates/agents-core/src/commander/apply.rs` (`Assign` → `Directive` фронта армии `Task::Attack`, ближайшая задача — точка, `named_hq`), `crates/agents-core/src/commander/trace.rs` (вид `assign`)
- Test: `crates/agents-core/tests/intent.rs`

**Interfaces:**
- Consumes: `intent::off_history`, `intent::State.chains` (объекты плана — `goal` всех задач цепочек фронта).
- Produces:
  - `pub fn plan_objectives(sim: &Sim, front: u32) -> Vec<XY>` (в `intent/mod.rs`) — цели всех задач цепочек армий фронта.
  - Выбор объекта для `Assign`: ближайший из `plan_objectives` впереди в полосе армии (угол к оси ≤ 60°, у противника, не дальше `reach_days` переходов) → `from_plan: true`; нет — правило по местности: ближайший населённый пункт (`theatre.areas`, центр кольца) или мост на оси армии на глубине одного суточного перехода → `from_plan: false`.
  - Немецкие армии вне истории решают по нынешним `options_de` (без изменений).

- [ ] **Step 1: Тесты:** `commander_silent_on_history` (все армии на истории → у Жукова нет решений); `assign_from_plan` (армию увели с истории, впереди объект плана → `Assign` с `from_plan: true` выбран и подан, армия получает директиву); `assign_terrain_fallback` (объектов плана впереди нет → `from_plan: false`, точка — населённый пункт или мост); `no_idle_army` (вмешательство: армию сняли с истории на 48 ч прогона — нет промежутка больше 24 ч, когда у неё нет задачи — по документам штаба).
- [ ] **Step 2–4:** → зелёные; отпечатки старых режимов и прежние тесты командующих не меняются (`active` и `Assign` действуют только при включённом `intent`).
- [ ] **Step 5:** `npm run model:index`; коммит `feat(история как замысел): командующие за армии вне истории — задачи по объектам плана`.

### Task 5: Режим в прогонах, игре, мосте, калибровщике

**Files:**
- Modify: `crates/agents-core/src/bin/agents-run.rs` (`--command intent`: обе стороны), `crates/agents-core/src/bin/agents-game.rs` и `crates/agents-tauri/src/lib.rs` (`run_scenario` с `command: "intent"`), `crates/agents-core/src/game.rs` (`Mode::Intent`: обе стороны — `command_mode("intent")` + командующие обеих сторон; игрок берёт штаб существующим `take` → `Control::Player`; противник `"intent"` — то же для его стороны), `packages/sim/src/agents.ts` (`AgentTrace.intent?: { hq: string; changes: { tick: number; status: 'history' | 'shifted' | 'own'; reason: string | null }[] }[]`), `packages/sim/src/game.ts` (`GameMode` + `'intent'`), `apps/editor/src/sim/game-protocol.ts:52` (`EnemyMode` + `'intent'`), `packages/sim/tools/agents/calibrate.ts` (режим `intent`)
- Test: `crates/agents-core/tests/intent.rs`, `crates/agents-core/tests/game.rs`, `packages/sim/tests/agents.test.ts`

**Interfaces:**
- Consumes: задачи 3–4.
- Produces: режим `intent` во всех точках входа; `Mode::Intent`.

- [ ] **Step 1: Тесты:** `intent_mode_both_sides` (`command_mode` для обеих сторон: советские фронты `Script`, армии `Agent`, немецкие `Script`, `intent.enabled = [true, true]`); `intent_game_take` (игра `Mode::Intent`, игрок взял `su_1bf` → его поддерево `Own`, `su_1uf` на истории); `intent_game_player_de` (Review Focus 5: игрок за немцев, взял `de_9a` → снят с истории, советская сторона по цепочкам); vitest — разбор хода с полем `intent` и без него.
- [ ] **Step 2–4:** → зелёные; `node scripts/agents-bridge.mjs --check` — проверяет и `intent`.
- [ ] **Step 5:** Коммит `feat(история как замысел): режим в прогонах, игре, мосте и калибровщике`.

### Task 6: Интерфейс и умолчания

**Files:**
- Modify: `apps/editor/src/sim/agent-scenarios.ts` (`AGENT_COMMANDS`: `intent` «История как замысел» первым; `DEFAULT_AGENT_COMMAND = 'intent'`), `apps/editor/src/CommandView.tsx` (`savedGameMode` по умолчанию `'intent'`, вариант «История как замысел» в окне; противник по умолчанию `'intent'`, вариант «История как замысел» в выборе противника; голосовые действия `command.gameMode`, `command.enemyMode` — новый вариант и фразы «история как замысел»), `apps/editor/src/formation-card.ts` / `FormationCard.tsx` (бейдж состояния штаба на выбранный час: «по истории» / «по истории со сдвигом» / «сам: <причина>»), `apps/editor/src/commander-view.ts` (`answer`: вопрос «почему не как в истории?» → причина ухода и час; подсказка в `SUGGESTIONS`), `apps/editor/src/CommanderPanel.tsx` (строка состояния истории)
- Test: `apps/editor/tests/intent-view.test.ts`, `apps/editor/tests/agents-command.test.ts`, `apps/editor/tests/voice-completeness.test.ts`, `apps/editor/tests/commander-view.test.ts`

**Interfaces:**
- Consumes: `AgentTrace.intent`.
- Produces: `intentAt(trace: AgentTrace, hq: string, tick: number): { status: 'history' | 'shifted' | 'own'; reason: string | null; since: number } | null` (в `commander-view.ts` или новом `intent-view.ts`).

- [ ] **Step 1: Тесты:** `intentAt` берёт последнее изменение не позже часа; `no-intent-trace` (Review Focus 4: ход без `intent` → `null`, бейджа нет, ответ «почему не как в истории?» — «в этом прогоне история как замысел не использовалась»); умолчания: `DEFAULT_AGENT_COMMAND === 'intent'`, `savedGameMode()` без сохранённого → `'intent'`, противник по умолчанию `'intent'`; голосовые фразы учтены.
- [ ] **Step 2–4:** → зелёные; `npm run typecheck 2>&1 | tail -3`.
- [ ] **Step 5:** Живая проверка через мост: «Переигровка» по умолчанию «История как замысел», карточка армии с бейджем; окно «Принять командование» с умолчаниями — снимки `evals-out/ui/intent-*.jpg` (Playwright, 1440×900, JPEG), посмотреть самому.
- [ ] **Step 6:** Коммит `feat(история как замысел): интерфейс, умолчания, вопрос «почему не как в истории»`.

### Task 7: Вмешательства и признаки правдоподобия

**Files:**
- Create: `packages/sim/data/scenarios/agents/berlin-1945.interventions.json`, `packages/sim/tools/agents/interventions.ts`
- Modify: `crates/agents-core/src/bin/agents-run.rs` (`--intervene <файл> --case <id>`), `crates/agents-core/src/intent/mod.rs` (`pub fn intervene(sim: &mut Sim, case: &Value) -> Result<(), String>`)
- Test: `crates/agents-core/tests/intent.rs`, `packages/sim/tests/interventions.test.ts`

**Interfaces:**
- Produces:
  - Вмешательство — список действий: `{ "hold": { "hq": id, "from": час, "hours": N } }` — поддерево штаба с `from` под «игроком», держит рубеж N ч, затем снова по истории; `{ "remove": { "hq": id } }` — дивизии штаба выведены с начала; `{ "drop": { "to": id, "after": час, "near": [lng, lat], "km": R } }` — распоряжения получателю после часа с целью в пределах R км от точки не существуют (замысел изменён); `{ "permit": { "army": id, "at": час } }` — немецкая армия получает разрешение на отход в этот час (приказы отхода её дивизиям к рубежу из её цепочки отхода или на 20 км в тыл).
  - Случаи: `no-3gta-berlin` (`drop` su_3gta после 20.04 у Берлина 25 км), `no-1gta` (`remove` su_1gta), `permit-9a` (`permit` de_9a 20.04 12:00), `delay-1bf` (`hold` su_1bf с 16.04 05:00 на 24 ч).
  - `interventions.ts --seeds 1-10`: прогон без вмешательства и каждого случая; признаки: `idleMaxHours` (наибольший промежуток без задачи у любой армии), `frontAdvanceKm` (продвижение центров советских фронтов за операцию), `berlin` (взят — советские дивизии в кольце `cityRings` центра, или окружён), `untouchedKm48` (средняя разница положений армий, не затронутых случаем, в первые 48 ч после вмешательства против прогона без него), `reasons` (доля уходов с истории с причиной = 1); отчёт `evals-out/reports/interventions.md`.
- [ ] **Step 1: Тесты:** Rust — каждый вид действия меняет мир как описано (`hold` ставит `Control::Player` и снимает через N ч; `remove` убирает дивизии; `drop` убирает задачи из цепочки; `permit` даёт приказы отхода); vitest — признаки на маленьком фиктивном ходе.
- [ ] **Step 2–4:** → зелёные.
- [ ] **Step 5:** Прогон четырёх случаев на 10 seed; Expected для каждого: `idleMaxHours ≤ 24`, `frontAdvanceKm > 0`, `berlin` взят или окружён, `reasons = 1`, `untouchedKm48` меньше, чем у затронутых армий; несоответствия — в отчёт с разбором, не подгонять.
- [ ] **Step 6:** Коммит `feat(история как замысел): вмешательства и признаки правдоподобия`.

### Task 8: Замеры, контроль, описание

**Files:**
- Modify: `docs/system.md` (часть I — режим «История как замысел» в «Переигровке» и в «Принять командование», умолчания, бейдж состояния; часть II — новый раздел модели «история как замысел»: цепочки, условия смысла, эталон, уход и возврат, командующие за армии вне истории, объекты плана; результаты: мерило 1 на 20 seed рядом с «фронтами по истории», «штабами-агентами», «командующими»; мерило 2 — таблица признаков по четырём случаям; Висло-Одерская), `docs/img/*.jpg` (снимки: «Переигровка» с режимом по умолчанию и бейджем; окно «Принять командование»), `docs/norms-check.md`, `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`, `docs/system.pdf`, `docs/system.docx`
- [ ] **Step 1:** Замеры: Берлинская 20 seed — `intent`, `fronts`, `agents`, `commanders`; Висло-Одерская 5 seed — `intent`, `fronts`; котёл 9-й армии — доля прогонов; Expected: мерило 1 выполнено, иначе — честно в описании.
- [ ] **Step 2:** Признаки правдоподобия из задачи 7 — в описание.
- [ ] **Step 3:** Описание, снимки, `npm run sim:norms -- --doc docs/norms-check.md`, `npm run kb:seed`, `npm run model:index`, `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system`.
- [ ] **Step 4:** `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `cargo test -p agents-core 2>&1 | grep "test result"`, голос — `node scripts/voice-e2e.mjs --only game` в фоне (итог `grep -c '^ok'`; падение «тур по командованию» было и до этапа).
- [ ] **Step 5:** Коммит `docs(история как замысел): описание, результаты, снимки` и пуш `git push -u origin claude/desktop-app`.
