# Командование по ступеням, этап 2б: логика ступеней по уставам — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** штабы-агенты каждой ступени решают по своей логике — советские фронт, армия и корпус по ПУ-39 и приказам
НКО №306/№325 (эшелоны, ввод второго эшелона и подвижных групп, полосы по нормам), немецкие армия и корпус по
практике обороны 1944–45 (оттяжка перед артподготовкой, контрудар, отход только с разрешения ставки); отчёт о
расхождениях с историей и калибровка параметров внутри коридоров нормативов.

**Architecture:** общий штаб-агент этапа 2а (`command/agent.rs::plan`) становится диспетчером: по стороне и ступени
штаба он вызывает `command/su.rs` или `command/de.rs`, а общий раздел полосы (`band.rs`) остаётся основой. Логика
эшелонов переносится из `staff_su.rs::su_doctrine_hq` по ступеням (армия строит эшелоны из корпусов, корпус — из
дивизий), немецкий корпус вызывает нынешнюю доктрину `staff.rs::doctrine_hq`, но его отход проходит через
разрешение верхней инстанции. Состояние эшелонов — в `CommandState`.

**Tech Stack:** Rust (`crates/agents-core`), TypeScript (отчёт о расхождениях, vitest), JSON-правила.

**Spec:** `docs/superpowers/specs/2026-10-21-command-levels-design.md` (разделы 2.2, 2.3, 7). Предыдущий этап —
`docs/superpowers/plans/2026-10-21-command-levels-2a-core.md`.

## Global Constraints

- Язык комментариев, журнала, сообщений коммитов — русский; документ штаба — с правилом (`rule`: статья устава или
  id норматива).
- Прогон по сценарию, игра «как сейчас» и «гибрид» не меняются: отпечатки `SEELOW_48_DIGEST`,
  `LEGACY_GAME_DIGEST` (`crates/agents-core/tests/command.rs`) и тест `historical_directives_run` (гибрид = сценарий).
- Новые числа — `packages/sim/data/rules/agents-v0.json`, раздел `command.su` / `command.de`; с источником — строка
  `norms.json` (`kind: "param"`), вход `RULE_INPUTS` и опора в `docs/sources/agents-norms-1945.json`/`.md`; без опоры —
  поле `assumption` (решение этапа 2а).
- Числа (спецификация, разделы 2.2–2.3):
  - `command.su.divisionBandKm` = 1,5 — участок прорыва стрелковой дивизии 1944–45 гг. 1,5–2 км (Мацуленко;
    ВЭС, «Полоса наступления»; B);
  - `command.su.secondEchelonBehindKm` = 6 — второй эшелон за первым (допущение; ПУ-39 ст. 103 — второму эшелону
    только направление);
  - `command.su.mainBlowShare` = 0,5 — доля подчинённых на главном ударе, если в замысле не названы (допущение);
  - `command.de.pullbackKm` = 1,5 — оттяжка переднего края к главной позиции 0,8–2 км (DA Pam 20-201, с. 27–34; B);
  - `command.de.permissionHours` = 24 — ответ ставки на запрос отхода не раньше суток (DA Pam 20-234; B);
  - `command.de.attackSignDivisions` = 2 — противник готовит атаку: столько его дивизий развёртываются в полосе армии
    (допущение);
  - существующие `doctrine.su.*` (firstEchelonShare 0,667, commitDepthKm 7, secondEchelonFallbackHours 48,
    tankCommitDepthKm 13, tankCommitFallbackHours 48) и `doctrine.*` немцев — без изменения значений до задачи 7.
- Критерий (спецификация, раздел 7): прогон `agents-run --command agents --side su` не хуже `--command` без флага
  (по сценарию) на Берлинской операции в счёте `score.ts`; не достигнут — расхождение описывается, гибрид остаётся.
- Проверки — экономно (CLAUDE.md); работа — в ветке `claude/command-levels-2b` от `main`.

## Review Focus

1. Армия, у которой все корпуса — второго эшелона (первый выбыл), — второй эшелон вводится, а не ждёт вечно.
2. Танковая армия без стрелковых соседей в 25 км (выдвинута отдельно) — вводится по сроку `tankCommitFallbackHours`,
   а не никогда.
