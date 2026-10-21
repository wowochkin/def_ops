# Командование по ступеням, этап 1: данные иерархии — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** во всех трёх сценариях агентной модели у каждой дивизии — полная цепочка штабов до верхней инстанции
(Ставка / верховное командование вермахта) с настоящими советскими стрелковыми корпусами; плюс исторические
директивы Ставки/ОКХ как данные. Поведение модели при этом не меняется (итог сверки — в пределах шума).

**Architecture:** сценарии собираются сборщиками `packages/sim/tools/agents/build-*.ts` из реестров
`docs/sources/*-divisions.json` и сценариев нынешней модели. В реестре Берлинской операции советские корпуса уже есть
(«Боевой состав СА», ч. V, на 1.04.45), но сборщик ставит советскую дивизию прямо под армию — это меняется. Ядро
получает ступень `HighCommand`; советский штаб по доктрине по-прежнему решает за армию целиком (дивизии поддерева
армии), чтобы вставка корпусов не изменила его решений до этапа 2.

**Tech Stack:** TypeScript (tsx, vitest), Rust (`crates/agents-core`, cargo test), JSON-данные.

**Spec:** `docs/superpowers/specs/2026-10-21-command-levels-design.md` (раздел 6 «Данные», раздел 7 «Проверка»).

## Global Constraints

- Язык данных, комментариев, сообщений коммитов — русский.
- Тексты книг в репозиторий не попадают — только извлечённые факты и короткие пересказы со ссылкой на источник.
- Каждый восстановленный корпус, каждое переподчинение и каждая директива — с полями `source` и `reliability` (A/B/C).
- Верхняя инстанция: советская — `su_stavka` «Ставка ВГК»; немецкая — `de_hc` «Верховное командование вермахта
  (ОКХ; с 25.04.1945 — ОКВ)»; ступень `high_command` (как в `packages/knowledge/tools/build_seed.ts`, `ECH`).
- Берлинская операция — первой; Зееловская и Висло-Одерская — после.
- Проверки — экономно (CLAUDE.md): точечно `npx vitest run <файл>` и `cargo test -p agents-core <фильтр>`; полный
  `npm run typecheck` и `npm test` — один раз перед последним коммитом.
- Перед коммитом, меняющим поведение или данные: описание (`docs/system.md`), `npm run docs:system`,
  `npm run kb:seed`, `npm run model:index` — по CLAUDE.md (задача 8).

## Review Focus

1. Штаб с `parent: null`, не являющийся верхней инстанцией (например, немецкая армия без группы армий в
   Зееловском сценарии), — цепочка обрывается; тест иерархии должен падать.
2. Корпус в реестре есть на 1.04, а к 16.04 дивизия переподчинена (запись `subordination` позже) — брать запись на
   дату начала сценария (`subAt(d, '1945-04-16')`), не первую.
3. Советская дивизия армейского или фронтового подчинения без корпуса (танковые корпуса, бригады, УР,
   артиллерия) — остаётся под армией/фронтом; тест не должен требовать корпус для всех, только для `sd`/`gsd`,
   у которых корпус указан в реестре.
4. Ядро получило сценарий с цепочкой глубже прежней (дивизия → корпус → армия → фронт → Ставка): обходы `parent`
   с лимитом (`n < 6`, `0..8`) должны доходить до армии; проверить, что лимит не обрезает цепочку.
5. Немецкий штаб по доктрине решает по прямым подчинённым (`subs_of`): верхняя инстанция и группа армий без
   прямых дивизий не должны начинать решать и не должны падать.

---

### Task 1: ступень `HighCommand` в ядре

**Files:**
- Modify: `crates/agents-core/src/model.rs:198` (`enum Echelon`)
- Modify: `crates/agents-core/src/world.rs:314` (задержка по ступени)
- Modify: `crates/agents-core/src/staff.rs:236` (название ступени в подсказке)
- Modify: `apps/agents/src/data.ts:12` (`HqInfo.echelon`)
- Test: `crates/agents-core/tests/core.rs`

**Interfaces:**
- Produces: `Echelon::HighCommand` (serde `"high_command"`, как остальные варианты — snake_case); в TS
  `HqInfo.echelon: 'high_command' | 'front' | 'army' | 'corps'`.

