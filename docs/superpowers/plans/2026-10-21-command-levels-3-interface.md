# Командование по ступеням — этап 3: интерфейс. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игрок в настольном приложении видит карту на пяти уровнях (Ставка, фронт, армия, корпус, дивизия), выбирает
режим игры (как сейчас / агенты / гибрид), подаёт исторические директивы, отдаёт приказ формой по ступени получателя,
берёт штабы под управление и возвращает их, отвечает на запросы отхода и читает журнал документов штабов.

**Architecture:** Команды управления (взять, вернуть, разрешить, подать историческую) копятся в интерфейсе, как
приказы, и уходят в ядро вместе с ходом (`game_turn.command`), записываются в ход игры — восстановление игры
повторяет их. Ядро отдаёт состояние управления разделом `command` в `Game::trace`. Уровни карты — пять значений
`MapLevel`; новый слой обобщения до корпуса `lvl-co-*` в `publish.ts`.

**Tech Stack:** Rust (`crates/agents-core`, `crates/agents-tauri`), TypeScript/React (`apps/editor`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-command-levels-design.md` (разделы 1, 4, 5, 8 п. 3)

## Global Constraints

- Язык интерфейса, сообщений и комментариев — русский.
- Только агентная модель меняется; нынешняя модель (армии и корпуса, ход — сутки) ведёт себя как раньше.
- Голосовое управление не перерабатывается: только синонимы старых уровней и названия новых.
- Режим по умолчанию у новой игры — «как сейчас» (Legacy): старые сохранения восстанавливаются без изменений.
- Работа — в ветке `claude/desktop-app`, в main не сливать.
- Проверки экономно: `npx vitest run <файл>`, полный `npm test` один раз перед коммитом задачи; Rust — `cargo test -p agents-core <фильтр>`.

## Решения по ходу плана (Rulings)

- Уровни карты по содержанию: «Ставка» — нынешний стратегический слой (фронты крупно, армии подписями), «Фронт» —
  нынешний оперативный (армии знаками), «Армия» — новый слой корпусов, «Корпус» и «Дивизия» — тактический (дивизии)
  в масштабах 1:100 000 и 1:50 000; бои и переправы — только «Дивизия». Сохранённый уровень и голос переводятся по
  содержанию (st → stavka, op → front, tac → division), а не по букве раздела 5 спецификации (st → «Фронт»): игрок
  видит ту же картину, что видел. Цена ошибки — один раз другой уровень по умолчанию.
- Расчётных полос корпусов и дивизий на карте нет (полосы штабов-агентов не выводятся из ядра); на уровнях «Армия»,
  «Корпус», «Дивизия» — полосы фронтов и армий. Отложено.

## Review Focus

1. Сохранённое в браузере значение уровня — старое ('tac'/'op'/'st'), мусор или пусто: уровень валиден, карта не пуста.
2. Восстановление старой игры без `mode` и без `command` в ходах: идёт как раньше (Legacy).
3. Команда управления с ошибкой (штаб не найден, уже взят, нет запросов) не ломает ход: ошибка — строкой в донесениях.
4. Игра на нынешней модели (не агентной): кнопок управления, режима и журнала документов нет.
5. Корпусной слой у сценария без корпусов: знаки армий (как в `groupOf` — ближайший не ниже уровня), не пусто.

---

### Task 1: Пять уровней карты

**Files:**
- Modify: `apps/editor/src/map-level-scale.ts`, `apps/editor/src/ReplayView.tsx:65-200,405-430`, `apps/editor/src/CommandView.tsx` (уровни `'tac'`), `apps/editor/src/voice/tour-map.ts:57-72`, `apps/editor/src/voice/actions/command.ts:539`, `apps/editor/src/voice/tours/index.ts:55`, `apps/editor/src/voice/tours/turn.ts` (уровни карт сюжета)
- Modify: `packages/sim/src/publish.ts` (`levelFeatures`, слои `lvl-co-*`, `RANK`)
- Test: `apps/editor/tests/map-level-scale.test.ts` (есть — дополнить), `packages/sim/tests/publish-levels.test.ts` (создать или дополнить существующий тест уровней)

**Interfaces:**
- Produces: `type LevelId = 'stavka' | 'front' | 'army' | 'corps' | 'division'`; `MapLevel = LevelId`; `migrateLevel(v: string | null): MapLevel` (в `map-level-scale.ts`); слои `lvl-co-units`, `lvl-co-moves`.

- [ ] **Step 1: тесты.** `map-level-scale.test.ts`: `levelDefaultScale` = 1 000 000 / 500 000 / 200 000 / 100 000 / 50 000;
  `levelOfScale(1_000_000) === 'stavka'`, `levelOfScale(50_000) === 'division'`, `levelOfScale(100_000) === 'corps'`;
  `migrateLevel('tac') === 'division'`, `migrateLevel('op') === 'front'`, `migrateLevel('st') === 'stavka'`,
  `migrateLevel('army') === 'army'`, `migrateLevel('мусор') === 'division'`, `migrateLevel(null) === 'division'`.
  Тест публикации: документ переигровки Зееловской (или существующий малый сценарий тестов publish) содержит слой
  `lvl-co-units` с хотя бы одним знаком, `ref` знаков — штабы корпусов или армий.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3: масштабы.** Интервалы (from–to, def): stavka 700 000 – 1 500 000 (1 000 000), front 350 000 – 700 000
  (500 000), army 150 000 – 350 000 (200 000), corps 75 000 – 150 000 (100 000), division 25 000 – 75 000 (50 000);
  границы — полуоткрытые (верхняя граница принадлежит более мелкому уровню), допуск 2 %.
- [ ] **Step 4: публикация.** `levelFeatures(..., level: 'corps' | 'army' | 'front', ...)`: для 'corps' — слой `lvl-co`,
  ветка «как армия» (знаки по снимкам, стрелки за сутки, рубежи обороны), `underFront` как у армии, знак 1,3;
  `RANK.high_command = 6`. Слои `lvl-co-units`, `lvl-co-moves` в документе (видимость false).
- [ ] **Step 5: уровни в интерфейсе.** `MAP_LEVELS` — пять с подписями «Ставка» (или «ОКХ» не нужно — подпись
  общая «Ставка»), «Фронт», «Армия», «Корпус», «Дивизия»; `LEVEL_LAYERS`: stavka → lvl-st-*, front → lvl-op-*,
  army → lvl-co-* + lvl-op-bounds, corps → sim-own/enemy/bounds, division → + sim-combat; призраки: division и
  corps — hist-units, front — lvl-op-hist; линия фронта атласа — stavka; переправы театра — division.
  `LEVEL_LEGEND` для пяти. `useMapLevel` читает через `migrateLevel`. Бои (`combat`) — только на 'division'.
  Принудительный переход на тактический при выборе агента (`ReplayView.tsx:411-427`) убрать: выбор знака на любом
  уровне. `tour-map ORDER` — пять уровней, обзор — 'stavka'. Голос: `map.level` принимает и старые
  `tac/op/st` (переводит `migrateLevel`), фраза — «тактическ → division, оперативн → front, стратегическ → stavka,
  ставк → stavka, фронтов → front, армейск → army, корпусн → corps, дивизионн → division». Сюжеты (`tours`):
  `'tac'` → 'division', `'op'` → 'front'.
- [ ] **Step 6:** тесты — PASS; `npm run typecheck 2>&1 | tail -3` — без ошибок; тесты голоса и туров (`npx vitest run apps/editor/tests/voice*`) — PASS.
- [ ] **Step 7: коммит** «Карта: пять уровней — Ставка, фронт, армия, корпус, дивизия; слой корпусов».

### Task 2: Ядро — команды управления в ходе и состояние управления в trace

**Files:**
- Modify: `crates/agents-core/src/game.rs`, `crates/agents-tauri/src/lib.rs` (`game_turn`), `crates/agents-core/src/bin/agents-game.rs` (`game_turn`)
- Test: `crates/agents-core/tests/game.rs`

**Interfaces:**
- Produces:
  - `#[serde(tag = "op", rename_all = "lowercase")] enum CommandOp { Take { hq }, Release { id }, Permit { hq, yes }, Historical { id } }`; `Game::command(&mut self, c: &CommandOp) -> Result<(), String>`.
  - `PlayerOrder.form: Option<Form>` (нет — распоряжение, как сейчас).
  - `game_turn(..., command: Option<Vec<CommandOp>>)`: команды — до распоряжений и приказов; ошибки — `trace.game.commandErrors: string[]`.
  - `Game::start_mode`: в режимах agents/hybrid исторические директивы с часом ≤ takeover подаются сами (`issue_historical` по каждой).
  - `Game::trace()["command"]`: `{ mode: "legacy"|"agents"|"hybrid", hqs: [{id, control: "script"|"agent"|"player", led: bool}], led: [id дивизий], requests: [{hq, division, tick, answer: bool|null}], historical: [{id, at, to, task, form, note, issued: bool}] }`.

- [ ] **Step 1: тесты** в `tests/game.rs` (на Зееловской, как соседние тесты режима): `command_ops_apply` — Take штаба
  армии → в trace `command.hqs` у него `control == "player"`; Release → `"agent"`; Historical неизвестного id → Err;
  `historical_auto_at_start` — в режиме agents с takeover позже первой директивы `command.historical` у неё
  `issued == true`, у будущей — false; `trace_command_legacy` — в Legacy `command.mode == "legacy"`;
  `order_form_prepared` — PlayerOrder с `form: Some(Order)` даёт директиву формы Order (час прибытия позже, чем у распоряжения).
- [ ] **Step 2:** `cargo test -p agents-core --test game` — FAIL (нет `CommandOp`).
- [ ] **Step 3:** реализовать; сериализация `Control` и `Task` для trace — строками нижним регистром (как в serde моделей).
- [ ] **Step 4:** тесты — PASS; `cargo test -p agents-core` — PASS; `cargo build -p agents-tauri` или
  `cargo check --workspace` — без ошибок.
- [ ] **Step 5: коммит** «Ядро игры: команды управления в ходе, состояние управления в trace, форма приказа игрока».

### Task 3: Поток игры — режим, команды, состояние управления в виде хода

**Files:**
- Modify: `packages/sim/src/game.ts` (`AgentGameSpec.mode?: 'legacy' | 'agents' | 'hybrid'`, `GameTurn.command?: CommandOp[]`), `apps/editor/src/sim/game-protocol.ts`, `apps/editor/src/sim/game-worker.ts`, `apps/editor/src/sim/agents-game.ts`
- Test: `apps/editor/tests/agents-game.test.ts` (создать, если нет; иначе дополнить)

**Interfaces:**
- Consumes: Task 2 — `game_turn.command`, `trace.command`, `PlayerOrder.form`.
- Produces:
  - `type CommandOp = { op: 'take'; hq: string } | { op: 'release'; id: string } | { op: 'permit'; hq: string; yes: boolean } | { op: 'historical'; id: string }` (в `packages/sim/src/game.ts`, экспорт из index).
  - `Order.form?: 'order' | 'instruction'` (в типе приказа игры `packages/sim`), `toAgentOrders` передаёт `form`.
  - `commandView(t: AgentGameTrace, names): CommandView | null` в `agents-game.ts`:
    `CommandView = { mode; hqs: Record<id, { control: 'script'|'agent'|'player'; led: boolean }>; led: string[]; requests: { hq; hqName; division; divisionName; time; answer }[]; historical: { id; time; to; toName; task; note; issued }[]; documents: { time; hq; hqName; kind; text; rule }[] }` (документы — последние 200 стороны игрока).
  - `TurnView.command?: CommandView`; `GameRequest` `turn` получает `command: CommandOp[]`.
  - `game_start` получает `mode` из `agents.mode`.

- [ ] **Step 1: тест** `commandView`: на подделанном trace (2 штаба, 1 запрос, 2 исторические, 3 документа, один
  из них — другой стороны) — имена подставлены, документ другой стороны отброшен, время — `dd.mm hh:mm` от `t.start`;
  trace без `command` → `null`.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3:** реализовать; `agentTurn(orders, actions, command)` передаёт `command` в `game_turn`, ошибки
  `commandErrors` — в донесения хода; ход записи `rec.turns[k].command` и восстановление передаёт их же.
  В донесения — также текст выполненных команд («Взят под управление: …»).
- [ ] **Step 4:** тест — PASS; `npm run typecheck 2>&1 | tail -3` — без ошибок.
- [ ] **Step 5: коммит** «Игра на агентной модели: режим, команды управления с ходом, состояние управления в виде хода».

### Task 4: Интерфейс командования

**Files:**
- Modify: `apps/editor/src/CommandView.tsx` (TakeoverDialog — режим; панель приказа — форма; карточка — пометки и кнопки; вкладка «Документы»), `apps/editor/src/formation-card.ts` (если пометки там)
- Create: `apps/editor/src/command-forms.ts` (чистые функции)
- Test: `apps/editor/tests/command-forms.test.ts`

**Interfaces:**
- Consumes: Task 3 — `TurnView.command`, `CommandOp`, `Order.form`.
- Produces (`command-forms.ts`):
  - `formTitle(side: 'su'|'de', echelon: string, form: 'order'|'instruction'): string` — su: front ← «директива Ставки»,
    army ← «директива фронта», corps ← «боевой приказ армии», division ← «боевой приказ корпуса» (у дивизии под
    армией — «боевой приказ армии»); распоряжение — «боевое распоряжение»; de: «Weisung», «Armeebefehl»,
    «Korpsbefehl», «Divisionsbefehl» по тем же ступеням, распоряжение — «Einzelbefehl», с русским переводом в скобках.
  - `controlMark(c?: { control: string; led: boolean }): { text: string; cls: string } | null` — player → «взят под
    управление», led → «ведёт Ставка», script → «по сценарию (гибрид)», agent → null.
  - `MODE_TITLE: Record<'legacy'|'agents'|'hybrid', { title: string; hint: string }>`.

- [ ] **Step 1: тесты** `formTitle` для каждой ступени обеих сторон и обеих форм; `controlMark` для четырёх случаев.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3:** реализовать `command-forms.ts`; затем интерфейс:
  - TakeoverDialog (только агентная модель): выбор режима тремя кнопками-радио, подсказки из `MODE_TITLE`;
    `onStart(enemy, mode)`; режим уходит в `agents.mode`. Запоминается в localStorage `def_ops.command.mode`.
  - Панель приказа (агенты/гибрид): переключатель «Распоряжение (быстро, 1–3 ч на ступень) / Приказ (сутки на
    ступень, полная слаженность)», подпись — `formTitle` по ступени выбранного получателя; уходит в `Order.form`.
  - Карточка выбранного своего штаба: пометка `controlMark`; кнопки «Взять под управление» / «Вернуть агенту»
    (по `control`), «Вернуть в замысел старшего» (при `led`); на запросы отхода штаба — «Разрешить отход» /
    «Отказать». Нажатие кладёт `CommandOp` в очередь хода (как приказы, отменяемо), видно в списке приказов хода.
  - Вкладка «Директивы» (агенты/гибрид): исторические директивы списком — время, кому, задача, пометка «подана»;
    кнопка «Подать» (в гибриде — только до первого хода) и «Подать все».
  - Вкладка «Документы»: журнал `command.documents` — время, штаб, вид, текст, правило.
  - Пометки управления в списке своих войск (значок у названия).
  - Голосовые действия для новых кнопок — `useAction` с id `command.take`, `command.release`, `command.permit`,
    `command.historical` (сказать: «штаб, возьми 8 гвардейскую армию», «штаб, подай директивы»).
- [ ] **Step 4:** тесты — PASS; `npm run typecheck` — без ошибок; `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` — без FAIL.
- [ ] **Step 5: коммит** «Командование: режим игры, форма приказа по ступени, взять и вернуть, запросы отхода, директивы, журнал документов».

### Task 5: Мост для снимков в браузере и снимки

**Files:**
- Create: `scripts/agents-bridge.mjs` (Playwright `addInitScript` + `exposeFunction`: `window.__TAURI_INTERNALS__.invoke(cmd, args)` → строка JSON в процесс `target/release/agents-game` → ответ), используется сценарием снимков
- Modify: сценарий снимков (`scripts/screens*.mjs` или тот, что снимает `docs/img`), `docs/img/*.jpg` затронутых экранов
- Test: прогон моста: `node scripts/agents-bridge.mjs --check` запускает игру Берлинской через мост и печатает `ok`

- [ ] **Step 1:** `cargo build --release -p agents-core --bin agents-game`; мост: `read_text` — чтение файла из
  репозитория; прочие команды — в процесс; `DESKTOP` в приложении включается подменой `__TAURI_INTERNALS__`.
- [ ] **Step 2:** `--check` — `ok`.
- [ ] **Step 3:** снимки 1440×900 JPEG: переключатель пяти уровней (переигровка), уровень «Армия» с корпусами,
  диалог передачи командования с режимом, панель приказа с формой, вкладки «Директивы» и «Документы»; затронутые
  старые снимки с переключателем уровней — переснять.
- [ ] **Step 4: коммит** «Снимки: пять уровней карты, режим игры, директивы и документы; мост к ядру для снимков».