3. Немецкий корпус запросил отход, а верхняя инстанция — игрок, который не ответил, — корпус держится, запрос
   виден в документах, повторно в каждом цикле не дублируется.
4. Оттяжка перед артподготовкой — один раз на угрозу; после отражения атаки дивизии не отходят снова каждый час.
5. Полоса корпуса уже `divisionBandKm` на одну дивизию — в первом эшелоне хотя бы одна дивизия.

---

### Task 1: состояние эшелонов и диспетчер ступеней

**Files:**
- Create: `crates/agents-core/src/command/su.rs`, `crates/agents-core/src/command/de.rs` (пустые решения — общий агент)
- Modify: `crates/agents-core/src/command/control.rs` (`Role`, поля состояния), `crates/agents-core/src/command/agent.rs`
  (`plan` → диспетчер), `crates/agents-core/src/command/mod.rs`
- Test: `crates/agents-core/tests/command.rs`

**Interfaces:**
- Produces:
  - `enum Role { Unset, First, Second, Mobile, Committed }` (как `staff_su::Ech`); в `CommandState`:
    `role_hq: Vec<Role>`, `role_div: Vec<Role>`, `start_hq: Vec<Option<XY>>`, `start_div: Vec<Option<XY>>`,
    `since_hq: Vec<u32>`, `since_div: Vec<u32>`, `replaced: Vec<bool>` (по дивизиям и штабам — `replaced_hq`);
  - `fn advance(start: Option<XY>, pos: XY, axis: &[XY]) -> f64` (`command/agent.rs`) — продвижение вдоль оси, км;
  - `agent::plan(sim, h, intent, replan) -> Vec<Directive>` вызывает `su::plan` для советского фронта, армии,
    корпуса и `de::plan` для немецких армии и корпуса; `su::plan`/`de::plan` с той же сигнатурой; общий раздел полосы
    вынесен в `pub fn generic(sim, h, intent, replan, subs: &[Target], weights: Option<&[f64]>) -> Vec<Directive>`;
  - `Directive.rule: Option<String>` → в документ (`Document.rule`).
- [ ] **Step 1: тест** `dispatcher_keeps_generic_behaviour`: тесты этапа 2а
  (`directive_reaches_divisions_through_agents`, `instruction_is_faster_and_hasty`) проходят без изменений, пока
  `su::plan`/`de::plan` возвращают `generic(…)`; новый тест `advance_along_axis`: старт (0,0), ось на восток,
  положение (5,3) → 5,0.
- [ ] **Step 2:** запустить — падает (нет `advance`). **Step 3:** реализовать. **Step 4:** `cargo test --release -q -p
  agents-core` — зелёное, отпечатки не изменились.
- [ ] **Step 5:** коммит «Штабы-агенты: состояние эшелонов и диспетчер ступеней».

### Task 2: советский корпус — эшелоны дивизий и полосы по нормам

**Files:**
- Modify: `crates/agents-core/src/command/su.rs`, `packages/sim/data/rules/agents-v0.json` (`command.su`),
  `norms.json`, `rule-inputs.ts`, `docs/sources/agents-norms-1945.json`/`.md`, `crates/agents-core/src/rules.rs`
- Test: `crates/agents-core/tests/command.rs`

**Interfaces:**
- Consumes: `Role`, `generic`, `advance` (задача 1); `Rules.doctrine_su`.
- Produces: `Rules.command.su: CommandSu { division_band_km, second_echelon_behind_km, main_blow_share }`;
  `su::corps(sim, h, intent, replan) -> Vec<Directive>`:
  - распределение (один раз, дивизии `Unset` с задачей Attack): первый эшелон — ближайшие к противнику,
    `n1 = min(ceil(n · firstEchelonShare), max(1, floor(ширина полосы / divisionBandKm)))`; танковые части
    непосредственной поддержки (kind tk/mk/brigade/stug под корпусом) — с первым эшелоном;
  - первому эшелону — полосы `generic` по их числу; второму — директива `Task::Move` к точке на оси полосы корпуса
    в `secondEchelonBehindKm` позади центра первого эшелона, без полосы и рубежей (ПУ-39 ст. 103), `rule`
    «ПУ-39 ст. 103»;
  - ввод второго эшелона: среднее продвижение первого ≥ `commitDepthKm` или ожидание ≥
    `secondEchelonFallbackHours` → полосы делятся заново на всех, роли `Committed`; иначе смена остановившейся
    дивизии первого эшелона (оборона и противник ≤ contactKm + 4 км) ближайшей второго — та получает полосу
    остановившейся, `rule` «приказ НКО №306: второй эшелон — на смену».