- [ ] **Step 1: тест** `high_command_hq_loads_and_does_not_decide` в `tests/core.rs`: синтетический сценарий
  (по образцу соседних тестов) с `su_stavka` (`high_command`, `parent: null`) → фронт → армия → дивизия; загрузка
  без ошибки; `sim.world.hqs` содержит штаб с `Echelon::HighCommand`; 48 шагов `sim.step()` с советской стороной
  `Source::Doctrine` проходят без паники, итог (положения дивизий) совпадает с тем же сценарием без `su_stavka`.
- [ ] **Step 2:** `cargo test -p agents-core high_command` — падает (нет варианта).
- [ ] **Step 3:** добавить вариант; `world.rs:314` — `Echelon::HighCommand | Echelon::Front => sr.delay_army`
  (приказы от верхней инстанции появятся на этапе 2); `staff.rs:236` — «верховное командование».
- [ ] **Step 4:** тест проходит; `cargo test -p agents-core` — всё зелёное.
- [ ] **Step 5:** коммит «Ядро: ступень верховного командования».

### Task 2: советский штаб по доктрине решает за поддерево армии

Сейчас `doctrine_orders` (`staff.rs:50`) берёт прямых подчинённых штаба; после вставки корпусов советская армия
останется без дивизий, а решать начнут корпуса — поведение изменится. До этапа 2 советская сторона решает только на
штабах ступени `Army`, по всем дивизиям, чья армия (`army_of`) — этот штаб.

**Files:**
- Modify: `crates/agents-core/src/staff.rs:46-75`
- Test: `crates/agents-core/tests/core.rs`

**Interfaces:**
- Consumes: `army_of(w, h)` (`staff.rs:409`).
- Produces: без изменения сигнатур.

- [ ] **Step 1: тест** `su_doctrine_same_with_corps`: один и тот же сценарий в двух вариантах — 6 стрелковых дивизий
  прямо под армией и те же дивизии под двумя корпусами этой армии (по 3); советская сторона `Source::Doctrine`,
  задача сценария армии — наступать; после 72 шагов журналы решений штабов (`kind`, дивизия, час) и положения
  дивизий совпадают.
- [ ] **Step 2:** тест падает (во втором варианте решают корпуса).
- [ ] **Step 3:** в ветке `hq.side == Side::Su` пропускать штабы не ступени `Army`; `subs` — дивизии, у которых
  `army_of(w, d.hq) == h` (с теми же фильтрами `out()`/`Remnant`). Ветку `Source::Llm` (`asks`, `by_army`) — так же.
  Немецкую ветку не трогать.
- [ ] **Step 4:** тест проходит; `cargo test -p agents-core`.
- [ ] **Step 5:** коммит «Советский штаб по доктрине — за все дивизии армии, с корпусами».

### Task 3: проверка иерархии и счёт сверки из командной строки

**Files:**
- Create: `packages/sim/tools/agents/hierarchy.ts`
- Create: `packages/sim/tools/agents/score.ts`
- Test: `packages/sim/tests/agents-hierarchy.test.ts`

**Interfaces:**
- Produces:
  - `interface ScenHq { id: string; name: string; side: 'su' | 'de'; echelon: 'high_command' | 'front' | 'army' | 'corps'; parent: string | null }`
  - `HIGH_COMMAND: Record<'su' | 'de', { id: string; name: string }>` — значения из Global Constraints.
  - `hierarchyProblems(hqs: ScenHq[], divisions: { id: string; side: string; hq: string }[]): string[]` — по-русски,
    по одной строке: неизвестный штаб дивизии; штаб с `parent: null`, кроме верхней инстанции своей стороны; цикл;
    родитель другой стороны; ступень родителя не старше ступени штаба (порядок high_command > front > army > corps).
  - `score.ts`: `npx tsx packages/sim/tools/agents/score.ts --scenario berlin|seelow|vistula-oder --trace <trace.json>`
    печатает JSON `{ positions, events, total }` — тот же счёт, что вкладка «Агентная модель»
    (`agentsScore`, как в `apps/editor/src/sim/agents-score-worker.ts`).

