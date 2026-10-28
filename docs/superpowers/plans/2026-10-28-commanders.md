# Командующие: субъектные агенты верхних ступеней. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Командующие фронтов, групп армий, немецких армий и ставка Гитлера — агенты на правилах в ядре: характер,
мотивы, картина обстановки с туманом, варианты из обстановки, оценка, проигрывание «в уме»; режим прогона
`commanders`; в интерфейсе — вкладка «Командующий», слой замысла на карте, график состязания, разговор.

**Architecture:** Новый модуль `crates/agents-core/src/commander/` стоит над нынешними штабами: в фазе командования
(`command::agent::phase`) раз в свой цикл командующий строит картину обстановки, меню вариантов, оценивает их и
превращает выбранный в `Directive` своей ступени (или в ответ на запрос отхода) через существующие механизмы
(`passing::issue`, `role_hq`, `named_hq`, `requests`). Профили и параметры — `packages/sim/data/rules/commanders.json`,
вкладывается в дерево правил под ключ `commanders`, поэтому поправки калибровщика (`commanders.profiles.zhukov.traits.risk`)
работают нынешним `apply_overrides`. Разбор каждого решения пишется в `trace.json` (поле `commanders`); интерфейс и
разговор строятся только из записанного разбора.

**Tech Stack:** Rust (agents-core, agents-run, agents-tauri), TypeScript (packages/sim, apps/editor на React), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-10-28-commanders-design.md` (макет — `docs/superpowers/specs/2026-10-28-commanders-ui.jpg`)

## Global Constraints

- Подход А: правила в ядре, без языковой модели — и в решениях, и в разговоре.
- Агенту можно знать: характер и мотивы (с источником), политические цели на начало, устав, опыт 1943–45. Нельзя:
  решения и сроки Берлинской операции — ни календарных условий, ни имён исторических решений, ни номеров приказов.
- Характер — пять чисел 0…1: `risk`, `persistence`, `ambition`, `lossTolerance`, `obedience`; у каждого `value`,
  `range`, `source`, `confidence` (`high|medium|low|assumption`).
- Циклы: фронт и группа армий — 12 ч, армия — 6 ч, ставка Гитлера — 24 ч; плюс триггеры (прорыв, угроза окружения, новый приказ старшего).
- «В уме» — 24–36 ч (`lookaheadHours`), выключаемо (0 — выкл.); с включённым — прогон не медленнее чем вдвое.
- Нынешние режимы `script`, `agents`, `hybrid`, `fronts`, `journals` дают те же отпечатки (`SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST`), что до этапа.
- Висло-Одерская — те же профили Жукова и Конева, без отдельной настройки.
- Язык интерфейса, документов, описания и коммитов — русский; в `docs/system.md` нет дат и упоминаний ассистента.
- Правила CLAUDE.md: `docs/system.md`, снимки (Playwright, 1440×900, JPEG), `docs:system`, `kb:seed`, `model:index`,
  `norms.json` + `sim:norms`; перед коммитом `npm run typecheck` и `npm test`; вывод проверок — только итог.
- Ветка `claude/desktop-app`; в main — только по просьбе пользователя.

## Review Focus

1. **Штаб без профиля** (армия Висло-Одерской без командующего, игровой сценарий без `commanders.json`-записи) — штаб решает по нынешним правилам, прогон не падает. Тест — задача 6, `hq_without_profile_keeps_staff_rules`.
2. **Игрок занял место командующего** (`Control::Player`) — командующий молчит, запросы отхода к игроку-верхней инстанции не отвечаются агентом. Тест — задача 6, `player_seat_silences_commander`.
3. **Соперник или объект отсутствуют** (2 БФ без соперника, Висло-Одерская без Берлина в объектах; соперник разбит/без штаба) — мотив «опередить» равен 0, вариант «повернуть на объект соперника» не появляется. Тест — задача 4, `no_rival_no_turn_option`.
4. **Пустой разбор на выбранный час** (ползунок до первого решения, штаб без командующего, трассы прежних режимов без поля `commanders`) — вкладка показывает «командующий ещё не решал», разговор отвечает «не знаю», график не падает. Тест — задача 9, `empty-commander`.
5. **Поправка калибровщика на неизвестного командующего или черту** — ошибка с путём, а не тихий пропуск; значение вне `range` — ошибка. Тест — задача 1, `override_outside_range_fails`.

---

### Task 1: Профили командующих и загрузка

**Files:**
- Create: `packages/sim/data/rules/commanders.json`
- Create: `crates/agents-core/src/commander/mod.rs`, `crates/agents-core/src/commander/profile.rs`
- Modify: `crates/agents-core/src/rules.rs` (`Rules` — поле `commanders: CommanderRules`; `load_with` — вложить файл под ключ `commanders` до `apply_overrides`), `crates/agents-core/src/lib.rs` (`pub mod commander;`)
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Produces:
  - `pub enum Trait { Risk, Persistence, Ambition, LossTolerance, Obedience }`; `pub struct Traits(pub [f64; 5])` с `fn get(&self, t: Trait) -> f64`.
  - `pub enum Motive { Task, Rival, Preserve, NoEncircle, Destroy, Hold, Save }` (7); `pub struct Motives(pub [f64; 7])`.
  - `pub struct Profile { pub id: String, pub name: String, pub hqs: Vec<String>, pub traits: Traits, pub motives: Motives, pub rival: Option<String> /* id профиля */, pub objective: Option<String> /* id объекта из scenario objectives */ }`.
  - `pub struct CommanderRules { pub profiles: Vec<Profile>, pub fog: Fog, pub gains: Gains, pub weights: Weights, pub cycle: Cycle, pub lookahead_hours: u32 }`;
    `Fog { strength_error: f64, report_delay_hours: u32 }`; `Gains { rival: f64, losses: f64, flank: f64 }`;
    `Weights { uncertainty: f64, losses: f64, persistence: f64, obedience: f64 }`; `Cycle { front: u32, army: u32, high: u32 }`.
  - `impl CommanderRules { pub fn for_hq(&self, hq_id: &str) -> Option<&Profile> }`.

Схема `commanders.json` (каждое число — `{ "value", "range", "source", "confidence", "note"? }`):
`fog`, `gains`, `weights`, `cycleHours {front: 12, army: 6, high: 24}`, `lookaheadHours {value: 0}`,
`profiles.<id> { name, hqs[], traits{risk,…}, motives{task,…}, rival?, objective? }`. Профили: `zhukov` (`su_1bf`, `su_1bf_vo`,
соперник `konev`, объект `berlin`), `konev` (`su_1uf`, `su_1uf_vo`, соперник `zhukov`, объект `berlin`), `rokossovsky` (`su_2bf`),
`heinrici` (`de_hgr_weichsel`), `schoerner` (`de_hgr_mitte`), `okw` (`de_okw`), `busse` (`de_9a`), `wenck` (`de_12a`),
`graeser` (`de_4pza`, `de_4pza_vo`), `manteuffel` (`de_3pza`), `hitler` (`de_hc`), `harpe` (`de_hgr_a_vo`),
`luettwitz` (`de_9a_vo`), `himmler` (`de_hgr_weichsel_vo`), `schulz` (`de_17a_vo`). Источник у черты — биография, мемуары,
оценка историка; без опоры — `confidence: "assumption"`. На Висло-Одерской объект Жукова и Конева — их рубеж Одера
(`objective` из сценария; нет такого объекта — `None`, см. Review Focus 3).

- [ ] **Step 1: Написать падающие тесты** в `tests/commander.rs`:
  - `profiles_load`: `Rules::load(DATA)`; `rules.commanders.for_hq("su_1bf").unwrap().id == "zhukov"`; `for_hq("su_1bf_vo")` — тот же профиль; все черты в `[0, 1]` и внутри своего `range`.
  - `override_trait`: `Rules::load_with(DATA, Some(&json!({"commanders.profiles.zhukov.traits.risk": 0.3})))` → `traits.get(Trait::Risk) == 0.3`.
  - `override_outside_range_fails`: значение 1.5 → `Err` с текстом пути; `"commanders.profiles.nobody.traits.risk"` → `Err("…нет параметра…")`.
  - `no_operation_hints`: прочитать `commanders.json` и все `src/commander/*.rs`; ни одного совпадения с
    `1945-0[45]`, `\d{1,2}\.0[45]\.1945`, `(апрел|мая)\w* 1945`, `№\s*\d`, `11059`, `11060`, `11062` (номера директив Ставки),
    `поворот\w* на Берлин`, `Зеелов`. (Тест расширяется в задачах 3–5: новые файлы модуля попадают в обход папки сами.)
- [ ] **Step 2:** `cargo test -p agents-core --test commander 2>&1 | tail -5` — Expected: не компилируется (нет `commander`).
- [ ] **Step 3:** Реализовать `profile.rs` (разбор из `Value` по образцу `num()`), проверку `range` после `apply_overrides` в `load_with`, `commanders.json`.
- [ ] **Step 4:** `cargo test -p agents-core --test commander` — Expected: 4 passed; `cargo test -p agents-core 2>&1 | grep "test result"` — все прежние зелёные (отпечатки не меняются: файл только читается).
- [ ] **Step 5:** Строки норм: в `packages/sim/data/rules/norms.json` — по одной на черту с источником (`commander-zhukov-risk` …) и на `fog`/`gains`/`weights` как допущения; `npm run sim:norms -- --doc docs/norms-check.md`.
- [ ] **Step 6: Коммит** `feat(командующие): профили характера и мотивов, загрузка и поправки`.

### Task 2: Картина обстановки с туманом

**Files:**
- Create: `crates/agents-core/src/commander/picture.rs`
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: `CommanderRules.fog`, `Sim`, `World`.
- Produces:
  - `pub struct ArmyView { pub hq: u32, pub advance_km: f64, pub strength: f64 /* доля от начальной */, pub enemy_est: f64, pub enemy_true: f64, pub to_objective_km: Option<f64>, pub broke_through: bool }`
  - `pub struct RivalView { pub hq: u32, pub to_objective_km: f64, pub as_of: u32 }`
  - `pub struct PocketView { pub center: XY, pub enemy_est: f64, pub gap_km: f64, pub by: Vec<u32> /* свои и соседа армии с двух сторон */ }`
  - `pub struct Picture { pub tick: u32, pub armies: Vec<ArmyView>, pub enemy_reserves: Vec<(XY, f64)>, pub rival: Option<RivalView>, pub open_flanks: Vec<u32>, pub pockets: Vec<PocketView>, pub to_objective_km: Option<f64> }`
  - `pub fn picture(sim: &Sim, hq: u32, log: &DistLog) -> Picture`
  - `pub struct DistLog(pub Vec<Vec<(u32, f64)>>)` — по штабу: (час, до объекта, км); `pub fn record(&mut self, sim: &Sim)` раз в час.

Ошибка оценки противника — множитель `1 + e·u`, `u ∈ [-1, 1]` из `crate::rng` по `(sim.seed, hq, tick / 6)` (постоянна в пределах сводки); соперник — значение `DistLog` на час `tick − report_delay_hours`; резервы противника — только дивизии в пределах разведки (`contactKm` × 3 от своих). Прорыв (`broke_through`) — у армии нет обороняющегося противника ближе `contactKm` на оси и пройдена `doctrine.su.tankCommitDepthKm`.

- [ ] **Step 1: Падающие тесты:** `picture_error_bounded` — на берлинском сценарии через 24 ч для каждой армии 1 БФ `|enemy_est/enemy_true − 1| ≤ fog.strength_error + 1e-9`, и при `strength_error = 0` — равенство; `picture_same_seed_same` — два `picture` на одинаковых `Sim` (тот же seed) равны; `rival_delayed` — `rival.as_of == tick − report_delay_hours`.
- [ ] **Step 2:** `cargo test -p agents-core --test commander picture` — Expected: не компилируется.
- [ ] **Step 3:** Реализовать `picture.rs` (охват — через `crate::pocket` по образцу его поиска пути к своим).
- [ ] **Step 4:** Тесты зелёные.
- [ ] **Step 5: Коммит** `feat(командующие): картина обстановки с ошибкой разведки и задержкой сводок`.

### Task 3: Мотивы по обстановке

**Files:**
- Create: `crates/agents-core/src/commander/motives.rs`
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: `Profile.motives`, `Picture`, `Gains`.
- Produces: `pub fn current(base: &Motives, pic: &Picture, g: &Gains) -> Motives`.

Правила (и только они): `Rival += g.rival · max(0, (own − rival)/own)` при наличии соперника, иначе `Rival = 0`;
`Preserve += g.losses · (1 − средняя strength)`; `NoEncircle += g.flank · open_flanks.len()/armies.len()`. Остальные — как на начало.

- [ ] **Step 1: Тесты:** `rival_grows_when_rival_closer` (соперник на 20 км ближе — вес выше базы; дальше — равен базе); `preserve_grows_with_losses`; `no_rival_zero` (Review Focus 3).
- [ ] **Step 2–4:** Не компилируется → реализовать → зелёные.
- [ ] **Step 5: Коммит** `feat(командующие): мотивы меняются по обстановке`.

### Task 4: Варианты советских фронтов

**Files:**
- Create: `crates/agents-core/src/commander/options.rs` (общее: `Choice`, `Kind`), `crates/agents-core/src/commander/options_su.rs`
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: `Picture`, `Profile`, `sim.command` (`role_hq`, `intent`).
- Produces:
  - `pub enum Kind { Continue, CommitMobile { hq: u32 }, WaitMobile, ShiftMainBlow { to: Vec<u32> }, TurnToRival { hq: u32, at: XY }, Encircle { pocket: usize }, CommitSecond { hq: u32 }, Hold, Withdraw { hq: u32 }, Counterattack { from: u32, at: XY }, ShiftForces { from: u32, to: u32 }, Breakout { toward: XY }, Permit { request: usize }, Forbid { request: usize }, Relief { army: u32, toward: XY }, MoveReserve { hq: u32, to: XY } }`
  - `pub struct Choice { pub kind: Kind, pub label: String, pub contrib: Motives /* вклад в каждый мотив, −1…1 */, pub uncertainty: f64, pub losses: f64, pub rule: &'static str }`
  - `pub fn options_su(sim: &Sim, hq: u32, p: &Profile, pic: &Picture) -> Vec<Choice>`

Условия появления: `CommitMobile` — есть подвижная группа в роли `Mobile` и хотя бы одна армия главного удара продвинулась на `doctrine.su.commitDepthKm` (не обязательно прорыв — `uncertainty` выше без `broke_through`); `WaitMobile` — та же группа, нет прорыва; `ShiftMainBlow` — армия вне главного удара продвинулась больше армий главного удара на 50 %; `TurnToRival` — у профиля есть соперник и объект, своя армия ближе к объекту соперника, чем `gains`-порог (параметр `options.turnKm` в `commanders.json`); `Encircle` — `PocketView` с `gap_km < options.encircleGapKm`; `CommitSecond` — есть армия в роли `Second`; `Continue` — всегда. `rule` — статья ПУ-43/опыт (строка, без дат операции).

- [ ] **Step 1: Тесты** (обстановка собирается подменой `Picture` руками): `commit_mobile_only_after_depth`; `turn_option_needs_rival_and_objective`; `no_rival_no_turn_option` (Review Focus 3); `encircle_needs_small_gap`; `continue_always_present`.
- [ ] **Step 2–4:** Не компилируется → реализовать → зелёные; `no_operation_hints` зелёный.
- [ ] **Step 5: Коммит** `feat(командующие): варианты советских фронтов по обстановке`.

### Task 5: Варианты немецкой стороны и ставки Гитлера

**Files:**
- Create: `crates/agents-core/src/commander/options_de.rs`
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: `Choice`, `Kind` (задача 4), `sim.command.requests`.
- Produces: `pub fn options_de(sim: &Sim, hq: u32, p: &Profile, pic: &Picture) -> Vec<Choice>`; `pub fn options_high(sim: &Sim, hq: u32, p: &Profile) -> Vec<Choice>`.

Условия: армия/группа армий — `Hold` всегда; `Withdraw` — открытый фланг или охват своих (`NoEncircle`/`Save` вклад > 0); `Counterattack` — резерв в пределах 40 км от вклинения; `ShiftForces` — тихий участок (нет атак 12 ч) и угрожаемый; `Breakout` — штаб в кольце (`pocket` у своих) и есть свой штаб снаружи. Ставка Гитлера — `Permit`/`Forbid` на каждый неотвеченный запрос, `Relief` при окружённой армии и армии снаружи, `MoveReserve` при резерве ОКВ.

- [ ] **Step 1: Тесты:** `withdraw_needs_threat`, `breakout_only_in_pocket`, `high_answers_each_request` (два запроса → по паре `Permit`/`Forbid` на каждый), `relief_needs_pocket`.
- [ ] **Step 2–4:** → зелёные.
- [ ] **Step 5: Коммит** `feat(командующие): варианты немецких штабов и ставки Гитлера`.

### Task 6: Цикл решений, польза, разбор и встраивание в фазу командования

**Files:**
- Create: `crates/agents-core/src/commander/decide.rs`
- Modify: `crates/agents-core/src/world.rs` (`Sim.commanders: crate::commander::State`, `Default` — выключено), `crates/agents-core/src/command/agent.rs:124` (`phase`: до решений штабов — `crate::commander::cycle(sim, tick)`; ответ на запросы `:225-237` — только если у верхней инстанции нет командующего), `crates/agents-core/src/scenario.rs` (инициализация `State` пустой)
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: задачи 1–5.
- Produces:
  - `pub struct Commander { pub hq: u32, pub profile: usize, pub motives: Motives, pub intent: Option<Kind>, pub last: u32, pub snapshots: Vec<Snapshot>, pub decisions: Vec<Decision> }`
  - `pub struct Snapshot { pub tick: u32, pub motives: Motives, pub picture: Picture, pub intent: Option<String> }`
  - `pub struct Scored { pub choice: Choice, pub parts: Motives /* мотив × вклад */, pub penalty: f64, pub bonus: f64, pub total: f64, pub mind: Option<MindResult> }`
  - `pub struct Decision { pub tick: u32, pub trigger: String, pub options: Vec<Scored>, pub chosen: usize, pub why: String }`
  - `pub struct State { pub enabled: [bool; 2], pub list: Vec<Commander>, pub log: DistLog }`
  - `pub fn enable(sim: &mut Sim, side: Side)` — командующий на каждый штаб стороны с профилем (`for_hq`); без профиля — нет.
  - `pub fn score(c: &Choice, m: &Motives, t: &Traits, w: &Weights, continuing: bool) -> Scored`:
    `total = Σ m_i·contrib_i − (1−risk)·w.uncertainty·uncertainty − (1−lossTolerance)·w.losses·losses + persistence·w.persistence·[continuing] + obedience·w.obedience·contrib_Task`.
  - `pub fn cycle(sim: &mut Sim, tick: u32)` — запись `log`, снимок раз в 6 ч, решение по циклу ступени или триггеру; ничья (±1e-9) — продолжение; `Control::Player` у штаба — пропуск.
  - `pub fn apply(sim: &mut Sim, c: &Commander, k: &Kind, tick: u32)`: `CommitMobile` — `role_hq[hq] = Role::Committed`; `ShiftMainBlow` / `TurnToRival` / `Encircle` / `CommitSecond` — `Directive` от штаба фронта (`main_blow`, ось к цели, `named_hq` у армии частной директивы) через `passing::issue`; `Withdraw`/`Breakout` — директива армии `Task::Withdraw`/атака к цели; `Permit`/`Forbid` — `requests[i].answer`, `answered_at`, документ-извещение с `rule`; `Relief` — директива армии-деблокатору. Каждое решение — `Document` (`DocKind::Directive`/`Notice`) с текстом обоснования и правилом.
  - `why` — собирается из двух крупнейших слагаемых выбранного и разницы с вторым вариантом (шаблон, без языковой модели).

- [ ] **Step 1: Тесты:**
  - `risky_and_cautious_differ`: одна обстановка (`Picture` с армией на глубине 8 км без прорыва), Жуков с `risk 0.9` выбирает `CommitMobile`, с `risk 0.1` — `WaitMobile` (через `score` на вариантах `options_su`).
  - `decision_repeats_with_seed`: два прогона берлинского сценария в режиме `commanders` по 48 ч с одним seed → одинаковые `decisions` (тики, выбранные `kind`).
  - `hq_without_profile_keeps_staff_rules` (Review Focus 1): из профилей убран `busse` поправкой `{"commanders.profiles.busse.hqs": []}` — 48 ч без паники, у `de_9a` нет командующего, его документы — прежнего вида.
  - `player_seat_silences_commander` (Review Focus 2): `control[su_1bf] = Player` — у Жукова нет решений; `control[de_hc] = Player` — запросы отхода остаются без ответа.
  - `digests_unchanged`: прежние отпечатки (`SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST`) в прежних тестах — без изменений (командующие выключены по умолчанию).
- [ ] **Step 2–4:** не компилируется → реализовать → `cargo test -p agents-core 2>&1 | grep "test result"` — всё зелёное.
- [ ] **Step 5: Коммит** `feat(командующие): цикл решений, польза по мотивам и характеру, разбор`.

### Task 7: Проигрывание «в уме»

**Files:**
- Create: `crates/agents-core/src/commander/mind.rs`
- Modify: `crates/agents-core/src/world.rs` (`impl Sim { pub fn fork(&self) -> Sim }`)
- Test: `crates/agents-core/tests/commander.rs`

**Interfaces:**
- Consumes: `Scored`, `apply`, `Picture`.
- Produces:
  - `Sim::fork` — копия для расчёта: `theatre` (Arc), `rules`, `world`, `command`, `historical`, `script`/`fires`/`withdrawals`/`changes`, `su_staff` (клон содержимого); `llm: None`, журналы и `history` пустые, обработчики `None`, `commanders.enabled = [false; 2]` (без рекурсии).
  - `pub struct MindResult { pub hours: u32, pub advance_km: f64, pub losses: f64, pub encircled: f64 }`
  - `pub fn imagine(sim: &Sim, c: &Commander, pic: &Picture, choice: &Choice, hours: u32) -> MindResult` — в копии сила противника перед армиями приводится к `enemy_est` (масштаб людей и техники дивизий противника), вариант применяется, `hours` шагов; итог уточняет `contrib` (`Task`/`Rival` по продвижению, `Preserve` по потерям, `Destroy` по охвату).
  - В `cycle`: при `lookahead_hours > 0` — `imagine` для двух-трёх лучших по `score`, пересчёт, выбор.

- [ ] **Step 1: Тесты:** `fork_does_not_touch_original` (24 шага копии — `world` оригинала байт в байт тот же по отпечатку); `mind_off_by_default` (`lookahead_hours == 0` → у всех `Scored.mind == None`); `mind_on_fills_top` (`{"commanders.lookaheadHours": 24}` → у не более чем трёх вариантов решения `mind.is_some()`).
- [ ] **Step 2–4:** → зелёные.
- [ ] **Step 5: Замер скорости:** `time target/release/agents-run --scenario packages/sim/data/scenarios/agents/berlin-1945.json --seed 1 --runs 1 --command commanders --out evals-out/mind0` и то же с `--params '{"commanders.lookaheadHours":24}'` — Expected: второе не дольше первого вдвое; иначе — «в уме» только для двух лучших и копия без `su_staff` LLM-ветвей (записать решение в коммит).
- [ ] **Step 6: Коммит** `feat(командующие): проигрывание вариантов «в уме» на копии мира`.

### Task 8: Режим `commanders` в прогонах, игре, ходе и калибровщике

**Files:**
- Modify: `crates/agents-core/src/command/control.rs:180` (`"commanders"` — как `"agents"` + `commander::enable(sim, side)`; текст ошибки перечисляет режимы), `crates/agents-core/src/bin/agents-run.rs` (`--command commanders`; при нём — обе стороны, если `--side` не задан), `crates/agents-tauri/src/lib.rs` (то же для `command: "commanders"`), `crates/agents-core/src/trace.rs` (`describe` — поле `commanders`), `crates/agents-core/src/game.rs:22` (`Mode::Commanders`; `seat`-команда игры — занять место командующего = `Control::Player` у его штаба), `packages/sim/src/agents.ts` (типы), `packages/sim/tools/agents/calibrate.ts` (`--mode commanders`: пространство поиска строится из `commanders.json` по `range`, вместо `SPACE`)
- Test: `crates/agents-core/tests/command.rs`, `packages/sim/tests/agents-trace.test.ts` (или ближайший тест типов хода)

**Interfaces:**
- Produces (trace.json, `packages/sim/src/agents.ts`):
```ts
export interface AgentCommander {
  hq: string; profile: string; name: string; side: 'su' | 'de';
  traits: Record<'risk'|'persistence'|'ambition'|'lossTolerance'|'obedience', { value: number; range: [number, number]; source: string; confidence: string }>;
  baseMotives: Record<string, number>;
  rival: string | null; objective: string | null;
  snapshots: { tick: number; motives: Record<string, number>; intent: string | null;
    picture: { armies: { hq: string; advanceKm: number; strength: number; enemyEst: number; enemyTrue: number; toObjectiveKm: number | null; brokeThrough: boolean }[];
      rival: { hq: string; toObjectiveKm: number; asOf: number } | null; openFlanks: string[]; pockets: { center: LngLat; enemyEst: number; gapKm: number }[];
      enemyReserves: { at: LngLat; strength: number }[]; toObjectiveKm: number | null } }[];
  decisions: { tick: number; trigger: string; chosen: number; why: string;
    options: { kind: string; label: string; rule: string; target: LngLat | null; parts: Record<string, number>; penalty: number; bonus: number; total: number;
      mind: { hours: number; advanceKm: number; losses: number; encircled: number } | null }[] }[];
}
// AgentTrace: commanders?: AgentCommander[]
```
- Game: `Mode::Commanders` в разборе режима игры (`"commanders"`).

- [ ] **Step 1: Тесты:** в `tests/command.rs` — `commanders_mode_enables_both_sides` (после `command_mode(sim, "commanders", Su)` и `(…, De)`: командующие у `su_1bf`, `su_1uf`, `su_2bf`, `de_hc`, `de_9a`; Ставка — агент; исторические директивы — только от `su_stavka`); `trace_has_commanders` (48 ч → в `describe` поле `commanders` с решениями, у каждого решения `chosen < options.len()`); vitest — разбор образца trace с `commanders` и без него (`commanders` необязательно).
- [ ] **Step 2–4:** → зелёные; `cargo build --release -p agents-core --bin agents-run`.
- [ ] **Step 5: Проверка калибровщика:** `npx tsx packages/sim/tools/agents/calibrate.ts --mode commanders --samples 2 --seeds 1 --jobs 2 --out evals-out/calib/cmd-smoke` — Expected: две строки `samples.jsonl`, ключи вида `commanders.profiles.zhukov.traits.risk`.
- [ ] **Step 6: Коммит** `feat(командующие): режим commanders в прогонах, игре, ходе и калибровщике`.

### Task 9: Интерфейс: вкладка «Командующий», слой на карте, график, разговор

**Files:**
- Create: `apps/editor/src/commander-view.ts` (чистые функции), `apps/editor/src/CommanderPanel.tsx`, `apps/editor/src/CommanderOverlay.tsx`, `apps/editor/src/RivalryChart.tsx`
- Modify: `apps/editor/src/FormationCard.tsx:24` (`FormationPanel` — необязательные `tabs?: { id: string; label: string; body: ReactNode }[]`; без них — как сейчас), `apps/editor/src/ReplayView.tsx` (вкладка у штаба с командующим, слой и график при открытой вкладке; час — общий ползунок), `apps/editor/src/CommandView.tsx:2083,2098` (режим `commanders` и выбор «занять место командующего»), `apps/editor/src/sim/agent-scenarios.ts` (`AGENT_COMMANDS`: вариант `commanders` «Командующие», по умолчанию), `apps/editor/src/voice/actions/staff.ts` (действие `ask_commander { question }`, `say: ['спроси командующего', 'почему так решил']`)
- Test: `apps/editor/tests/commander-view.test.ts`, `apps/editor/tests/agents-command.test.ts`, `apps/editor/tests/voice-completeness.test.ts`

**Interfaces:**
- Consumes: `AgentCommander` (задача 8).
- Produces (`commander-view.ts`):
  - `commanderOf(trace: AgentTrace, hq: string): AgentCommander | null`
  - `viewAt(c: AgentCommander, tick: number): { snapshot: Snapshot | null; decision: Decision | null; decisions: Decision[] }` — последние на час `≤ tick`.
  - `rivalrySeries(trace: AgentTrace): { hq: string; name: string; points: [number, number][]; marks: { tick: number; label: string }[] }[]` — расстояние фронтов до объекта по снимкам, метки — решения; у немцев — «держать / отходить» 9-й армии и `Relief` 12-й.
  - `answer(c: AgentCommander, tick: number, question: string): string` — ключевые слова: «почему» → `why` + правило; «противник/знал» → `picture.armies` (оценка против истины не раскрывается — командующий говорит только оценку); «сосед/соперник» → `picture.rival` с задержкой; «другой/не выбрал» → второй вариант и разница итогов; «хочешь/сейчас» → мотивы сейчас против начала; нет разбора — «Я ещё не принимал решений к этому часу.»; не понял — «Об этом мне нечего сказать: спросите о решении, противнике, соседе или моих целях.»
  - `SUGGESTIONS = ['почему так решил?', 'что знал о противнике?', 'что думал о соседе?', 'почему не выбрал другой вариант?', 'чего хочешь сейчас?']`

Вид вкладки — по макету `2026-10-28-commanders-ui.jpg`: характер — пять полос с пунктиром пределов и источником во всплывающей подсказке; мотивы — начало и сейчас; картина обстановки — по армиям, серым — истина; лента решений; таблица вариантов выбранного решения с цветной разбивкой по мотивам; обоснование и правило; поле разговора с подсказками. Слой на карте (по образцу `AgentMark`, `engine.project`, перерисовка на `engine.on('view')`): замысел — сплошная стрелка, варианты «в уме» — пунктир, соперник как его видит командующий, группировки противника по его разведке.

- [ ] **Step 1: Тесты vitest** `commander-view.test.ts`: `viewAt` берёт последнее решение не позже часа; `answer` на каждую подсказку содержит соответствующее (`why`, имя армии, имя соперника, `label` второго варианта, название мотива); `empty-commander` (Review Focus 4): трасса без `commanders` — `commanderOf → null`, `rivalrySeries → []`; час до первого решения — ответ «ещё не принимал»; `agents-command.test.ts` — `commanders` в `AGENT_COMMANDS` и по умолчанию; `voice-completeness` — новое действие учтено.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/commander-view.test.ts` — Expected: FAIL (нет модуля).
- [ ] **Step 3:** Реализовать `commander-view.ts`, затем компоненты.
- [ ] **Step 4:** `npx vitest run apps/editor/tests/commander-view.test.ts apps/editor/tests/agents-command.test.ts apps/editor/tests/voice-completeness.test.ts` — PASS; `npm run typecheck 2>&1 | tail -3` — без ошибок.
- [ ] **Step 5: Живая проверка:** «Переигровка», Берлинская, «Командующие» → карточка 1 БФ → вкладка «Командующий»: снимок Playwright 1440×900 JPEG в `evals-out/ui/commander.jpg`, сверить с макетом (полосы, таблица, разговор отвечает на подсказку; слой и график видны).
- [ ] **Step 6: Коммит** `feat(командующие): вкладка «Командующий», слой замысла, график состязания, разговор`.

### Task 10: Калибровка характера, замеры, контроль, описание

**Files:**
- Modify: `packages/sim/data/rules/commanders.json` (подобранные значения с `note` «калибровка перебором … было → стало»), `docs/system.md` (часть I — раздел режимов агентной модели и интерфейса «Переигровки»; часть II — модель командующих: характер, мотивы, картина, варианты, польза, «в уме», перечень вложенного исторического знания, результаты), `docs/img/*.jpg` (новые снимки: вкладка «Командующий», график состязания), `docs/norms-check.md`, `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`, `docs/system.pdf`, `docs/system.docx`
- Test: прежние тесты сверки (`kb:seed`, `model:index`)

- [ ] **Step 1: Исходный замер** — 20 seed (1–20), режимы `commanders`, `agents`, `fronts` на Берлинской: `calibrate.ts --refine` с пустым сочетанием или прямые прогоны → итог, положения, события; плюс непрерывные меры (средняя ошибка положений, км; ошибка сроков событий, сутки) — дописать их в вывод `evaluate` (`agentsScore` уже даёт ошибки по точкам).
- [ ] **Step 2: Ключевые решения** — по `trace.commanders` 20 прогонов: час ввода 1 и 2 гв. ТА (до/после прорыва главной полосы), поворот 3 и 4 гв. ТА 1 УФ к Берлину, окружение 9 А, выход к 12 А — сводка «срок модели против исторического» в `evals-out/reports/commanders.md` (исторические сроки берутся из `berlin-1945-tasks.history.json` только для сверки, в ядро не идут).
- [ ] **Step 3: Калибровка** — `calibrate.ts --mode commanders --samples 150 --seeds 1,2,3 --jobs 4 --out evals-out/calib/cmd1`, затем `--around … --scale 0.15`, затем `--refine` (Берлинская 10 seed, Висло-Одерская 5). Проверка — seed 11–20. Контроль: тот же Жуков и Конев на Висло-Одерской не хуже исходного замера; если лучшее для Берлинской ухудшает Висло-Одерскую — брать компромисс и записать это в описание как признак подгонки.
- [ ] **Step 4:** Перенести подобранное в `commanders.json`; отпечатки прежних режимов не меняются (`cargo test -p agents-core`).
- [ ] **Step 5: Описание** — `docs/system.md` по разделам выше, цифры только из свежего прогона (`npm run sim:demo` и замеры шага 1 после калибровки); доля закрытого разрыва `(commanders − agents)/(fronts − agents)`; снимки Playwright 1440×900 JPEG с подписями курсивом; затем `npm run sim:norms -- --doc docs/norms-check.md`, `npm run kb:seed`, `npm run model:index`, `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system`.
- [ ] **Step 6: Полная проверка** — `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `cargo test -p agents-core 2>&1 | grep "test result"`, голос — `node scripts/voice-e2e.mjs --only staff` в фоне (итог `grep -c '^ok'`).
- [ ] **Step 7: Коммит и пуш** `feat(командующие): калибровка характера, замеры, описание` → `git push -u origin claude/desktop-app`.