- [ ] **Step 1: тесты**: `corps_echelons_by_norm` — Зееловский сценарий, советская сторона `Control::Agent`,
  директива Ставки фронту (`to_front`, `Form::Order`, `ready = true`); в часе 0 у корпуса из 3 дивизий с полосой
  ≥ 3 км — 2 первого эшелона и 1 второго; у второго приказ `Move` с целью позади центра первого на 5–7 км; цели
  дивизий первого эшелона разнесены ≥ 1 км (полоса ≥ 1,5 км на дивизию); `narrow_band_keeps_one_first` — полоса
  корпуса 1 км (правка: граница в 1 км от оси) — в первом эшелоне 1 дивизия (Review Focus 5);
  `second_echelon_commits_by_fallback` — через 48 ч без продвижения второй эшелон получает `Attack`.
- [ ] **Step 2:** запустить — падают. **Step 3:** реализовать; норматив `agents-command-su-division-band`
  (`agents.command.su.divisionBandKm`, [1,5; 2], км, B, «Мацуленко; ВЭС «Полоса наступления»») — строка, вход, опора;
  `kb:seed`, `model:index`. **Step 4:** тесты и `npx vitest run packages/sim/tests/norms.test.ts
  packages/sim/tests/rule-inputs.test.ts packages/knowledge/tests` — зелёные.
- [ ] **Step 5:** коммит «Советский корпус-агент: эшелоны дивизий, полосы по норме, ввод второго эшелона».

### Task 3: советская армия и фронт — эшелоны корпусов, главный удар, подвижные группы

**Files:**
- Modify: `crates/agents-core/src/command/su.rs`
- Test: `crates/agents-core/tests/command.rs`

**Interfaces:**
- Consumes: задачи 1–2.
- Produces:
  - `su::army(…)`: корпуса — как дивизии у корпуса (`n1 = ceil(n · firstEchelonShare)`, без ограничения шириной),
    второй эшелон — `Move` за первым, ввод — те же правила по продвижению дивизий корпусов первого эшелона; дивизии и
    бригады прямо под армией — с ближайшим корпусом первого эшелона (его директивой), `rule` «приказ НКО №306»;
  - `su::front(…)`: армии, у которых больше половины дивизий поддерева подвижные (tk/mk/brigade/kd/stug), —
    подвижная группа (`Role::Mobile`): директива `Move` к точке за главным ударом в 10 км, ввод — среднее продвижение
    стрелковых армий главного удара ≥ `tankCommitDepthKm` или ожидание ≥ `tankCommitFallbackHours` (тогда
    `Attack`, ближайшая задача — последующая задача фронта), `rule` «приказ НКО №325»; стрелковые армии — `generic`,
    веса: главный удар (из `intent.main_blow`, иначе ближайшие к оси `ceil(n · mainBlowShare)`) — 1, остальные — 2.
- [ ] **Step 1: тесты**: `army_echelons_corps` — у армии из 3 корпусов 2 первого эшелона и 1 второго (приказы
  `Move` у дивизий корпуса второго эшелона после прохождения); `front_holds_tank_armies` — у 1 гв. ТА и 2 гв. ТА в
  часе 0 задача `Move`, через 48 ч без продвижения — `Attack` (Review Focus 2: если стрелковых в 25 км нет —
  вводится по сроку); `all_second_echelon_commit` — первый эшелон армии выбыл (дивизии `Destroyed`), второй вводится
  в следующий цикл (Review Focus 1).
