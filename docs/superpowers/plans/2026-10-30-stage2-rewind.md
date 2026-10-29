# Этап 2. Отмотка назад — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В игре после «Принять командование» можно вернуться к любому сыгранному ходу (лента ходов, голос), мир,
командование, «история как замысел», командующие, документы и очередь игрока восстанавливаются точно; продолжение после
возврата — новая ветвь, прежняя линия сохраняется как «ветвь от хода N (дата)» и видна в списке незавершённых игр.

**Architecture:** Ядро (`Game`) ведёт журнал входов хода (`TurnIn`) и полные снимки состояния через каждые 2 хода
(`Sim::snapshot` — без потерь, в отличие от `Sim::fork`, который для расчёта «в уме» отбрасывает журнал, документы и
командующих); возврат — восстановить ближайший снимок и досчитать повтором журнала, новая команда `game_rewind`. Запись
игры (`GameRecord`) уже хранит всё, что влияет на расчёт (приказы обеих сторон, включая ответы штаба противника на
модели, распоряжения, поправки посредника, директивы Ставки, команды управления, seed, данные базы на начало) — к ней
добавляется отпечаток мира по ходам, по которому повтор записи проверяется. Поток игры (`game-worker.ts`) хранит своё
состояние на начало каждого хода и умеет «вернуться» и «перейти на ветвь»; ветви хранит окно (`localStorage`, ключ
`def_ops.game`) рядом с записью.