- [ ] **Step 1: тесты** в `agents-hierarchy.test.ts` — в этой задаче только синтетика:
  - `hierarchyProblems`: полная цепочка → `[]`; армия без родителя → строка с id армии; цикл → строка
    «цикл»; корпус-родитель армии → строка о ступени.
  - Тесты сценариев (их добавляют задачи 4–6, каждая — для своего сценария; здесь только описаны): для каждого из `packages/sim/data/scenarios/agents/{berlin,seelow,vistula-oder}-1945.json`:
    `expect(hierarchyProblems(s.hqs, s.divisions)).toEqual([])`; ровно один штаб `high_command` на сторону.
  - Берлинская и Зееловская: каждая советская дивизия с `kind: 'sd'`, у которой в
    `docs/sources/berlin-1945-divisions.json` на 16.04.1945 указан `corps`, стоит под штабом с этим id и ступенью
    `corps`; у этого штаба `parent` — армия из той же записи реестра.
- [ ] **Step 2:** `npx vitest run packages/sim/tests/agents-hierarchy.test.ts` — падает (нет `hierarchy.ts`).
- [ ] **Step 3:** реализовать `hierarchy.ts` и `score.ts`.
- [ ] **Step 4:** снять исходный счёт до изменений данных: `npm run agents:berlin`,
  `npm run agents:seelow`, прогон Висло-Одерской (`cargo run --release -q --bin agents-run -- --scenario
  packages/sim/data/scenarios/agents/vistula-oder-1945.json --out evals-out/agents/vistula-oder`), затем `score.ts`
  по каждому trace; записать три итога в `evals-out/agents/hierarchy-baseline.json` (не коммитится).
- [ ] **Step 5:** коммит «Проверка иерархии штабов агентной модели; счёт сверки из командной строки».

### Task 4: Берлинская операция — корпуса и верхняя инстанция

**Files:**
- Modify: `packages/sim/tools/agents/build-berlin.ts:97-111` (`hqOf`, штабы), `:485-492` (запись штабов)
- Modify: `packages/sim/data/scenarios/agents/berlin-1945.json`, `berlin-1945.history.json` (пересборка)
- Test: `packages/sim/tests/agents-hierarchy.test.ts` (тесты сценария «berlin»)

**Interfaces:**
- Consumes: `HIGH_COMMAND`, `hierarchyProblems` (задача 3).

- [ ] **Step 1:** добавить тесты сценария «berlin» из задачи 3, шаг 1; запустить — падают.
- [ ] **Step 2:** `hqOf` для советских — `s.corps ?? s.army ?? s.front`; штаб корпуса из реестра: `id: s.corps`,
  `name: s.corps_name` (например «9 гв. ск»), `echelon: 'corps'`, `parent: s.army`, положение — `hqPos` по
  дивизиям. Верхние инстанции из `HIGH_COMMAND`; фронтам (`su_1bf`, `su_1uf`, `su_2bf`) — `parent: 'su_stavka'`;
  немецким группам армий и `de_okw` — `parent: 'de_hc'`. Корпусам и верхним инстанциям в `notes` штаба — источник
  записи реестра (поле `source`). Дивизии армейского/фронтового подчинения по реестру (танковые корпуса, бригады,
  УР, отдельные дивизии без `corps`) остаются где есть; переподчинение — только по записи реестра с источником.
- [ ] **Step 3:** `npm run agents:berlin-data`; тесты сценария проходят.
- [ ] **Step 4:** `npm run agents:berlin` и `score.ts` — итог не ниже исходного из задачи 3 больше чем на 0,01;
  если ниже — найти расхождение (какие армии; по журналу — чьи решения изменились) и устранить в сборщике или ядре,
  не меняя параметры правил.
- [ ] **Step 5:** `npx vitest run packages/sim/tests/agents.test.ts packages/sim/tests/agents-score.test.ts
  packages/knowledge/tests` и `cargo test -p agents-core` — зелёные.
- [ ] **Step 6:** коммит «Берлинская операция (агенты): советские стрелковые корпуса, Ставка и верховное
  командование вермахта».

### Task 5: Зееловская операция — корпуса и полная цепочка

**Files:**
- Modify: `packages/sim/tools/agents/build-seelow.ts:84-125` (дивизии под корпус), `:141-150` (штабы)
- Modify: `packages/sim/data/scenarios/agents/seelow-1945.json`, `seelow-1945.history.json`
- Test: `packages/sim/tests/agents-hierarchy.test.ts` (сценарий «seelow»)