- [ ] **Step 2–4:** падают → реализовать → зелёные; отпечатки не изменились.
- [ ] **Step 5:** коммит «Советские армия и фронт-агенты: эшелоны корпусов, главный удар, ввод подвижных групп».

### Task 4: немецкие армия и корпус — оборона, контрудар, отход по разрешению

**Files:**
- Modify: `crates/agents-core/src/command/de.rs`, `crates/agents-core/src/staff.rs` (`doctrine_hq` — `pub(crate)`),
  `crates/agents-core/src/command/control.rs` (запросы отхода), `crates/agents-core/src/game.rs` (`permit`),
  правила `command.de`, нормативы
- Test: `crates/agents-core/tests/command.rs`, `crates/agents-core/tests/game.rs`

**Interfaces:**
- Produces:
  - `Rules.command.de: CommandDe { pullback_km, permission_hours, attack_sign_divisions }`;
  - `CommandState.requests: Vec<Request { hq: u32, tick: u32, divisions: Vec<u32>, answer: Option<bool> }>`;
  - `de::corps(…)`: решения `staff.rs::doctrine_hq` по действующим дивизиям корпуса (держать, оборонять, контрудар,
    закрыть, прорыв из окружения — как сейчас, это Gegenstoß и Gegenangriff по TM-E 30-451); решение «отход» —
    не приказ, а `Request` к верхней инстанции (документ `Report` «запрос на отход: …», `rule` «приказ от
    21.01.1945»), до ответа — `Hold`; повторный запрос по тем же дивизиям не создаётся (Review Focus 3); окружённым —
    прорыв без запроса;
  - ответ: верхняя инстанция — игрок → `Game::permit(hq: &str, yes: bool)`; не игрок → через
    `permissionHours` «держать», кроме случаев, когда уже подана историческая директива, разрешающая отход этой
    армии (`hitler-2204-9a` и подобные: `task` Withdraw или Delay у директивы её армии) — тогда «разрешить»;
  - `de::army(…)`: оттяжка перед артподготовкой — если в полосе армии противник развёртывает для атаки
    (`State::Deploy`) не меньше `attackSignDivisions` дивизий в contactKm + 6 км, дивизии первой линии получают
    `Withdraw` на `pullbackKm` назад один раз на угрозу (флаг по армии сбрасывается через 24 ч без развёртываний —
    Review Focus 4), `rule` «DA Pam 20-201: оттяжка с первой позиции»; иначе корпуса — `generic` с `Task::Defend`.
- [ ] **Step 1: тесты**: `de_corps_requests_withdraw` — немецкая сторона `Mode::Agents` (`player = De`) на
  Зееловском, корпус под давлением (правка: численность одной дивизии ×0,3) — документ «запрос на отход», дивизия
  держится; `permit(true)` → отход; без ответа 48 ч — один запрос, не два; `de_army_pulls_back_once` — советские
  дивизии в `Deploy` в 5 км (правка сценария) — немецкие дивизии первой линии отходят на 1,5 ± 0,5 км, через 12 ч —
  второго отхода нет.
- [ ] **Step 2–4:** падают → реализовать (+ нормативы `agents-command-de-pullback` [0,8; 2] км B,
  `agents-command-de-permission` [24; 48] ч B; `kb:seed`, `model:index`) → зелёные.
- [ ] **Step 5:** коммит «Немецкие армия и корпус-агенты: оттяжка, контрудар, отход по разрешению ставки».

### Task 5: отложенные мелочи этапа 2а

**Files:** `crates/agents-core/src/command/{control,agent,band}.rs`, `crates/agents-core/src/game.rs`
- Test: `crates/agents-core/tests/command.rs`, `tests/game.rs`

- [ ] **Step 1: тесты**: `active_subs_skip_empty_hqs` — штаб без действующих дивизий в поддереве не входит в
  `active_subs`; `fresh_keeps_subsequent` — дивизия, перешедшая к последующей задаче, при новом замысле старшего с
  той же последующей задачей не возвращается к ближайшей; `directive_to_script_hq_errors` — в «гибриде» директива
  игрока штабу под сценарием — ошибка «штаб ведёт сценарий»; `historical_twice_once` — повторный `issue_historical`
  с тем же id — ошибка «уже подана»; `boundary_on_axis_is_deterministic` — граница на оси считается левой, если
  другой левой нет.