**Tech Stack:** Rust (agents-core, agents-game, agents-tauri), TypeScript (packages/sim, apps/editor на React,
веб-поток игры), vitest, cargo test, Playwright (снимки через `scripts/agents-bridge.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-30-command-pack-design.md` (этап 2, «Проверка»)

## Global Constraints

- Язык интерфейса, описания, сообщений коммитов, текстов штаба — русский.
- Прежние отпечатки не меняются: `SEELOW_48_DIGEST = 16519880440056134377`, `LEGACY_GAME_DIGEST = 5949968270007021613`
  (`crates/agents-core/tests/command.rs`); `Sim::digest` не трогать — новый отпечаток игры складывается поверх него.
- Повтор записи не обращается к языковой модели: всё, что дала модель, берётся из записи.
- Старые сохранения (`GameRecord.version: 1` без новых полей) загружаются и продолжаются; версия записи остаётся `1`.
- Имя сохранённой линии — «ветвь от хода N (дата)», дата — начало хода N по времени игры («ветвь от хода 5 (18 апреля, 06:00)»).
- Голос: «вернись к ходу N», «вернись на ход назад», «покажи ветви»; каждая новая кнопка — через действие реестра
  (`apps/editor/tests/voice-completeness.test.ts` зелёный без новых исключений).
- Правила `CLAUDE.md`: `docs/system.md` (без дат и служебных названий веток), снимки Playwright 1440×900 JPEG с подписью
  курсивом, `npm run docs:system` (PDF и Word коммитятся), `npm run model:index` после правки `crates/agents-core/src` и
  разделов 6–7; часть II не меняется — `kb:seed` не нужен. Вывод проверок — только итог; полный `npm test` и
  `npm run typecheck` — перед коммитом.
- Ветка `claude/desktop-app`.

## Review Focus

1. **Возврат, пока ход считается** (ядро или посредник/Ставка заняты): возврат не начинается, кнопки ленты недоступны,
   голос называет причину «идёт расчёт хода — вернуться можно, когда он закончится»; ход досчитывается как обычно. Тест —
   задача 4, `rewindCheck refuses while busy`; задача 2, `rewind_after_turn_only` (ядро — по очереди под одним замком).
2. **Возврат после того, как штаб противника на модели был недоступен** (ход проведён «без его приказов»): повтор
   записи модель не зовёт, на ходу N, куда вернулись, штаб противника спрашивается заново (решение для другой
   обстановки не применяется — прежний запрос снят); недоступен снова — тот же выбор «повторить запрос / ход без его
   приказов». Тесты — задача 3, `replay of a skipped-ai turn needs no model`; задача 4, `rewind drops pending ai`.
3. **Старые сохранения без новых полей** (нет `digest`, `startDigest`, `branches`, `line`): загружаются, повтор идёт без
   проверки отпечатка, отпечатки дописываются по расчёту; лента и «Ветви» работают, ветвей — ноль. Тесты — задача 3,
   `old record without digests`; задача 5, `old save without branches`.
4. **Режимы «история как замысел» и «командующие» восстанавливаются точно**: цепочки (поданные задачи, состояния штабов,
   `led`, очередь, действия вмешательства), командующие (настроение, замысел, решения, поднятые запросы), документы,
   запросы на отход, взятые/возвращённые штабы, поданные исторические директивы (`issued`), директивы на будущий час
   (`pending`). Тест — задача 2, `rewind_exact_intent_and_commanders` (сравнение `state_key` по Debug всех этих частей).
5. **Хранилище окна переполнено** (ветви с длинными записями не помещаются в `localStorage`): запись не теряется молча —
   уведомление «Запись игры не сохранилась: в хранилище окна нет места. Удалите лишние ветви.», игра продолжается, прежняя
   сохранённая запись не испорчена. Тест — задача 5, `storeGame reports quota`.

---

### Task 1: Ход игры как вход ядра, полный снимок и отпечаток игры

**Files:**
- Create: `crates/agents-core/src/game_rewind.rs` (`TurnIn`, `TurnResult`, `impl Game { play_turn, turn_trace, state_digest }`)
- Modify: `crates/agents-core/src/lib.rs` (`pub mod game_rewind;`), `crates/agents-core/src/world.rs:248-270` (рядом с `fork` — `snapshot`),
  `crates/agents-core/src/game.rs:119-140` (поля `log`), `game.rs:299,312` (инициализация полей в обоих `Game { … }`),
  `game.rs:663-675` (`trace`: `turn`, `digest`), `crates/agents-core/src/intent/dispatch.rs:47` (`track: Option<Arc<Track>>`) и места
  присвоения `sim.intent.track = Some(…)` (`Some(Arc::new(t))`),
  `crates/agents-core/src/bin/agents-game.rs:66-81`, `crates/agents-tauri/src/lib.rs:213-237` (`game_turn` через `play_turn`)
- Test: `crates/agents-core/tests/rewind.rs`

**Interfaces:**
- Produces:
  - `#[derive(Clone, Debug, Default, serde::Deserialize)] #[serde(rename_all = "camelCase")] pub struct TurnIn { #[serde(default)] pub command: Vec<serde_json::Value>, #[serde(default)] pub staff: Option<StaffIn>, #[serde(default)] pub orders: Vec<PlayerOrder>, #[serde(default = "twelve")] pub hours: u32, #[serde(skip)] pub doctrine: Option<[Option<String>; 2]>, #[serde(skip)] pub between: Vec<CommandOp> }` — `between` заполняет задача 2.
  - `pub struct TurnResult { pub applied: Vec<Value>, pub staff_errors: Vec<String>, pub command_results: Vec<Option<String>> }`
  - `impl Game { pub fn play_turn(&mut self, t: TurnIn) -> TurnResult; pub fn turn_trace(&self, r: &TurnResult) -> Value; pub fn state_digest(&self) -> u64 }`
  - поле `pub log: Vec<TurnIn>` у `Game` (сыгранные ходы по порядку).
  - `impl Sim { pub fn snapshot(&self) -> Sim }` — копия без потерь: все поля как есть (`journal`, `documents`, `history`,
    `commanders`, `intent`, `su_staff`, `rear_dir`, `llm`, `llm_par`), кроме обработчиков `on_progress`/`on_stream` (None) и
    `llm_log` (пустой).
  - `trace()["game"]` получает `"turn": log.len()` и `"digest": format!("{:016x}", state_digest())` (строка: u64 не помещается в число JS).

`play_turn` — дословно нынешний порядок `game_turn` (доктрина → команды → распоряжения → приказы → `advance(hours)`), затем
`self.log.push(t)`; `turn_trace` = `trace()` плюс `applied`, `staffErrors`, `commandErrors` (непустые из
`command_results`), `commandResults`. `state_digest` сворачивает FNV-1a (как `Sim::digest`) в таком порядке:
`sim.digest()`; `frames.len()`; по документам — `tick, hq, kind as u8, text.len()`; `command.control` (дискриминант),
`led_hq`, `led_div`, `requests` (`tick, answer`), `sent.len()`; `intent.hq` (`status`, `since`), по цепочкам — `issued`
каждой задачи, `intent.led`, `intent.log.len()`, `intent.queue.len()`, `intent.actions.len()`; по командующим —
`mood.to_bits()`, `intent_label.len()`, `decisions.len()`, `last`; `commanders.raised.len()`; `pending` (`час`, `id`);
`issued` по возрастанию; `reserves`.

`intent.track` переводится на `Arc`: след эталона (~0,4 МБ в файле) не копируется в каждый снимок.

- [ ] **Step 1: Падающие тесты** (`tests/rewind.rs`, Зееловский сценарий, `Game::start_mode(…, 24, Su, &[Su], None, mode)`):
  - `play_turn_same_as_old_path` — `Mode::Legacy`: `play_turn(TurnIn { hours: 24, ..Default::default() })` → `g.sim.digest() == LEGACY_GAME_DIGEST` (константа скопирована из `tests/command.rs`).
  - `replay_log_same_digests` — `Mode::Agents`: 4 хода по 12 ч с разными входами (ход 1 — `CommandOp::Take { hq: "su_8gva" }` как JSON в `command`; ход 2 — приказ `PlayerOrder { hq: "su_5ua", kind: Attack, … }`; ход 3 — `staff.supply`; ход 4 — `Release`), после каждого — `state_digest()` в `d: Vec<u64>`; новая игра с тем же `seed` и `for t in g1.log.clone() { g2.play_turn(t) }` даёт те же `d` по ходам.
  - `snapshot_is_lossless` — `Mode::Commanders` на Берлинской (`takeover` 6, ход 6 ч): `let s = g.sim.snapshot();` → `s.documents.len() == g.sim.documents.len()`, `s.journal.len() == g.sim.journal.len()`, `format!("{:?}", s.commanders.list) == format!("{:?}", g.sim.commanders.list)`, `format!("{:?}", s.intent.chains)` совпадает; 6 шагов `s.step()` и `g.sim.step()` → одинаковые `digest()`.
  - `trace_has_turn_and_digest` — после хода `trace()["game"]["turn"] == 1`, `["digest"]` — строка из 16 шестнадцатеричных знаков, равная `format!("{:016x}", g.state_digest())`.
- [ ] **Step 2:** `cargo test --release -p agents-core --test rewind 2>&1 | tail -3` — не компилируется.
- [ ] **Step 3:** Реализовать `game_rewind.rs`, `Sim::snapshot`, поле `log`, `Arc<Track>`; `agents-game.rs` и `agents-tauri` — разбор `TurnIn` из аргументов (`doctrine` — из `DoctrineIn::texts()`), вызов `play_turn` и `turn_trace` вместо повторённого кода.
- [ ] **Step 4:** `cargo test --release -p agents-core 2>&1 | grep -E "test result|FAILED|panicked"` — всё зелёное, прежние отпечатки целы.
- [ ] **Step 5:** `npm run model:index`; коммит `feat(игра): ход как вход ядра, полный снимок и отпечаток игры` (вместе с `packages/knowledge/data/model-index.json`).

### Task 2: Снимки каждые 2 хода и возврат к ходу в ядре; команда `game_rewind`

**Files:**
- Modify: `crates/agents-core/src/game_rewind.rs` (снимки, `rewind`, `between_op`), `crates/agents-core/src/game.rs` (поля `snaps`, `between`),
  `crates/agents-core/src/bin/agents-game.rs:83-90` (`game_directive` … `game_release` → `between_op`; новая `game_rewind`),
  `crates/agents-tauri/src/lib.rs:240-261` (то же, `pub async fn game_rewind(keep: usize) -> Result<Value, String>` в `spawn_blocking` под `GAME`),
  `apps/desktop/src-tauri/src/main.rs:80`, `apps/agents/src-tauri/src/main.rs:18` (обработчик), `apps/desktop/src-tauri/build.rs:4` и
  `apps/agents/src-tauri/build.rs` (если перечисляет команды) — `"game_rewind"`, `apps/desktop/src-tauri/capabilities/default.json` (`"allow-game-rewind"`),
  `scripts/agents-bridge.mjs:58-82` (`--check`: возврат)
- Test: `crates/agents-core/tests/rewind.rs`

**Interfaces:**
- Consumes: `TurnIn`, `play_turn`, `state_digest`, `Sim::snapshot` (задача 1).
- Produces:
  - `pub const SNAP_EVERY: usize = 2; pub const MAX_SNAPS: usize = 40;`
  - `pub struct GameSnap { pub turn: usize /* сыграно ходов */, pub sim: Sim, pub frames: usize, pub issued: HashSet<String>, pub pending: Vec<(u32, Directive)>, pub reserves: BTreeMap<u32, u32>, pub enemy_agents: bool, pub limit: u32 }`
  - поля `Game`: `pub snaps: Vec<GameSnap>`, `pub between: Vec<CommandOp>` (команды между ходами, уйдут в `TurnIn.between` следующего хода).
  - `impl Game { pub fn between_op(&mut self, c: CommandOp) -> Result<(), String>; pub fn rewind(&mut self, keep: usize) -> Result<(), String> }`
  - команда ядра `game_rewind { keep }` (сколько ходов оставить: возврат к ходу N — `keep = N − 1`) → `trace()`.

**Выбор K = 2.** Ход — 12 ч; худший возврат досчитывает 1 ход — столько же, сколько игрок и так ждёт обычного хода
(на «командующих» с проигрышем «в уме» это самый дорогой расчёт игры). Снимок — состояние без кадров: кадры (`frames`,
по всем дивизиям на каждый час — самая большая часть) только дописываются, снимок хранит их число и при возврате
обрезает; след эталона — общий `Arc`. Остаётся мир (352 дивизии, 110 штабов Берлинской), управление, документы и журнал —
порядка единиц мегабайт; игра Берлинской до предельного срока — около 30 ходов, это ~15 снимков. `MAX_SNAPS = 40`
ограничивает долгие игры: при переполнении удаляется каждый второй снимок, кроме снимка хода 0 (шаг удваивается, худший
досчёт — 3 хода).

Снимок берётся лениво: перед первым действием хода (`play_turn` или `between_op`), если `log.len() % SNAP_EVERY == 0` и
снимка этого хода ещё нет — так снимок хода 0 включает `enemy_agents()`/`enemy_intent()` после `start_mode`, но не команды
между ходами. `between_op` исполняет команду теми же функциями, что сейчас (`take`, `release`, `permit`,
`issue_historical`, `directive` — без проверки режима `command`), при успехе — в `between`; `play_turn` забирает
`between` в `TurnIn` и при повторе исполняет его первым. `rewind(keep)`: `keep > log.len()` → `Err("сыграно ходов: {n}, к
ходу {keep+1} вернуться нельзя")`; `keep == log.len()` и `between` пуст → `Ok` без изменений; иначе — снимок с
наибольшим `turn ≤ keep`, восстановить (`sim.snapshot()` от снимка — снимок остаётся пригодным), `frames.truncate`, снимки
позже него удалить, `log` обрезать до `turn`, повторить сохранённые входы `turn..keep` через `play_turn`, `between`
очистить.

- [ ] **Step 1: Падающие тесты** (`tests/rewind.rs`):
  - `rewind_reproduces_digest` — Зееловский, `Mode::Agents`, 5 ходов по 12 ч (входы как в `replay_log_same_digests`), `d[0]` — `state_digest()` до первого хода, `d[k]` — после хода k; затем `rewind(4)` → `state_digest() == d[4]`, `frames.len() == 25 + 4*12`; `rewind(1)` → `d[1]`; `rewind(0)` → `d[0]`, `log.is_empty()`, `hour() == 24`.
  - `rewind_then_same_inputs_same_future` — после `rewind(2)` повтор сохранённых входов 3–5 даёт `d[5]`; другой вход на ходу 3 — `state_digest() != d[3]`.
  - `rewind_beyond_errors` — `rewind(6)` при 5 ходах → `Err`, текст содержит «сыграно ходов: 5»; состояние не изменилось (`state_digest() == d[5]`).
  - `between_ops_replayed` — `between_op(Take { hq: "su_8gva" })` между ходами 2 и 3, ход 3; `rewind(3)` после хода 4 → тот же `state_digest()`, что после хода 3; `rewind(2)` → `command.control[su_8gva] != Control::Player`.
  - `rewind_exact_intent_and_commanders` (Review Focus 4) — Берлинская, по очереди `Mode::Intent` (взять `su_1bf` на ходу 1, директива `PlayerDirective { to: "su_8gva", task: Attack, … }` на ходу 2) и `Mode::Commanders` (взять `su_1bf`, ответ на запрос отхода, если он есть), ход 6 ч, 4 хода; `state_key(g)` = `format!("{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}", g.sim.intent.chains, g.sim.intent.hq, g.sim.intent.led, g.sim.intent.actions, g.sim.commanders.list, g.sim.commanders.raised, g.sim.documents, g.sim.command, sorted(g.issued))` плюс `g.pending.len()` и `g.sim.journal.len()` — после `rewind(k)` равен ключу, снятому после хода k, для k = 3, 1.
  - `snapshots_bounded` — Зееловский, ход 1 ч, 100 ходов: `snaps.len() <= MAX_SNAPS`, первый снимок — `turn == 0`; `rewind(37)` → отпечаток хода 37.
  - `rewind_after_turn_only` (Review Focus 1) — в `agents-game` команды идут по очереди: строки `game_turn`, `game_rewind {keep: 0}` подряд в одном потоке ввода → ответ на `game_rewind` приходит после ответа хода и `game.turn == 0` (тест запускает `env!("CARGO_BIN_EXE_agents-game")` через `std::process::Command` с `DEFOPS_ROOT` = корень репозитория).
- [ ] **Step 2:** `cargo test --release -p agents-core --test rewind 2>&1 | tail -3` — новые тесты падают.
- [ ] **Step 3:** Реализовать снимки, `between_op`, `rewind`; команды `game_rewind` в мосте, приложениях, правах.
- [ ] **Step 4:** `cargo test --release -p agents-core 2>&1 | grep -E "test result|FAILED"`; `cargo build --release -p agents-core --bin agents-game && node scripts/agents-bridge.mjs --check` — `ok` (в `--check` добавить: ход 12 ч «гибрида», `game_rewind {keep: 0}` → `game.hour == 0`, `game.digest` совпадает с отпечатком `t0`).
- [ ] **Step 5:** `cargo check -p agents-tauri 2>&1 | tail -2` и сборка `apps/desktop/src-tauri` (`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -2`) — без ошибок; `npm run model:index`; коммит `feat(игра): снимки и возврат к ходу в ядре, команда game_rewind`.

### Task 3: Отпечатки в записи игры и проверка повтора

**Files:**
- Modify: `packages/sim/src/game.ts:16-55` (`GameTurn.digest`, `GameRecord.startDigest`, `stateDigest`, `digestMismatch`), `packages/sim/src/index.ts:14` (экспорт),
  `apps/editor/src/sim/agents-game.ts` (тип `AgentGameTrace.game`: `turn: number; digest: string`),
  `apps/editor/src/sim/game-worker.ts:156-231` (вынести цикл повтора в `replayTurns`), `game-worker.ts:494-560` (`advance`: отпечаток в запись),
  `apps/editor/src/sim/game-protocol.ts:205-232` (`GameResponse`: `{ kind: 'notice'; text: string }`), `apps/editor/src/CommandView.tsx:270-340` (`notice` → `setNotice`)
- Test: `packages/sim/tests/game.test.ts`

**Interfaces:**
- Consumes: `trace().game.digest` (задача 1).
- Produces:
  - `GameTurn.digest?: string` — отпечаток мира в конце хода; `GameRecord.startDigest?: string` — на начало хода 1.
  - `export function stateDigest(s: SimState): string` (нынешняя модель) — FNV-1a 64 бита (`BigInt`) по `s.time` и формированиям по порядку (`id`, `personnel`, `tanks`, `guns`, `position`, `destroyed`), 16 шестнадцатеричных знаков.
  - `export function digestMismatch(want: string | undefined, got: string, turn: number): string | null` — `want` нет → `null`; не совпало → «Запись игры разошлась с расчётом на ходу {turn}: дальше игра идёт по расчёту.» (`turn` 0 — «на начале игры»).
  - в потоке: `async function replayTurns(turns: GameTurn[]): Promise<void>` — повтор ходов записи (для продолжения, ветви — задача 4), после каждого хода — отпечаток расчёта; записанный сверяется `digestMismatch`, первое расхождение — `post({ kind: 'notice', text })`; запись получает отпечаток расчёта (старые записи — дописываются).
  - отпечаток расчёта хода: агентная модель — `agentTrace.game.digest`, нынешняя — `stateDigest(g.state)`.

- [ ] **Step 1: Падающие тесты** (`packages/sim/tests/game.test.ts`, контекст `berlin-1945-tasks`, как соседние):
  - `stateDigest repeats on replay` — `startGame` + 2 хода `playTurn` с приказами; `replayGame` той же записи → `stateDigest` совпадает; другой приказ на ходу 2 — отличается; длина 16, `/^[0-9a-f]{16}$/`.
  - `replay of a skipped-ai turn needs no model` (Review Focus 2) — запись, где ход 2 — `{ orders: humanOnly, ai: { ok: false, error: 'модель не ответила' } }` и `digest` из первого прогона: `replayGame` даёт тот же `stateDigest` (повтор берёт только записанные приказы).
  - `old record without digests` (Review Focus 3) — `digestMismatch(undefined, 'abc', 3) === null`; `digestMismatch('aa', 'bb', 3)` содержит «на ходу 3»; `digestMismatch('aa', 'bb', 0)` содержит «на начале игры».
- [ ] **Step 2:** `npx vitest run packages/sim/tests/game.test.ts 2>&1 | grep -E "Tests |FAIL"` — падают.
- [ ] **Step 3:** Реализовать `stateDigest`, `digestMismatch`; в потоке — `startDigest` после `game_start`/`startGame` (есть в записи — сверить), `replayTurns` вместо цикла в `start`, отпечаток в `rec.turns[последний].digest` в `advance` перед `post({ kind: 'record' })`.
- [ ] **Step 4:** Тест зелёный; `npm run typecheck 2>&1 | tail -3` — без ошибок.
- [ ] **Step 5:** Коммит `feat(игра): отпечаток мира по ходам в записи, проверка повтора`.

### Task 4: Возврат к ходу и переход на ветвь в потоке игры

**Files:**
- Create: `apps/editor/src/sim/game-rewind.ts` (чистые функции)
- Modify: `apps/editor/src/sim/game-protocol.ts:63-100` (`GameRequest`), `:205-262` (`GameResponse`), `apps/editor/src/sim/game-worker.ts` (состояние на начало хода, обработчики)
- Test: `apps/editor/tests/game-rewind.test.ts`

**Interfaces:**
- Consumes: `game_rewind { keep }` (задача 2), `replayTurns`, `digestMismatch`, `stateDigest` (задача 3).
- Produces:
  - `GameRequest`: `{ kind: 'rewind'; turn: number }` (ход N, с 1), `{ kind: 'switch'; turns: GameTurn[] }` (ходы линии целиком).
  - `GameResponse`: `{ kind: 'rewound'; turn: number; at: string; tail: GameTurn[] }` (до `record`; `tail` — снятые ходы N…), `{ kind: 'switched'; turns: number }`, `{ kind: 'rewind-refused'; text: string }`.
  - `export function rewindCheck(s: { busy: boolean; played: number; turn: number }): string | null` — `busy` → «идёт расчёт хода — вернуться можно, когда он закончится»; `turn < 1` или не целое → «такого хода нет: ходы — с первого»; `turn > played + 1` → «сыграно ходов: {played}, хода {turn} ещё не было»; `turn === played + 1` → «это и есть текущий ход»; иначе `null`.
  - `export function commonPrefix(a: GameTurn[], b: GameTurn[]): number` — число первых ходов, равных в обеих линиях: оба `digest` есть — по `time` и `digest`; иначе — по `JSON.stringify` полей `time, orders, actions, command, umpire`.
  - `export function expectedDigest(rec: GameRecord, keep: number): string | undefined` — `keep === 0` → `rec.startDigest`, иначе `rec.turns[keep − 1]?.digest`.
  - в потоке: `stash: TurnStash[]`, `interface TurnStash { g: GameState; agentStaff: AgentStaff; agentDropped: string[]; journal: number; outcome: GameOutcome | null }` — `stash[k]` — начало хода k+1; пишется в `start` (k = 0) и после каждого хода (`advance`, `replayTurns`); `async function rewindTo(keep: number): Promise<GameTurn[]>` — возвращает снятые ходы.

`rewindTo(keep)`: агентная модель — `agentsCall('game_rewind', { keep })` → `setAgent`; нынешняя — `g = stash[keep].g`; затем
`agentStaff`, `agentDropped`, `outcome` — из `stash[keep]`, `journal.length = stash[keep].journal`, `stash.length = keep + 1`,
`tail = rec.turns.splice(keep)`; отпечаток после возврата сверить с `expectedDigest` (расхождение — `notice`). Обработчик
`rewind`: `rewindCheck({ busy, played: rec.turns.length, turn })` → отказ `rewind-refused`; иначе `aiWait.drop()`,
`queued = null`, `skipAi = false`, `rewindTo(turn − 1)`, `postView()`, `post({ kind: 'rewound', … })`, `post({ kind: 'record' })`,
`startAi()` (снимает прежний запрос штаба противника и спрашивает его заново на ходу N). Обработчик `switch`:
`p = commonPrefix(rec.turns, turns)`, `rewindTo(p)`, `replayTurns(turns.slice(p))`, `postView()`, `switched`, `record`,
`startAi()`. Оба — под `busy`, как `advance`.

- [ ] **Step 1: Падающие тесты** (`apps/editor/tests/game-rewind.test.ts`):
  - `rewindCheck refuses while busy` (Review Focus 1) — `rewindCheck({ busy: true, played: 5, turn: 2 })` содержит «идёт расчёт хода»; `({ busy: false, played: 5, turn: 2 })` → `null`; `turn: 6` → «это и есть текущий ход»; `turn: 7` → «хода 7 ещё не было»; `turn: 0` и `turn: 2.5` → «такого хода нет».
  - `commonPrefix` — одинаковые 3 хода и разный 4-й → 3; линия — продолжение другой → длина короткой; ходы без `digest` с одинаковыми приказами → считаются равными; разные `time` → 0.
  - `expectedDigest` — `keep 0` → `startDigest`; `keep 2` → `turns[1].digest`; старая запись → `undefined`.
  - `rewind drops pending ai` (Review Focus 2) — порядок «`aiWait.drop()` → `startAi()`» потока — функция `export function restartAi(deps: { drop(): void; start(): void }): void` в `game-rewind.ts` (поток зовёт её в `rewind` и `switch`); тест: вызовы идут в порядке `drop`, `start`, ровно по одному.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/game-rewind.test.ts 2>&1 | grep -E "Tests |FAIL"` — падают.
- [ ] **Step 3:** Реализовать `game-rewind.ts`, протокол, `stash`, `rewindTo`, обработчики `rewind`/`switch` в потоке.
- [ ] **Step 4:** Тесты зелёные; `npm run typecheck 2>&1 | tail -3`.
- [ ] **Step 5:** Коммит `feat(игра): возврат к ходу и переход на ветвь в потоке игры`.

### Task 5: Ветви игры: хранение, имена, переключение

**Files:**
- Create: `apps/editor/src/game-branches.ts`
- Modify: `apps/editor/src/CommandView.tsx:72-85` (`SavedGame` — новые поля; `loadSaved` без изменений условия), `CommandView.tsx:325-336` (запись через `withRecord` и `storeGame`)
- Test: `apps/editor/tests/game-branches.test.ts`

**Interfaces:**
- Consumes: `commonPrefix` (задача 4), `GameTurn`, `GameRecord`.
- Produces:
  - `export interface SavedBranch { id: string; name: string; from: number /* ход N, с которого расходится */; at: string /* начало хода N, время игры */; created: string /* ISO, когда сохранена */; turns: GameTurn[] /* все ходы линии */; enemy: EnemyMode }`
  - `SavedGame` += `branches?: SavedBranch[]; line?: string /* имя текущей линии; нет — MAIN_LINE */`
  - `export const MAIN_LINE = 'основная линия';`
  - `export function branchName(n: number, at: string, taken: string[]): string` — «ветвь от хода {n} ({d} {месяца}, {чч:мм})»; имя занято — « — 2», « — 3».
  - `export function forkBranch(s: SavedGame, n: number, at: string, tail: GameTurn[], now: string): SavedGame` — `tail` пуст → `s` без изменений; линия `[...s.record.turns.slice(0, n − 1), ...tail]` уже есть среди ветвей (`commonPrefix` = длины обеих) → без новой; иначе новая ветвь с этими ходами, `s.record.turns` — первые `n − 1`.
  - `export function checkoutBranch(s: SavedGame, id: string): SavedGame` — текущая линия уходит в ветви под именем `s.line ?? MAIN_LINE` (`from` = `commonPrefix + 1` с выбранной, `at` — время того хода), выбранная становится записью: `record.turns`, `line = name`, `enemy`; выбранная из ветвей убрана.
  - `export function lines(s: SavedGame): { id: string | null; name: string; turns: number; from: number | null; current: boolean }[]` — текущая первой (`id: null`), затем ветви по `created`.
  - `export function withRecord(prev: SavedGame | null, record: GameRecord, enemy: EnemyMode, title: string, turn: string): SavedGame` — новая запись с сохранёнными `branches`, `line`.
  - `export function storeGame(st: Pick<Storage, 'setItem'>, key: string, s: SavedGame): string | null` — ошибка записи → «Запись игры не сохранилась: в хранилище окна нет места. Удалите лишние ветви.», иначе `null`.

- [ ] **Step 1: Падающие тесты** (`apps/editor/tests/game-branches.test.ts`):
  - `branchName` — `(5, '1945-04-18T06:00', [])` → «ветвь от хода 5 (18 апреля, 06:00)»; занято — «… — 2».
  - `forkBranch keeps old line` — запись из 7 ходов, `forkBranch(s, 5, t5, turns.slice(4), now)` → `record.turns.length === 4`, одна ветвь: `from 5`, `turns.length === 7`, имя с «ходу 5»; повтор того же возврата — ветвей по-прежнему одна; `tail` пуст — `s` без изменений.
  - `checkoutBranch is lossless` — после развилки и двух новых ходов: `checkoutBranch(s, id)` → запись = 7 прежних ходов, `line` — имя ветви, в ветвях — «основная линия» с 6 ходами; обратный `checkoutBranch` возвращает исходные ходы (`JSON.stringify` равен).
  - `old save without branches` (Review Focus 3) — `lines({ record, enemy, title, turn })` → один элемент «основная линия», `current: true`; `withRecord(null, …)` → `branches` нет.
  - `storeGame reports quota` (Review Focus 5) — `setItem`, бросающий `DOMException('QuotaExceededError')`, → текст с «нет места»; удачная запись → `null`.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/game-branches.test.ts 2>&1 | grep -E "Tests |FAIL"` — падают.
- [ ] **Step 3:** Реализовать `game-branches.ts`; `CommandView` пишет `def_ops.game` только через `withRecord` + `storeGame` (ошибка — `setNotice`).
- [ ] **Step 4:** Тесты зелёные; `npm run typecheck 2>&1 | tail -3`.
- [ ] **Step 5:** Коммит `feat(игра): ветви — хранение, имена, переключение без потери`.

### Task 6: Лента ходов, ветви на экране, список незавершённых игр, голос

**Files:**
- Create: `apps/editor/src/TurnRibbon.tsx` (лента и окно «Ветви»), `apps/editor/src/turn-ribbon.ts` (чистые функции)
- Modify: `apps/editor/src/CommandView.tsx` (лента над вкладками; обработка `rewound`/`switched`/`rewind-refused`; зависимости голоса),
  `apps/editor/src/voice/actions/turn.ts` (`TurnDeps`, действия, `parseTurn`), `apps/editor/src/voice/answers.ts` (`spokenNumber`),
  `apps/editor/src/voice/actions/command.ts:338-356,446-449` (`ReplayDeps.saved` — `lines`; `replay.continue` с `{ branch?: string }`),
  `apps/editor/src/ReplayView.tsx:482-489,505-513` (список линий незавершённой игры между пометками voice-entry; `continueGame(branch?)` → `checkoutBranch`),
  `apps/editor/tests/voice-completeness.test.ts:12-24` (`{ file: 'TurnRibbon.tsx' }` в `FILES`), `scripts/voice-e2e.mjs` (часть `game`), стили — `apps/editor/src/styles.css`
- Test: `apps/editor/tests/turn-ribbon.test.ts`, `apps/editor/tests/voice-command.test.ts` (фразы)

**Interfaces:**
- Consumes: `GameRequest` `rewind`/`switch`, `GameResponse` `rewound`/`switched`/`rewind-refused` (задача 4); `forkBranch`, `checkoutBranch`, `lines`, `MAIN_LINE` (задача 5); `rewindCheck` (задача 4).
- Produces:
  - `export interface RibbonItem { n: number; time: string; label: string /* «5 · 18.04 06:00» */; summary: string; current: boolean; forks: { id: string; name: string }[] }`
  - `export function turnSummary(day: JournalDay | undefined): string` — первое донесение дня, кроме строк, начинающихся с «Управление:», «Приказ », «Распоряжение не исполнено», «Команда не исполнена»; длиннее 70 знаков — обрезка с «…»; нет донесений — «без существенных событий»; нет дня — «текущий ход».
  - `export function ribbonItems(record: GameRecord, journal: JournalDay[], now: string, branches: SavedBranch[]): RibbonItem[]` — ходы 1…(сыграно + 1), у хода N — ветви с `from === N`.
  - `export function spokenNumber(s: string): number | null` — цифры или числительные 1–99, количественные и порядковые («пять», «пятому», «двадцать первому»).
  - действия реестра (раздел `replay`): `command.rewind` `{ turn: integer }` (`check`: `rewindCheck`; в проекте хода есть приказы, распоряжения или решение (`projectHas`) → `Offer` «В проекте хода есть приказы и распоряжения — при возврате они пропадут. Вернуться к ходу N?», `id: 'command.rewind.force'`, `strict: true`), `command.rewind.force` (`model: false`), `command.rewind.back`, `command.branches.show`, `command.branch.switch` `{ name: string }` (`pickByName` по `lines`; несколько — «Какую ветвь: …»; текущая — «вы и так на ветви …»).
  - ответы штаба: возврат — «Вернулся к ходу N ({дата}). Прежняя линия сохранена: «ветвь от хода N (…)».» (без снятых ходов — без второй фразы); «покажи ветви» — «Ветвей {k}: основная линия — текущая, ходов 7; ветвь от хода 5 (18 апреля, 06:00), ходов 9.», одна линия — «Ветвей нет: игра идёт одной линией.»; переход — «Перешёл на ветвь «…»: ход {n}.».
  - фразы `parseTurn`: `^(?:вернись|вернемся|вернуться|откатись|откати игру) (?:к|на) ход(?:у)? (.+)$` → `command.rewind` (`spokenNumber`); `^(?:вернись|вернемся|откатись) на (?:один )?ход назад$|^(?:отмени|откати) (?:последний )?ход$` → `command.rewind.back`; `^(?:покажи|какие|перечисли|открой)(?: мне)? ветви(?: игры)?$` → `command.branches.show`; `^(?:перейди|переключись|вернись) (?:на|в|к) (ветв\S* .+|основн\S* лини\S*)$` → `command.branch.switch`.

Поведение окна: лента — полоса над вкладками штаба, ход — кнопка (`data-action="command.rewind"`, через `tap`), текущий ход
выделен, с развилкой — значок «⑂» с числом ветвей; «Ветви» — кнопка в конце ленты (`command.branches.show`) открывает список
`lines` с «Перейти» (`command.branch.switch`). Пока идёт расчёт хода — кнопки ленты `disabled` с причиной в `title`. Ответ
`rewound`: `forkBranch` по текущей сохранённой записи (до прихода `record`), проект хода (`drafts`, `acts`, `decision`,
`postDecisions`) очищается, `cmds` — `initialCmds(view)` (как при смене хода), `setBlocked(null)`, `resetUmpire()`,
`turnsSeen.current` = новое число ходов (доклад посредника за снятый ход не звучит). Переход на ветвь: сначала
`checkoutBranch` и запись, затем `switch` в поток. «Незавершённая игра» в «Переигровке»: под строкой игры — линии из
`lines` с числом ходов и «Продолжить» у каждой (`replay.continue` `{ branch }`).

- [ ] **Step 1: Падающие тесты**:
  - `turn-ribbon.test.ts`: `turnSummary` (пропуск «Управление: …», обрезка 70, «без существенных событий», «текущий ход»); `ribbonItems` — запись из 3 ходов → 4 элемента, последний `current`, `label` хода 2 — «2 · дд.мм чч:мм» по `turns[1].time`; ветвь с `from: 2` — в `forks` хода 2.
  - `voice-command.test.ts`: `spokenNumber` — `'5'` → 5, `'пять'` → 5, `'пятому'` → 5, `'двадцать первому'` → 21, `'ветер'` → null; `parseTurn('вернись к ходу пять', 'replay')` → `{ id: 'command.rewind', params: { turn: 5 } }`; `'вернись на ход назад'` → `command.rewind.back`; `'покажи ветви'` → `command.branches.show`; `'перейди на ветвь от хода пять'` → `command.branch.switch` с `name` «ветвь от хода пять»; вне `replay` → `null`.
  - действие `command.rewind` с `TurnDeps` из заглушек: `busy` → `check` — строка «идёт расчёт хода …»; проект непустой → `Offer` с `id: 'command.rewind.force'`, `strict: true`; `command.rewind.back` при нуле сыгранных ходов → `available()` — «вернуться некуда: это первый ход».
- [ ] **Step 2:** `npx vitest run apps/editor/tests/turn-ribbon.test.ts apps/editor/tests/voice-command.test.ts 2>&1 | grep -E "Tests |FAIL"` — падают.
- [ ] **Step 3:** Реализовать `turn-ribbon.ts`, `TurnRibbon.tsx`, действия и фразы, обработку ответов потока в `CommandView`, список линий в `ReplayView`.
- [ ] **Step 4:** `npx vitest run apps/editor/tests/turn-ribbon.test.ts apps/editor/tests/voice-command.test.ts apps/editor/tests/voice-completeness.test.ts 2>&1 | grep -E "Tests |FAIL"` — зелёные, новых исключений в `voice-completeness` нет.
- [ ] **Step 5: Живая проверка через мост** (`scripts/agents-shots.mjs` или свой короткий скрипт с `attachAgentsBridge`, окно 1440×900): Берлинская на агентной модели, «История как замысел», противник — штаб на модели (LM Studio нет → «модель не ответила» → «ход без его приказов»), 3 хода; «вернуться к ходу 2» → на экране ход 2, время хода 2, в журнале 1 день, ветвь «ветвь от хода 2 (…)» в ленте; штаб противника снова спрошен и снова не ответил — кнопки «Повторить запрос» и «Ход без его приказов» на месте (Review Focus 2); «Ветви» → «Перейти» на сохранённую — снова ход 4, отпечаток хода 3 в записи совпадает с прежним; выйти — в «Незавершённой игре» две линии. Без ошибок в консоли.
- [ ] **Step 6:** `scripts/voice-e2e.mjs`, часть `game`: после первого хода «штаб, вернись на ход назад» → ответ начинается с «Вернулся к ходу 1»; «штаб, покажи ветви» → в ответе «ветвь от хода 1». Запуск в фоне: `node scripts/voice-e2e.mjs --only game > voice-e2e-game.log 2>&1` (файл вне репозитория или удалить после); итог — `grep -c '^ok' …`, `grep -v '^ok' … | tail`.
- [ ] **Step 7:** Коммит `feat(игра): лента ходов, возврат и ветви на экране и голосом`.

### Task 7: Описание системы, снимки, сборка документов, итоговая проверка

**Files:**
- Modify: `docs/system.md` — раздел 6: новый абзац «**Возврат к ходу и ветви.**» после абзацев об игре (строки ~1389–1415): лента ходов, что восстанавливается (мир, командование, история как замысел, командующие, документы, очередь команд хода), снимки каждые 2 хода и досчёт, отпечаток мира по ходам и уведомление о расхождении, повтор без модели, штаб противника на модели после возврата спрашивается заново, ветви и их имена, переход между ветвями, когда возврат недоступен; абзац «Сохранённые переигровки»/«Игра» — незавершённая игра показывает линии; раздел 9 «Командование голосом» (~3056) — «вернись к ходу N», «вернись на ход назад», «покажи ветви», «перейди на ветвь …»; раздел 11, таблица хранения (~3244) — «Незавершённая игра и её ветви»; раздел 14 / мост (~3380) — `game_rewind` в перечне команд.
  `docs/img/game-turn-ribbon.jpg` (лента с развилкой и открытыми «Ветвями»), `docs/img/replay-saved-branches.jpg` (незавершённая игра с линиями) — новые; пересъём затронутых снимков экрана игры, где видна новая полоса (`docs/img/game-reports.jpg` и те, где видна шапка штаба: проверить `grep -n "game-.*\.jpg" docs/system.md`).
  `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/model-index.json`
- Test: полный набор

**Interfaces:**
- Consumes: всё из задач 1–6.

- [ ] **Step 1:** Снимки Playwright (мост, 1440×900, JPEG) — по сценарию живой проверки задачи 6; подпись курсивом под каждым — только то, что видно на снимке.
- [ ] **Step 2:** Текст `docs/system.md` по списку выше; без дат и служебных названий; ссылки «раздел …» сверить после правки (`grep -n "раздел [0-9]" docs/system.md` по затронутым местам).
- [ ] **Step 3:** `npm run model:index` (раздел 6 и код ядра изменились) — `packages/knowledge/data/model-index.json` обновлён; `CHROMIUM_PATH=… npm run docs:system 2>&1 | tail -3` — `docs/system.pdf` и `docs/system.docx` собраны.
- [ ] **Step 4:** `npm run typecheck 2>&1 | tail -3` — без ошибок; `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` — без FAIL; `cargo test --release -p agents-core 2>&1 | grep -E "test result|FAILED"` — без FAILED, `coordination_one_changes_nothing` и `legacy_game_unchanged` зелёные.
- [ ] **Step 5:** Коммит `docs: возврат к ходу и ветви игры — описание, снимки, PDF и Word` (вместе с `docs/system.md`, `docs/img/*.jpg`, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/model-index.json`).