- [ ] **Step 1:** тесты сценария «seelow»; запустить — падают.
- [ ] **Step 2:** `hq` советской дивизии — её корпус из `byCorps` (ключ `${army}:${id}` — без корпуса, тогда армия);
  штабы корпусов — как в задаче 4; `su_1bf.parent = 'su_stavka'`; немецкая цепочка `de_9a` → `de_hgr_weichsel`
  («Группа армий „Висла“», ступень `front`) → `de_hc`.
- [ ] **Step 3:** `npm run agents:seelow-data`; тесты проходят.
- [ ] **Step 4:** `npm run agents:seelow`, `score.ts` — как задача 4, шаг 4.
- [ ] **Step 5:** `cargo test -p agents-core` (тесты ядра используют зееловский сценарий) — зелёные.
- [ ] **Step 6:** коммит «Зееловская операция (агенты): корпуса и полная цепочка штабов».

### Task 6: Висло-Одерская операция — советские корпуса по источнику

Реестра советских дивизий на январь 1945 г. нет: армия — 9 условных дивизий (C). Корпуса восстанавливаются по
«Боевому составу Советской армии», ч. V (на 1.01.1945) — какие стрелковые корпуса (и сколько дивизий в каждом) в
каждой армии 1-го Белорусского и 1-го Украинского фронтов; танковые армии — названия их танковых и механизированных
корпусов.

**Files:**
- Create: `docs/sources/vistula-oder-1945-su-corps.json`
- Modify: `packages/sim/tools/agents/build-vistula.ts:60-125`, `:132-142`
- Modify: `packages/sim/data/scenarios/agents/vistula-oder-1945.json`, `vistula-oder-1945.history.json`
- Test: `packages/sim/tests/agents-hierarchy.test.ts` (сценарий «vistula-oder»)

**Interfaces:**
- Produces: `vistula-oder-1945-su-corps.json`:
  `{ meta: { source, date: '1945-01-01', note }, armies: [{ army: 'su_8gva_vo', corps: [{ id: 'su_4gsk_vo', name: '4 гв. ск', kind: 'rifle' | 'tank' | 'mech', divisions: number | null, source, reliability }] }], gaps: string[] }`.

- [ ] **Step 1:** собрать данные: для каждой армии из `hqs` сценария (сторона `su`, ступень `army`) — корпуса на
  1.01.1945 с источником (страница/таблица «Боевого состава», «Память народа», ВЭ). Чего найти не удалось — в
  `gaps`, армия остаётся с 3 условными корпусами (C).
- [ ] **Step 2:** тест сценария «vistula-oder»: `hierarchyProblems` пустой; у каждой общевойсковой армии
  корпуса — из `vistula-oder-1945-su-corps.json` (или 3 условных, если армия в `gaps`); численность армии (сумма
  `personnel` её дивизий) — как до изменения (±1 на округление). Запустить — падает.
- [ ] **Step 3:** сборщик: число условных дивизий армии N — сумма `divisions` её корпусов (неизвестно — 3 на
  корпус); дивизии распределяются по корпусам по порядку эшелонов (первый эшелон — первые корпуса), `hq` — корпус;
  силы армии — поровну, как сейчас; имена дивизий — «4 гв. ск: стрелковая дивизия 1»; танковые корпуса танковой
  армии — реальные названия (`kind` → `tk`/`mk`); верхние инстанции и родители фронтов/групп армий — как в задаче 4.
- [ ] **Step 4:** `npm run agents:vistula-data`; тесты проходят; прогон и `score.ts` — как задача 4, шаг 4
  (здесь допустимо изменение, вызванное другим числом дивизий в армии, — тогда в сообщении коммита и в описании
  записать исходный и новый итог).
- [ ] **Step 5:** коммит «Висло-Одерская операция (агенты): советские корпуса по «Боевому составу» на 1.01.1945».

### Task 7: исторические директивы Ставки и ОКХ как данные

Набор для режима «гибрид» и проверки этапа 2 (спецификация, разделы 6–7). Этап 1 только собирает и проверяет данные;
ядро их пока не читает.