- [ ] **Step 2–4:** падают → исправить → зелёные. («Верхней инстанции приказов не отдают» в режиме «как сейчас»
  остаётся — решение этапа 1.)
- [ ] **Step 5:** коммит «Штабы-агенты: пустые штабы, последующая задача, ошибки директив».

### Task 6: отчёт о расхождениях

**Files:**
- Create: `packages/sim/tools/agents/divergence.ts`
- Test: `packages/sim/tests/agents-divergence.test.ts`

**Interfaces:**
- Produces: `divergence(trace: AgentTrace & { documents?: Doc[] }, history: AgentHistory, toleranceKm = 10): Row[]`,
  `Row { army: string; firstOutAt: string; deviationKm: number; documents: { time: string; hq: string; kind: string; text: string; rule: string | null }[]; historical: string[] }`
  — для армий вне допуска (положения дивизий армии из истории): первый час, когда медиана отклонения её дивизий
  превысила допуск; документы её штаба и его старших за ±12 ч; исторические события и директивы того же дня
  (`docs/sources/*-directives.json`). CLI: `npx tsx packages/sim/tools/agents/divergence.ts --scenario berlin
  --trace … --out evals-out/agents/divergence.md` (таблица по армиям).
- [ ] **Step 1: тест** на синтетике: армия с дивизией, ушедшей на 30 км от истории в час 24, — строка с
  `firstOutAt` = час 24 и документами её штаба 12–36 ч; армия в допуске — строки нет.
- [ ] **Step 2–4:** падает → реализовать → проходит.
- [ ] **Step 5:** коммит «Отчёт о расхождениях агентной модели с историей по армиям».

### Task 7: калибровка и критерий

**Files:** `packages/sim/data/rules/agents-v0.json` (значения), `docs/system.md` (итоги)

- [ ] **Step 1:** исходные итоги: `agents-run --runs 3 --seed 1` по сценарию и `--command agents --side su` на трёх
  операциях; `score.ts`; отчёт `divergence.ts` по Берлинской.
- [ ] **Step 2:** перебор по одному параметру внутри коридора норматива (×0,7…×1,3, не выходя из коридора): 
  `doctrine.su.firstEchelonShare`, `commitDepthKm`, `tankCommitDepthKm`, `command.su.divisionBandKm`,
  `command.su.secondEchelonBehindKm`, `command.su.mainBlowShare` (допущение — коридор ×0,7…×1,3),
  `command.de.pullbackKm`; через `agents-run --params '{…}' --command agents --side su --runs 3`; принимается лучший
  по среднему `score.ts` Берлинской, если итог вырос и Зееловская не хуже на 0,02.
- [ ] **Step 3:** итог «агенты» против «по сценарию» на трёх операциях; не достигнут критерий — по `divergence.md`
  выписать причины (данные / правило / числа / решение выше по цепочке) в описание, раздел «Командование по ступеням».
- [ ] **Step 4:** коммит «Калибровка штабов-агентов: …» с итогами до и после.

### Task 8: описание системы

**Files:** `docs/system.md`, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json`,
`packages/knowledge/data/model-index.json`, `docs/norms-check.md`

- [ ] **Step 1:** раздел «Командование по ступеням»: логика советских фронта, армии, корпуса и немецких армии и
  корпуса с источниками; запрос отхода и ответ; итоги задачи 7 и разбор расхождений; счётчики нормативов.
- [ ] **Step 2:** `npm run docs:system` (`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`),
  `kb:seed`, `model:index`, `sim:norms -- --doc docs/norms-check.md`.
- [ ] **Step 3:** `npm run typecheck`, `npm test`, `cargo test --release -q -p agents-core` — зелёные.
- [ ] **Step 4:** коммит «Описание: логика ступеней штабов-агентов, разбор расхождений» и `git push -u origin
  claude/command-levels-2b`.