**Files:**
- Create: `docs/sources/berlin-1945-directives.json`, `docs/sources/vistula-oder-1945-directives.json`
- Test: `packages/sim/tests/agents-directives.test.ts`

**Interfaces:**
- Produces (общий формат обоих файлов):
  `{ meta: { note }, directives: [{ id, number: string | null, date: 'YYYY-MM-DDTHH:MM' | 'YYYY-MM-DD', from: hqId, to: hqId[], form: 'directive' | 'order' | 'instruction', goal: string, mainBlow: { armies: hqId[], axis: string[] } | null, immediate: { line: string[], by: string | null } | null, subsequent: { line: string[], by: string | null } | null, boundaries: { with: hqId, line: string[], from: string | null, responsible: hqId | null }[], reserves: { formation: hqId, task: string }[], source: string, reliability: 'A' | 'B' | 'C', note: string }] }`
  — пункты (`axis`, `line`) — названия населённых пунктов из `packages/sim/data/places-ru.json` или координаты
  `[lng, lat]`; `goal`/`note` — короткий пересказ своими словами.

- [ ] **Step 1: тест** `agents-directives.test.ts`: для обоих файлов — все `from`/`to`/`armies`/`with`/
  `responsible`/`formation` есть в `hqs` соответствующего сценария (Висло-Одерская — с суффиксом `_vo`); каждый
  пункт — известное место или координаты в пределах театра; даты в пределах операции и подготовки к ней (Берлин —
  с 1.04.1945, Висла–Одер — с 1.11.1944); у каждой записи непустые `source` и `reliability`. Запустить — падает
  (файлов нет).
- [ ] **Step 2:** собрать директивы. Берлинская: директивы Ставки 1-му Белорусскому, 1-му Украинскому и 2-му
  Белорусскому фронтам на операцию (начало апреля 1945), решения Ставки по ходу операции, которые доктриной не
  выводятся (поворот 3-й и 4-й гв. танковых армий 1-го Украинского фронта на Берлин около 20.04, разграничительная
  линия фронтов в Берлине), немецкие решения ОКХ/ОКВ (запрет отхода 9-й армии, поворот 12-й армии на Берлин).
  Висло-Одерская: директивы Ставки 1-му Белорусскому и 1-му Украинскому фронтам (ноябрь 1944) и решения по ходу.
  Номера и даты — по первоисточнику («Русский архив. Великая Отечественная», т. 16 (5-4); wikisource «Директива
  Ставки ВГК…»); чего нет в источнике — `number: null`, в `note` — откуда сведения.
- [ ] **Step 3:** тест проходит.
- [ ] **Step 4:** коммит «Исторические директивы Ставки и ОКХ: Берлинская и Висло-Одерская операции».

### Task 8: описание системы, база знаний, выжимка модели

**Files:**
- Modify: `docs/system.md` — раздел об агентной модели (часть I, раздел 6, «Игра на агентной модели» и состав
  сценариев; часть II — где описаны штабы и подчинённость агентной модели)
- Modify: `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json`,
  `packages/knowledge/data/model-index.json`

- [ ] **Step 1:** описание: в сценариях агентной модели полная цепочка Ставка/верховное командование → фронт/группа
  армий → армия → корпус → дивизия; советские стрелковые корпуса — по реестру («Боевой состав СА» на 1.04.45; для
  Висло-Одерской — на 1.01.45, с пробелами из `gaps`); советский штаб по доктрине решает за все дивизии армии;
  итоги сверки — из прогонов задач 4–6 (цифры только из свежего прогона). Без дат «по состоянию на», без упоминаний
  ассистента и веток. Снимки — только если изменился видимый интерфейс (список объединений, карточка штаба); тогда
  переснять затронутые (Playwright, 1440×900, JPEG) с подписью курсивом о видимом.
- [ ] **Step 2:** `npm run docs:system`, `npm run kb:seed`, `npm run model:index`.
- [ ] **Step 3:** `npm run typecheck 2>&1 | tail -3`; `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`;
  `cargo test -p agents-core 2>&1 | tail -3` — всё зелёное.
- [ ] **Step 4:** коммит «Описание: полная цепочка штабов агентной модели» и `git push -u origin
  claude/desktop-app`.
