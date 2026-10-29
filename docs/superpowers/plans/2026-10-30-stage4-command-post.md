# Этап 4. Пункт управления — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пункт управления, которым удобно пользоваться: решение составлено при открытии хода, ходатайство в Ставку о
разграничительных линиях действительно рассматривается, приказы задаются и щелчком, и выбором объекта, с точкой цели на
карте и составленными «Указаниями», а советник одной кнопкой даёт полные варианты решения — и без языковой модели.

**Architecture:** Ядро (`crates/agents-core`) получает два чтения-действия: команду `petition` (рассмотрение ходатайства
по правилу — `command/petition.rs`, ответ документом Ставки, принятая линия — директивой без оси обоим фронтам) и
`Game::variants` (варианты командующего по правилам: варианты `commander/options*` + раздел полосы `agent::plan` на копии
мира — задачи, полосы и оси всем подчинённым). Редактор (`apps/editor`) собирает из этого вид: чистые модули
`petition.ts`, `post-objects.ts`, `post-notes.ts`, `plan-rules.ts` (проверяются в node), разметка — в `CommandView.tsx` и
`CommandPost.tsx`; варианты языковой модели дополняются по правилам до полных.

**Tech Stack:** Rust (agents-core, agents-tauri, бинарь agents-game), TypeScript/React (apps/editor, services/staff,
packages/sim), vitest, cargo test, Playwright (снимки через `scripts/agents-bridge.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-30-command-pack-design.md` (раздел «Этап 4. Пункт управления»)

## Global Constraints

- Язык интерфейса, описания, сообщений коммитов — русский; правила `CLAUDE.md`: `docs/system.md` и снимки (Playwright, 1440×900, JPEG, подписи — то, что видно), `npm run docs:system`, `npm run kb:seed`, `npm run model:index`; новое правило модели — строка `packages/sim/data/rules/norms.json` + `npm run sim:norms -- --doc docs/norms-check.md`; в описании нет дат, упоминаний ассистента и названий веток.
- Прежние режимы модели дают прежние отпечатки (`SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST`): ходатайство и варианты срабатывают только по команде игрока, без неё ядро считает как прежде — отпечатки не меняются (проверяется в задачах 2 и 6).
- Правило ходатайства (дословно из спецификации): Ставка «принимает, если новая линия не отнимает у соседа его главный удар и полосу шире половины прежней, иначе отклоняет с объяснением; ответ — документом Ставки, принятая линия — в директиве обоим фронтам»; рассматривается «на этом ходу». Порог 0,5 — параметр `command.petitionMinShare` (`agents-v0.json`, `value 0.5, range [0.3, 0.8]`, допущение по спецификации).
- Где ходатайство подействовать не может — поле скрыто с пояснением (не молчаливое игнорирование).
- «Решение» составляется при открытии хода по обстановке **без модели**; «составить заново» — с предупреждением «текст будет заменён» и подтверждением.
- Объекты выбора в приказах: населённый пункт, рубеж, армия/соединение — свои и противника, мост; объект наступления — точкой с подписью на карте до отдачи.
- Советник: одна главная кнопка «Варианты советника» с выбором количества 1–3; варианты — задачи **всем** подчинённым выбранного штаба, полосы и разграничительные линии, ось главного удара, резервы, тыл, переправы; на карте и в списке; «принять целиком» / «принять и поправить»; без модели — варианты по правилам (варианты командующих) с пометкой «по правилам, без модели»; кнопка «Составить советником (ИИ)» убрана.
- Каждая доработка интерфейса проверяется живым снимком через мост (`scripts/agents-bridge.mjs`).
- Проверки — экономно: `npx vitest run <файл>` по ходу, `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` — один раз перед коммитом задачи; `cargo test -p agents-core --test <имя> 2>&1 | grep "test result"`.
- Ветка `claude/desktop-app`; в main — по просьбе пользователя.

## Review Focus

1. **Языковая модель недоступна.** Решение составлено как обычно; ходатайство в агентной модели рассматривает правило (модель не нужна); «Варианты советника» дают варианты по правилам с пометкой; модель упала посреди подготовки — показываются варианты по правилам с предупреждением; на нынешней модели без связи ходатайство скрыто, кнопка вариантов недоступна — с причиной. Тесты: задача 3 `скрыто: нынешняя модель без модели-Ставки`; задача 7 `без модели — варианты по правилам с пометкой`, `модель не ответила — варианты по правилам с предупреждением`.
2. **Смена уровня посреди правки.** Проект документа (ключ `уровень:получатель`), его точка цели и указания, решение штаба нижней ступени и ходатайство сохраняются при переходе на другой уровень и обратно; составление при открытии не перетирает правленое. Тесты: задача 1 `ensurePost: правленое решение штаба не заменяется`; задача 5 `правленые вручную указания не заменяются при смене задачи`.
3. **Подчинённый выбыл.** Вариантов и приказов выбывшему нет; приказ модели выбывшему снимается с пометкой; сосед-фронт без войск в ходатайстве не предлагается. Тесты: задача 6 `variants_destroyed_sub_absent`; задача 7 `приказ выбывшему — снят с пометкой`; задача 3 `соседи — только фронты той же Ставки с войсками`.
4. **История как замысел: директива снимает штаб с истории.** Принятая по ходатайству линия идёт соседу документом Ставки и не снимает его с истории; принятие варианта на уровне, где получатели идут по истории, предупреждает, кого директивы снимут с истории. Тесты: задача 2 `petition_keeps_neighbour_on_history`; задача 7 `historyLoss: получатели по истории названы`.
5. **Игрок за немецкую сторону.** Ходатайство — в ОКХ (`de_hc`) между группами армий, тексты словами стороны (`local`); варианты — для группы армий. Тесты: задача 2 `petition_player_de`; задача 3 `немецкая сторона — ОКХ`; задача 6 `variants_de`.

## Факты, на которых стоит план (разбор)

- **Ходатайство сейчас.** Поле `HumanDecision.request` (свободный текст). Читает его только `game-worker.ts` → `advance()` → `stavkaNeed(ctx, g, side, queued.decision?.request)` — **решение верхней инстанции**; ходатайства штабов нижних ступеней (`posts`) никто не читает. Ставка — только языковая модель (`stavkaTurn`, `services/staff/src/live/stavka.ts`) и только при `llm.stavka !== false && (enemy === 'llm' || (llm.umpire && !agents))`. Итог: нынешняя модель — работает лишь с моделью; агентная при противнике «история как замысел», «штабы-агенты», «без штаба» — не рассматривается никогда; при противнике на модели её линия (`StaffAction 'directive'`) доходит до ядра лишь сеткой штрафа за чужую полосу (`staffEffects → sectors`), а не директивой фронтам (`sim.command.intent[..].boundaries`). В режимах «штабы-агенты», «гибрид», «командующие» верхняя инстанция — сам игрок (`Control::Player`, `game.rs start_mode`) — ходатайствовать некому. В «истории как замысле» верхняя инстанция идёт по истории (`Control::Script`), её можно взять.
- **Директива без оси в ядре** (`command/agent.rs`, приход директивы штабу): при действующем замысле с осью меняет только `boundaries`, `fresh` не ставит — этим путём пойдёт ответ Ставки; фронт по сценарию (история) армиям сам полосу не делит — линию его фланговой армии надо довести.
- **Варианты советника** — только языковая модель (`planReq` → `planVariants`, `services/staff/src/live/plan.ts`). Схема `PLAN_SCHEMA`: приказ — `formation, task, area, toArea, why`, без оси, полос, главного удара; указание модели — «приказы — только тем, чья задача должна измениться» (подчинённые пропадают намеренно), несопоставленные имена — `ok: false`. В пункте управления принятый приказ становится `suggestionToDir` — задача и одна точка, без оси и линий. Без модели — «Советник не дал вариантов». Золотая кнопка «Составить советником (ИИ)» (`decision.compose.all`) — отдельная: модель пишет пять полей решения.
- **Составить по обстановке** — `draftField(f, v, DraftScope, d)` (`decision-drafts.ts`, чистая, без модели), вызывается кнопкой-листом; при новом ходе решение = пустое + замысел, замысел противника, риски с прошлого хода (`CommandView.tsx` ≈280); решения штабов нижних ступеней (`postDecisions`) не заполняются.
- **Варианты командующих** — `options_su / options_de / options_high(sim, hq, &Profile, &Picture) -> Vec<Choice>` и `decide::score`; командующие есть только у штабов с профилем (`rules.commanders.profiles[].hqs`). Раздел полосы между подчинёнными — `command::agent::plan(sim, h, &intent, replan) -> Vec<Directive>` (ось, части рубежей, левая/правая границы каждому действующему подчинённому); `Sim::fork()` — копия для расчёта «в уме».
- **Объекты**: в `TurnView` есть `places` (пункты театра), `own`, `intel`, `bridges` (только свои); рубежей театра (`theatre.data.lines`), всех мостов (`theatre.data.bridges`) и рек (`theatre.data.rivers`) в виде нет.

---

### Task 1: Решение составлено при открытии хода; «составить заново» с подтверждением

**Files:**
- Modify: `apps/editor/src/decision-drafts.ts` (две функции), `apps/editor/src/CommandView.tsx` (≈108, ≈280 — новый ход; `Decision` ≈1499–1560; монтирование ≈917), `apps/editor/src/voice/actions/staff.ts` (`decision.compose*`, разбор фраз ≈940–990), `apps/editor/src/styles.css` (`.dauto`), `docs/system.md` (абзац «Поля решения — составить», раздел 6)
- Test: `apps/editor/tests/decision-drafts.test.ts`, `apps/editor/tests/voice-staff.test.ts`

**Interfaces:**
- Produces:
  - `export function prefillDecision(v: TurnView, s: DraftScope, last: HumanDecision | null): { decision: HumanDecision; auto: DraftField[] }` — `assessment` и `report` — по обстановке всегда; `enemyIntent`, `intent`, `risks` — с прошлого хода, если там непусто, иначе по обстановке; `report` составляется после `intent` (видит его); `auto` — поля, составленные сейчас (не перенесённые); `request`/`petition` — пусто.
  - `export function ensurePost(m: Record<string, HumanDecision>, issuer: string, make: () => HumanDecision): Record<string, HumanDecision>` — есть решение штаба — тот же объект `m`; нет — `{ ...m, [issuer]: make() }`.
  - В `CommandView`: `autoFields: Record<string /* '' — верхняя инстанция, иначе id штаба */, DraftField[]>`; правка поля руками убирает его из `auto`.

- [ ] **Step 1: Падающие тесты** (`decision-drafts.test.ts`, фикстуры файла `v`, `scope`, `D`):
  - `prefill: оценка и донесение — по обстановке, замысел — с прошлого хода`: `last = { ...D, intent: 'Прорвать оборону у Зелова', enemyIntent: 'Держит высоты', risks: 'Контрудар', assessment: 'старая', report: 'старое' }` → `decision.intent === 'Прорвать оборону у Зелова'`, `decision.assessment === draftAssessment(v, scope())`, `decision.assessment !== 'старая'`, `decision.report` содержит `'Прорвать оборону у Зелова'`, `auto` равно `['assessment', 'report']`.
  - `prefill: без прошлого хода — составлены все пять полей`: `last = null` → `auto` равно `DRAFT_FIELDS`, все поля непусты.
  - `prefill: пустое поле прошлого решения составляется`: `last = { ...D, intent: 'X', risks: '' }` → `decision.risks === draftRisks(scope())`, `auto` содержит `'risks'`.
  - `ensurePost: правленое решение штаба не заменяется` (Review Focus 2): `m = { su_8gva: { ...D, intent: 'моё' } }` → `ensurePost(m, 'su_8gva', make)` — тот же объект, `make` не вызвана; `ensurePost(m, 'su_5ua', () => ({ ...D, intent: 'нов' })).su_5ua.intent === 'нов'`.
  - `voice-staff.test.ts`: `parseStaff('составь заново оценку обстановки')` → `{ id: 'decision.compose.replace', params: { field: 'assessment' } }`; `parseStaff('составь заново риски советником')` → `params` содержит `advisor: true`.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/decision-drafts.test.ts apps/editor/tests/voice-staff.test.ts` — FAIL: `prefillDecision is not a function`, фраза не разобрана.
- [ ] **Step 3: Реализовать** `prefillDecision`, `ensurePost`; в `CommandView`: на новом ходе (`liveView.current?.time !== m.view.time`) — `setDecision(prefillDecision(view, scope верхней инстанции, last).decision)` и `autoFields['']`; эффект по `[view?.time, post.issuer]` при `lowPost()` — `setPostDecisions((m) => ensurePost(m, issuer, …))` с `draftScope()` этого штаба и `autoFields[issuer]`; у поля из `auto` под заголовком — `<small className="dauto">составлено по обстановке — проверьте</small>`. Кнопка-лист при непустом поле — `title` «Составить заново по обстановке»; подтверждение `confirmAsync('Составить заново? Текст будет заменён черновиком по обстановке.', { ok: 'Составить заново' })`, искра — `'Составить заново советником? Текст будет заменён.'`. В `staff.ts` — разбор «составь заново <поле>[ советником]» → `decision.compose.replace`; `confirm` действия — `Составить ${поле} заново? Текст будет заменён.`
- [ ] **Step 4:** те же тесты — PASS; `npm run typecheck 2>&1 | tail -3` — без ошибок.
- [ ] **Step 5: Описание:** в «Поля решения — составить» — абзац: решение составляется при открытии хода (оценка и донесение — заново, замысел, замысел противника, риски — с прошлого хода или по обстановке; у таких полей пометка «составлено по обстановке — проверьте»; у штаба нижней ступени — при первом открытии его пункта); лист у заполненного поля — «составить заново» с подтверждением.
- [ ] **Step 6:** живой снимок вкладки «Решение» на первом ходу через мост (смотреть только он); `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` — без FAIL; коммит `feat(пункт управления): решение составляется при открытии хода, «составить заново» с подтверждением`.

### Task 2: Ядро — ходатайство в Ставку рассматривается по правилу

**Files:**
- Create: `crates/agents-core/src/command/petition.rs`
- Modify: `crates/agents-core/src/command/mod.rs` (`pub mod petition;`), `crates/agents-core/src/command/control.rs` (`CommandState.petitions`), `crates/agents-core/src/command/band.rs` (две функции), `crates/agents-core/src/command/agent.rs` (ветка директивы без оси ≈165–171), `crates/agents-core/src/game.rs` (`CommandOp::Petition`, `Game::petition`, `command_state` → `petitions`), `crates/agents-core/src/rules.rs` (`command.petition_min_share`), `packages/sim/data/rules/agents-v0.json` (`command.petitionMinShare`), `packages/sim/data/rules/norms.json` (строка `command-petition-min-share`, допущение по спецификации), `packages/sim/src/game.ts` (`CommandOp`), `apps/editor/src/sim/agents-game.ts` (`AgentGameTrace.command.petitions`, `CommandView.petitions`, `commandView`), `docs/system.md` (раздел 19.8 — ходатайство; раздел 6 «Полосы и директивы в игре»)
- Test: `crates/agents-core/tests/game.rs`, `crates/agents-core/src/command/petition.rs` (`#[cfg(test)]`), `apps/editor/tests/agents-command.test.ts`

**Interfaces:**
- Produces (Rust):
  - `pub const PETITION_RULE: &str = "ходатайство о разграничительной линии";`
  - `pub struct Petition { pub tick: u32, pub from: u32, pub neighbour: u32, pub line: Vec<XY>, pub note: String, pub accepted: bool, pub why: String }` — `CommandState.petitions: Vec<Petition>`.
  - `pub enum Verdict { Accept { share: f64 }, Reject(String) }`
  - `pub fn judge(main: &[XY], neighbour_ref: XY, line: &[XY], old: &Band, new: &Band, min_share: f64) -> Verdict` — чистая: главный удар отнят, если какая-либо точка `main` по другую сторону `line`, чем `neighbour_ref` (`band::side_of`); иначе `share = width_km(new) / width_km(old)`, `share < min_share` → отказ. Тексты отказа: `главный удар соседа оказался бы в нашей полосе` и `полоса соседа сузилась бы до {N} % прежней — меньше половины` (N — целое).
  - `pub fn submit(sim: &mut Sim, from: u32, neighbour: u32, line: Vec<XY>, note: String, tick: u32) -> bool` — документы и директивы (ниже); возвращает `accepted`.
  - `pub fn arrived(sim: &mut Sim, h: u32, d: &Directive, tick: u32)` — директива с `rule == PETITION_RULE` пришла штабу `h`: `Control::Agent` → `fresh[h] = true`; `Control::Script` → распоряжение (`Form::Instruction`, без оси, `rule: PETITION_RULE`, граница `(None, линия)`) его подчинённой армии, ближайшей к линии (`agent::place`); `Control::Player` → ничего.
  - `band.rs`: `pub fn width_km(b: &Band) -> f64` (среднее расстояние между равномерными точками левой и правой границы, `SAMPLES`); `pub fn side_of(line: &[XY], p: XY) -> f64` (знак векторного произведения с ближайшим отрезком).
  - `game.rs`: `CommandOp::Petition { from: String, neighbour: String, line: Vec<LngLat>, #[serde(default)] note: String }` (`op: "petition"`); `pub fn petition(&mut self, from: &str, neighbour: &str, line: &[LngLat], note: &str) -> Result<bool, String>`. Отказы в исполнении (Err, дословно): `Legacy` → `ходатайство — в режимах агентной модели`; верхняя инстанция стороны игрока `Control::Player` → `Ставку ведёте вы сами — ходатайствовать некому: линию задайте директивой фронтам`; `from` не `Control::Player` → `{имя} не под управлением игрока — сначала взять`; `from` или `neighbour` не ступени `Front` одной стороны и одного старшего → `{сосед} — не соседний фронт той же Ставки`; линия < 2 точек → `в линии меньше двух точек`.
  - Порядок `submit`: документ `DocKind::Report` от `from` к верхней инстанции — `Ходатайство: линия с {сосед} …{; note}`; решение `judge` по полосе соседа (`agent::frame` с его замыслом до и с заменой его границы с `from` — или ближайшей к `from` — на новую линию; нет замысла — пустой `Directive`); принято → две директивы `passing::issue` от верхней инстанции (`Form::Order`, без оси и рубежей, `boundaries: [(Some(другой), линия)]`, `rule: PETITION_RULE`, `note`) обоим фронтам и документ `DocKind::Directive` `Ходатайство {from} удовлетворено: разграничительная линия {from} / {сосед} — по новой линии; полоса {сосед} — {N} % прежней, главный удар не затронут`; отклонено → `DocKind::Notice` от верхней инстанции к `from`: `Ходатайство {from} отклонено: {причина}; линии прежние`. В обоих случаях — запись в `petitions` и событие журнала.
  - `command_state()["petitions"]`: `[{ "from", "neighbour", "tick", "accepted", "why" }]` — только своей стороны.
- Produces (TS): `CommandOp` += `{ op: 'petition'; from: string; neighbour: string; line: LngLat[]; note?: string }`; `CommandView.petitions: { from: string; neighbour: string; neighbourName: string; time: string; accepted: boolean; why: string }[]`.

- [ ] **Step 1: Падающие тесты.**
  - `petition.rs`: `judge_accepts_small_shift` (полоса 20 км, линия сдвинута на 3 км, главный удар у соседа → `Accept`, `share` ≈ 0,85); `judge_rejects_main_blow` (точка `main` за линией → `Reject` с «главный удар»); `judge_rejects_narrow` (новая полоса 8 км из 20 → `Reject` с «40 %»); `width_and_side` (`width_km` двух параллельных линий в 10 км = 10 ± 0,01; `side_of` меняет знак при переходе через линию).
  - `tests/game.rs` (Берлинская, `Mode::Intent`, `takeover 48`, `CommandOp::Take { hq: "su_1bf" }`; линия — граница 1 БФ / 1 УФ из `intent[su_1uf].boundaries` (или ближайшая к 1 БФ), сдвинутая в тесте функцией `shift(line, km)` на 3 км к 1 УФ):
    - `petition_accept_issues_to_both_fronts`: `petition(...) == Ok(true)`; в `documents` — `Report` от `su_1bf` и `Directive` от `su_stavka` с `to` ⊇ `["su_1bf", "su_1uf"]`; после `advance(passing_hours + 1)` в `intent[su_1uf].boundaries` есть линия, совпадающая с поданной (±0,01 км).
    - `petition_reject_explained`: сдвиг на 40 км → `Ok(false)`, `petitions[0].why` непусто, `Notice` от `su_stavka` начинается с `Ходатайство` и содержит `отклонено`; границы `su_1uf` прежние.
    - `petition_keeps_neighbour_on_history` (Review Focus 4): после принятия и `advance(12)` — `intent.hq[su_1uf].status == Status::History`, `command.control[su_1uf]` прежний.
    - `petition_refused_when_player_is_top`: `seelow_game(Mode::Agents, 0)` → `Err` содержит `Ставку ведёте вы сами`.
    - `petition_needs_taken_front`: intent-игра без `Take` → `Err` содержит `не под управлением игрока`.
    - `petition_player_de` (Review Focus 5): `Side::De`, `Take { hq: "de_hgr_weichsel" }`, сосед `de_hgr_mitte` → `Ok(_)`, документ ответа — от `de_hc`.
    - `petition_digest_unchanged`: прогоны из `tests/command.rs` с `SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST` — без изменений (запуск `--test command`).
  - `agents-command.test.ts`: `ходатайства — по своей стороне, с именем соседа и временем` (`commandView` фиктивного хода с `petitions` обеих сторон).
- [ ] **Step 2:** `cargo test -p agents-core petition 2>&1 | grep -E "test result|error"` — не компилируется; `npx vitest run apps/editor/tests/agents-command.test.ts` — FAIL.
- [ ] **Step 3: Реализовать** `petition.rs`, функции `band.rs`, поле `petitions` (в `CommandState::new` — пусто), команду и `Game::petition`, ветку в `agent.rs`: `if d.rule.as_deref() == Some(PETITION_RULE) { petition::arrived(sim, h, &d, tick); }` после `old.boundaries = d.boundaries`; правило `petition_min_share` с `value/range/note`; TS-типы и `commandView`.
- [ ] **Step 4:** `cargo test -p agents-core 2>&1 | grep "test result"` — все ok, отпечатки прежние; `npx vitest run apps/editor/tests/agents-command.test.ts` — PASS.
- [ ] **Step 5: Описание и база:** раздел 19.8 — «Ходатайство о разграничительной линии» (кто подаёт, правило, порог 0,5 — допущение, ответ документом, директива обоим фронтам, доведение до фланговой армии фронта, идущего по истории; в каких режимах — только где верхняя инстанция не у игрока); раздел 6 «Полосы и директивы в игре» — пункт «Модель-Ставка» уточнить: ходатайство на агентной модели рассматривает правило ядра. `npm run sim:norms -- --doc docs/norms-check.md`, `npm run kb:seed`, `npm run model:index`.
- [ ] **Step 6:** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`; коммит `feat(ядро): ходатайство в Ставку о разграничительной линии — рассмотрение по правилу`.

### Task 3: Ходатайство в интерфейсе — подаётся, где действует; скрыто с пояснением, где нет

**Files:**
- Create: `apps/editor/src/petition.ts`
- Modify: `apps/editor/src/sim/game-protocol.ts` (`HumanDecision.petition`), `apps/editor/src/CommandView.tsx` (поле ≈1552–1556, `sendTurn` ≈567, выбор точек на карте — `Pick` вида `{ kind: 'petition' }`, обработчик щелчка ≈368), `apps/editor/src/sim/game-worker.ts` (`advance()` ≈525: агентной игре ходатайство в модель-Ставку не передаётся), `apps/editor/src/voice/actions/staff.ts` (три действия), `apps/editor/tests/voice-completeness.test.ts` (исключения для выбора точек мышью, если появятся новые обработчики не через реестр), `docs/system.md` (раздел 6)
- Test: `apps/editor/tests/petition.test.ts`, `apps/editor/tests/voice-staff.test.ts`

**Interfaces:**
- Consumes: `CommandOp` `petition`, `CommandView.petitions` (задача 2); `local(s, v)` (`command-post.ts`).
- Produces:
  - `export interface PetitionDraft { neighbour: string; line: LngLat[]; note: string }`; `HumanDecision.petition?: PetitionDraft`.
  - `export interface PetitionState { show: boolean; who?: 'rules' | 'llm'; why: string; neighbours: { id: string; name: string }[] }`
  - `export function petitionState(v: TurnView, issuer: string | null, o: { stavkaLlm: boolean; llmOk: boolean; enemy: EnemyMode; umpire: boolean }): PetitionState` — порядок проверок и тексты (через `local`):
    1. нет `v.command` (нынешняя модель): `show` при `o.stavkaLlm && o.llmOk && (o.enemy === 'llm' || o.umpire)`, `who: 'llm'`; иначе `why` = `Ходатайство рассматривает модель-Ставка, а она сейчас не работает (выключена в «Посреднике» или модель не на связи) — подать некому.`
    2. верхняя инстанция стороны `control === 'player'` или пункт — она сама: `Ставку ведёте вы сами: линию между фронтами задайте директивой фронтам на уровне «Ставка» (вкладка «Приказы» → «Пункт управления»).`
    3. пункт не ступени `front`: `Ходатайство о линии между фронтами подаёт командующий фронтом — пункт управления уровня «Фронт».`
    4. пункт не взят (`taken(v, issuer)` ложно): `{имя} ведёт история или агент — ходатайство подаёт штаб под вашим управлением (вкладка «Штабы» → «взять»).`
    5. иначе `show`, `who: 'rules'`, `why` = `Рассматривает Ставка на этом ходу по правилу: линия принимается, если не отнимает у соседа главный удар и оставляет ему не меньше половины прежней полосы; ответ — документом Ставки, принятая линия — директивой обоим фронтам.`
    `neighbours` — штабы ступени `front` с тем же `parent`, кроме пункта, у которых есть свои войска в строю (`v.own`, подъём по `parent`).
  - `export function petitionOp(issuer: string, p: PetitionDraft | undefined): CommandOp | null` — `null`, если нет соседа или в линии < 2 точек.
  - `export function petitionText(p: PetitionDraft, name: (id: string) => string, places: Place[]): string` — для модели-Ставки нынешней модели: `Прошу установить разграничительную линию с {сосед} через {пункты по ближайшим к точкам, через «—»}. {note}`.
  - `export function petitionAnswer(v: TurnView, issuer: string): { time: string; accepted: boolean; text: string } | null` — последний ответ по `v.command.petitions` с `from === issuer`.
  - Действия голоса: `decision.petition.neighbour { name }`, `decision.petition.point { place }` (пункт по названию → точка в конец линии), `decision.petition.clear`; `available` — `petitionState(...).show || why`.

- [ ] **Step 1: Падающие тесты** (`petition.test.ts`, фикстура как `command-post.test.ts` + фронты `su_1bf`, `su_1uf`, `su_2bf` у `su_stavka`):
  - `скрыто: Ставку ведёт игрок` (`mode: 'agents'`, `su_stavka` `player`, пункт `su_1bf` взят) → `show: false`, `why` начинается с `Ставку ведёте вы сами`.
  - `история как замысел: взятый фронт подаёт, рассматривает правило` (`mode: 'intent'`, `su_stavka` `script`, `su_1bf` `player`) → `show: true, who: 'rules'`, `neighbours` = `su_1uf`, `su_2bf`.
  - `скрыто: фронт не взят` → `why` содержит `ведёт история или агент`.
  - `скрыто: пункт армии` → `why` содержит `подаёт командующий фронтом`.
  - `скрыто: нынешняя модель без модели-Ставки` (Review Focus 1: `command` нет, `llmOk: false`) → `why` содержит `подать некому`; с `llmOk: true, enemy: 'llm', stavkaLlm: true` → `show: true, who: 'llm'`.
  - `соседи — только фронты той же Ставки с войсками` (Review Focus 3): у `su_2bf` все дивизии `destroyed` → нет в `neighbours`.
  - `немецкая сторона — ОКХ` (Review Focus 5): `terms: { top: 'ОКХ', topGen: 'ОКХ', … }`, верхняя инстанция у игрока → `why` начинается с `ОКХ ведёте вы сами`.
  - `petitionOp`: линия из 1 точки → `null`; из 2 → `{ op: 'petition', from: 'su_1bf', neighbour: 'su_1uf', line, note }`.
  - `petitionAnswer`: два ответа → последний по времени, `accepted` и `text` = `why` или `линия принята`.
  - `voice-staff.test.ts`: `parseStaff('ходатайство о линии с первым украинским фронтом')` → `decision.petition.neighbour`; `parseStaff('добавь в ходатайство Котбус')` → `decision.petition.point { place: 'Котбус' }`.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/petition.test.ts apps/editor/tests/voice-staff.test.ts` — FAIL.
- [ ] **Step 3: Реализовать** `petition.ts`; в `Decision` вместо текстового поля — блок `data-hl="field-request"`: при `!show` — `<p className="note">{why}</p>`; при `show` — выбор соседа (`select`, `act('decision.petition.neighbour')`), линия «на карте» (`setPickMode({ kind: 'petition' })`, щелчок карты → точка в `petition.line`) и «пункт…» (`PlacePicker` → `decision.petition.point`), «очистить», `textarea` обоснования (`note`), подсказка `why`, последний ответ (`petitionAnswer`) — «принято» зелёным, «отклонено: …» красным; линия на карте — слой `plan`, пунктир `rkka.boundaryArmy` с подписью `Ходатайство: линия с {сосед}`. `sendTurn`: для агентной модели — `petitionOp` каждого решения штаба (`postDecisions`) в `command`; для нынешней — `decision.request = petitionText(...)`. `game-worker`: `stavkaNeed(ctx, g, side, side === rec.human && !agents ? queued.decision?.request ?? '' : '')`.
- [ ] **Step 4:** тесты — PASS; `npx vitest run apps/editor/tests/voice-completeness.test.ts` — PASS; typecheck.
- [ ] **Step 5: Описание:** раздел 6 «Полосы и директивы в игре» — ходатайство: где подаётся, кто рассматривает в каком режиме (таблица: режим — кто рассматривает — поле), что видно в ответ; заменить подпись снимка `game-directives.jpg`, если вид журнала изменился (в задаче 8 — пересъёмка).
- [ ] **Step 6:** живой снимок через мост: игра «История как замысел», взят 1-й Белорусский, ходатайство с линией на карте и ответ Ставки следующего хода; `npm test …`; коммит `feat(пункт управления): ходатайство в Ставку подаётся линией и рассматривается; где не действует — скрыто с пояснением`.

### Task 4: Приказы — выбор объекта из списка и точка цели на карте

**Files:**
- Create: `apps/editor/src/post-objects.ts`
- Modify: `apps/editor/src/sim/game-protocol.ts` (`TurnView.lines`, `TurnView.crossings`, `TurnView.rivers`), `apps/editor/src/sim/game-worker.ts` (сбор вида ≈691), `apps/editor/src/command-post.ts` (`DirDraft.immediateTitle`, `subsequentTitle`, `axisTitle`), `apps/editor/src/CommandPost.tsx` (`ObjectPicker` рядом с `Points`, действие `command.dir.object`), `apps/editor/src/CommandView.tsx` (слой `plan` ≈505–515: точка цели с подписью — и для открытого, ещё не сохранённого проекта), `apps/editor/tests/voice-completeness.test.ts` (исключения `CommandPost.tsx`: поиск по буквам, раскрыть список), `docs/system.md` (раздел 6, «Командование по ступеням в экране командования»)
- Test: `apps/editor/tests/post-objects.test.ts`

**Interfaces:**
- Consumes: `DirDraft`, `DirPick`, `recipients` (`command-post.ts`, `CommandPost.tsx`).
- Produces:
  - `TurnView.lines?: { id: string; name: string; line: LngLat[] }[]` (рубежи театра), `TurnView.crossings?: { id: string; name: string; at: LngLat }[]` (мосты театра, не разрушенные к ходу, с названием), `TurnView.rivers?: { name: string; line: LngLat[]; major: boolean }[]`.
  - `export type ObjKind = 'place' | 'line' | 'own' | 'enemy' | 'bridge';` `export const OBJ_KIND_RU: Record<ObjKind, string> = { place: 'Пункты', line: 'Рубежи', own: 'Свои', enemy: 'Противник', bridge: 'Мосты' };`
  - `export interface PostObject { kind: ObjKind; id: string; title: string; at: LngLat; line?: LngLat[] }`
  - `export function postObjects(v: TurnView): PostObject[]` — `places`; `lines` (`at` — середина линии); свои — штабы `v.command.hqs` и соединения `v.own` в строю (место — `UnitReport.at`); противник — `v.intel`; мосты — `crossings`.
  - `export function findObjects(list: PostObject[], q: string, from: LngLat | null, kind?: ObjKind, limit = 12): (PostObject & { km: number | null })[]` — подстрока без учёта регистра и «ё»; без запроса — ближайшие к `from`.
  - `export function applyObject(d: DirDraft, field: DirPick, o: PostObject, from: LngLat | null): DirDraft` — `immediate`/`subsequent`: рубеж → его линия, иначе `[o.at]`, название — в `immediateTitle`/`subsequentTitle`; `axis`: `[from ?? o.at, o.at]`, `axisTitle`; `boundaryR`/`boundaryL`: рубеж → линия, иначе точка в конец; `mainBlow`: свой штаб — переключить в `mainBlow` (только подчинённые получателя), иное — без изменений.
  - `export function objectiveMark(d: DirDraft, name: string): { at: LngLat; label: string } | null` — точка: единственная точка ближайшей задачи, середина её линии, иначе конец оси; подпись `${сокращённое имя}: ${DIR_TASK_RU[d.task]} — ${d.immediateTitle ?? d.axisTitle ?? 'указанная точка'}`; нет ни задачи, ни оси — `null`.
  - Действие `command.dir.object { field: DirPick, id?: string, name?: string }` (голос: «штаб, ближайшая задача — Зелов», «ось на Мюнхеберг», «правая линия по рубежу Зееловские высоты») — объект по `id` или первый по `findObjects(name)`.

- [ ] **Step 1: Падающие тесты** (`post-objects.test.ts`, фикстура: пункты `Зелов`, `Мюнхеберг`, рубеж `Зееловские высоты` из двух точек, мост `Мост у Кюстрина`, своя армия `su_8gva`, противник `de_ci`):
  - `объекты: пункты, рубежи, свои, противник, мосты` — по одному каждого `kind`, у рубежа `line` и `at` — середина.
  - `поиск по буквам и по удалению` — `findObjects(list, 'зел', null)[0].title === 'Зелов'`; без запроса — по возрастанию `km` от `from`.
  - `рубеж в ближайшую задачу — линией с названием` — `immediate` = линия рубежа, `immediateTitle === 'Зееловские высоты'`.
  - `пункт в ось — от места получателя` — `axis` = `[from, Зелов.at]`.
  - `свой штаб в главный удар — переключение` — дважды `applyObject(..., 'mainBlow', su_8gva)` возвращает `mainBlow` к `[]`.
  - `точка цели с подписью до отдачи` — `objectiveMark({ ...blankDir('su_8gva', 'front'), immediate: [Зелов.at], immediateTitle: 'Зелов' }, '8-я гвардейская армия')` → `{ at: Зелов.at, label: '8 гв. А: наступать — Зелов' }`; пустой проект → `null`.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/post-objects.test.ts` — FAIL.
- [ ] **Step 3: Реализовать** `post-objects.ts`, поля вида в `game-worker`, `ObjectPicker` (кнопка «из списка» у каждого поля точек: вкладки по `OBJ_KIND_RU`, поиск, строки с км; выбор → `act('command.dir.object', { field, id })`), действие в `usePost`, точку цели в слое `plan` (`std.unitOval` + `name` = подпись) для `post.draft` и проектов ступени.
- [ ] **Step 4:** тесты — PASS; `voice-completeness` — PASS; typecheck.
- [ ] **Step 5: Описание:** в «Командование по ступеням в экране командования» — выбор объекта из списка рядом с «на карте» (виды объектов, поиск), точка цели с подписью на карте до отдачи.
- [ ] **Step 6:** живой снимок: пункт фронта, директива армии, список объектов раскрыт, точка цели с подписью на карте; `npm test …`; коммит `feat(пункт управления): объекты из списка в задачах, линиях и оси; точка цели на карте до отдачи`.

### Task 5: «Указания» составляются по задаче и обстановке

**Files:**
- Create: `apps/editor/src/post-notes.ts`
- Modify: `apps/editor/src/command-post.ts` (`DirDraft.noteAuto`, `blankDir` — `noteAuto: true`), `apps/editor/src/CommandPost.tsx` (`put` пересчитывает указания при `noteAuto`; `command.dir.set { note }` → `noteAuto: false`; действие `command.dir.note.compose`; подпись и ссылка у поля), `docs/system.md` (раздел 6)
- Test: `apps/editor/tests/post-notes.test.ts`

**Interfaces:**
- Consumes: `DirDraft` с названиями объектов (задача 4), `recipients`, `DIR_TASK_RU`.
- Produces:
  - `export function draftNote(v: TurnView, d: DirDraft, o: { issuer: string; name: (id: string) => string }): string` — предложения по порядку, пустые пропускаются:
    1. `Задача — {задача}{: ближайшая — {immediateTitle}[ к {дд.мм чч:мм}]}{; последующая — {subsequentTitle}[ к …]}.`
    2. `Главный удар — {имена mainBlow через запятую}.`
    3. `Справа — {сосед}, слева — {сосед}.` — ближайшие получатели того же пункта по разные стороны оси проекта (ось — `d.axis` или от места получателя к точке цели).
    4. `Перед фронтом — {до трёх соединений разведки в 15 км от точки цели} ({место}).`
    5. `Подвоз не доходит — без пополнения.` / `Боеприпасы на исходе.` / `Горючее на исходе.` — по докладу получателя (`cutOff`, `ammo < 0.3`, `fuel < 0.3 && tanks > 0`).
    6. `Первый эшелон.` / `Второй эшелон — ввод по решению.` / `Ввод подвижной группы.` / `Резерв: {имена}.`
  - `export function withNote(d: DirDraft, v: TurnView, o: { issuer: string; name: (id: string) => string }): DirDraft` — при `d.noteAuto` — `{ ...d, note: draftNote(v, d, o) }`, иначе `d` без изменений.
  - Действие `command.dir.note.compose` (`irreversible`, `confirm`: `Указания будут заменены составленными по задаче и обстановке. Составить заново?`) — `noteAuto: true` и пересчёт.

- [ ] **Step 1: Падающие тесты** (`post-notes.test.ts`, фикстура из задачи 4 + соседи `su_5ua` справа и `su_69a` слева от оси, противник `de_ci` у Зелова):
  - `указания: задача, срок, главный удар, соседи, противник` — строка равна `'Задача — наступать: ближайшая — Зелов к 17.04 12:00. Главный удар — 4-й гв. ск. Справа — 5-я ударная армия, слева — 69-я армия. Перед фронтом — CI армейский корпус (у Зелова).'`.
  - `указания: подвоз и эшелон` — получатель `cutOff: true`, `echelon: 'second'` → содержит `Подвоз не доходит — без пополнения.` и `Второй эшелон — ввод по решению.`
  - `правленые вручную указания не заменяются при смене задачи` (Review Focus 2): `withNote({ ...d, task: 'defend', noteAuto: false, note: 'моё' }, v, o).note === 'моё'`; с `noteAuto: true` — пересчитано и содержит `оборонять`.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/post-notes.test.ts` — FAIL.
- [ ] **Step 3: Реализовать** `draftNote`, `withNote`; `put` в `usePost` зовёт `withNote`; у поля «Указания» — `<small className="muted">составлены по задаче и обстановке — правьте</small>` при `noteAuto`, иначе ссылка «составить заново» (`ActButton action="command.dir.note.compose"`).
- [ ] **Step 4:** тесты — PASS; `voice-completeness` — PASS; typecheck.
- [ ] **Step 5: Описание:** абзац об «Указаниях»: составляются автоматически (что входит), правка руками останавливает пересчёт, «составить заново» — с подтверждением.
- [ ] **Step 6:** живой снимок формы директивы с составленными указаниями; `npm test …`; коммит `feat(пункт управления): указания составляются по задаче и обстановке`.

### Task 6: Ядро — варианты решения по правилам (варианты командующих) на всех подчинённых

**Files:**
- Create: `crates/agents-core/src/commander/variants.rs`
- Modify: `crates/agents-core/src/commander/mod.rs` (`pub mod variants;`), `crates/agents-core/src/commander/profile.rs` (`Profile::neutral`), `crates/agents-core/src/game.rs` (`Game::variants`), `crates/agents-core/src/bin/agents-game.rs` (команда `game_variants`), `crates/agents-tauri/src/lib.rs` (`#[tauri::command] pub fn game_variants`), `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/build.rs` (`COMMANDS`), `apps/desktop/src-tauri/capabilities/default.json` (`"allow-game-variants"`; `permissions/autogenerated/game_variants.toml` создаёт сборка), `apps/agents/src-tauri/src/main.rs` (обработчик), `docs/system.md` (раздел 19.13 — варианты для игрока)
- Test: `crates/agents-core/tests/game.rs`

**Interfaces:**
- Produces (Rust):
  - `pub struct Variant { pub kind: &'static str, pub label: String, pub rule: &'static str, pub score: f64, pub intent: Directive, pub orders: Vec<Directive> }`
  - `pub fn options_for(sim: &Sim, hq: u32) -> Vec<Choice>` — варианты командующего по стороне и ступени (как `decide::decide`: `options_su` / `options_high` / `options_de`) с профилем штаба, нет профиля — `Profile::neutral(&id)` (мотивы `[1.0 / 7.0; 7]`, черты — средние); плюс общие: `Continue` («Продолжать выполнение задачи»), `Hold` («Перейти к обороне на занятых рубежах»), `ShiftMainBlow { to: [k] }` для двух подчинённых-штабов, ближайших к противнику; без `Permit`/`Forbid`.
  - `pub fn realize(sim: &Sim, hq: u32, k: &Kind) -> (Directive, Vec<Directive>)` — замысел штаба (`sim.command.intent[hq]`, нет — оборона на месте: `Task::Defend`, рубеж — места подчинённых) с поправкой по виду (`Hold` → `Task::Defend`; `ShiftMainBlow` → `main_blow`), затем `agent::plan(&mut sim.fork(), hq, &intent, false)` — по директиве каждому действующему подчинённому (`subs_of`); затем поправка получателя по виду: `TurnToRival/Assign/Counterattack/Relief` → его задача `Attack`, ближайшая — `[at]`, ось — `[место, at]`; `Encircle` → армии котла — `Attack` к центру котла; `CommitSecond/CommitMobile` → эшелон «введён» (`commit`); `Withdraw` → `Withdraw` к `apply::rear_of`; `MoveReserve` → `Move` к `to`; `Breakout` → все — `Attack` к `toward`.
  - `pub fn variants(sim: &Sim, hq: u32, n: usize) -> Vec<Variant>` — `n` в `1..=3`; по убыванию `decide::score` (мотивы профиля, `continuing` — по действующему решению командующего), без повторов вида; «продолжать» есть всегда (последним, если не попал в лучшие); мир не меняется.
  - `Game::variants(&self, hq: &str, n: usize) -> Result<Value, String>` — `hq` своей стороны; JSON: `[{ "kind", "label", "rule", "score", "axis": [[lng, lat]], "mainBlow": [id], "orders": [{ "to", "task", "form", "axis", "immediate", "subsequent", "right", "left", "commit", "echelon", "note" }] }]` (точки — `proj.to_lnglat`; `right`/`left` — правая и левая граница полосы получателя по ходу оси; задача — строкой `Task` как в `PlayerDirective`). Виды `kind`: `continue, hold, shift_main_blow, turn_to_rival, encircle, commit_second, commit_mobile, withdraw, counterattack, breakout, relief, move_reserve, assign`.
  - Команда `game_variants { hq: string, n: number }` — в бинаре, Tauri и мосте (мост пропускает команды ядра без изменений).

- [ ] **Step 1: Падающие тесты** (`tests/game.rs`):
  - `variants_cover_all_subs`: Берлинская, `Mode::Intent`, `takeover 48`, `Take su_1bf` → `g.variants("su_1bf", 3)`: от 2 до 3 вариантов, виды различны, у каждого `orders[*].to` как множество равно действующим подчинённым `su_1bf` (`command::control::active_subs`), у каждого приказа `right` и `left` ≥ 2 точек, `axis` — 2 точки; есть вид `continue`.
  - `variants_read_only`: `g.sim.digest()` до и после `variants` равны.
  - `variants_destroyed_sub_absent` (Review Focus 3): все дивизии `su_3ua` переведены в `State::Destroyed` → ни в одном варианте нет приказа `su_3ua`.
  - `variants_army_level`: `variants("su_8gva", 2)` — ≥ 2 варианта, приказы корпусам армии.
  - `variants_agents_mode_top`: `seelow_game(Mode::Agents, 0)` → `variants("su_stavka", 1)` — приказы фронтам стороны.
  - `variants_de` (Review Focus 5): `Side::De`, `Take de_hgr_weichsel` → ≥ 1 вариант, приказы его армиям.
  - `variants_bad_hq`: чужой штаб → `Err` содержит `нет штаба`.
- [ ] **Step 2:** `cargo test -p agents-core --test game variants 2>&1 | grep -E "test result|error"` — не компилируется.
- [ ] **Step 3: Реализовать** `variants.rs`, `Profile::neutral`, `Game::variants`, команду во всех трёх местах вызова; `cargo build --release -p agents-core --bin agents-game` для моста.
- [ ] **Step 4:** `cargo test -p agents-core 2>&1 | grep "test result"` — ok, отпечатки прежние; `node scripts/agents-bridge.mjs --check` — без ошибок.
- [ ] **Step 5: Описание и база:** раздел 19.13 — «Варианты для игрока»: из каких вариантов командующего собираются, как раскладываются на подчинённых (раздел полосы), что мир не меняется; `npm run kb:seed`, `npm run model:index`.
- [ ] **Step 6:** `npm test …`; коммит `feat(ядро): варианты решения по правилам — задачи, полосы и оси всем подчинённым`.

### Task 7: «Варианты советника» — одна кнопка, полные варианты, на карте, принять целиком или с правкой

**Files:**
- Create: `apps/editor/src/plan-rules.ts`
- Modify: `apps/editor/src/sim/game-protocol.ts` (`PlanVariantView.source`, `.dirs`, `.kept`, `.filled`; `VariantDir`; запрос `plan-rules`, ответ `plan-rules`), `apps/editor/src/sim/game-worker.ts` (обработчик `plan-rules` → `agentsCall('game_variants', …)`), `apps/editor/src/CommandView.tsx` (`Decision`: блок `.ai-compose` убран, `.plan-cta` — одна кнопка; `askPlan`, `applyPlan(idx, only, edit)`, `PlanBlock` ≈1449–1490; слой `plan` — открытый вариант), `apps/editor/src/voice/actions/staff.ts` (`command.variants`, `command.variant.pick { edit }`, `decision.compose.all` — подсветка `field-assessment`), `apps/editor/src/voice/actions/turn.ts` (предложение «Попросить варианты» ≈146 — без модели тоже), `apps/editor/src/styles.css` (`.plan-src`), `docs/system.md` (раздел 6 «Поля решения», «Советник»)
- Test: `apps/editor/tests/plan-rules.test.ts`, `apps/editor/tests/voice-staff.test.ts`

**Interfaces:**
- Consumes: `game_variants` JSON (задача 6); `draftField`, `DraftScope` (задача 1); `DirDraft`, `toDirective`, `recipients`, `queueOp`, `suggestionToDir` (`command-post.ts`); `StaffScope`, `priorityPool`, `priorityLimit` (`post-staff.ts`); `TurnView.rivers`, `crossings` (задача 4); `withNote` (задача 5).
- Produces:
  - `export interface CoreOrder { to: string; task: string; form: 'order' | 'instruction'; axis: LngLat[]; immediate: LngLat[]; subsequent: LngLat[]; right: LngLat[]; left: LngLat[]; commit?: boolean; echelon?: 'first' | 'second' | null; note: string }` и `export interface CoreVariant { kind: string; label: string; rule: string; score: number; axis: LngLat[]; mainBlow: string[]; orders: CoreOrder[] }`.
  - `game-protocol.ts`: `export interface VariantDir extends CoreOrder { name: string; mainBlow: string[]; filled?: boolean }`; `PlanVariantView` += `source?: 'llm' | 'rules'`, `dirs?: VariantDir[]`, `kept?: string[]` (без новых приказов — прежние задачи), `filled?: string[]` (дополнены правилом); `GameRequest` += `{ kind: 'plan-rules'; id: number; count: number; hq: string | null }`; `GameResponse` += `{ kind: 'plan-rules'; id: number; ok: boolean; variants?: CoreVariant[]; error?: string }`.
  - `export const RULES_MARK = 'по правилам, без модели';`
  - `export function fromCore(v: TurnView, s: DraftScope, issuer: string, c: CoreVariant, scope: StaffScope | null): PlanVariantView` — `title = c.label`, `idea = c.rule`, `source: 'rules'`, `dirs` по `orders` (имена — `v.command.hqs`/`v.own`), решение — `draftField` всех пяти полей, где `intent` = `${c.label}. ${dirs словами: «8 гв. А — наступать: Зелов»; через «; »}.`, `orders: []`, `acts = ruleActs(...)`.
  - `export function completeVariant(v: TurnView, issuer: string | null, llm: PlanVariantView, base: CoreVariant | null): PlanVariantView` — пункт управления (`issuer`): по каждому получателю `recipients(v, issuer)` — приказ модели (задача, точка) с геометрией (`axis`, `right`, `left`, `subsequent`) из `base` того же получателя; без приказа модели — приказ `base` с `filled: true`; приказы модели не получателям — `ok: false`, `issue: 'выбыл или не в подчинении'`; нынешняя модель (`issuer === null`): `kept` — имена действующих объединений `v.own` без приказа в варианте.
  - `export function ruleActs(v: TurnView, scope: StaffScope | null, dirs: VariantDir[]): PlanActView[]` — приоритет подвоза: получатели на главном ударе и наступающие (не больше `priorityLimit`), ключ `priority`; база: действующая база, у войск которой подвоз дальше `v.rangeHours`, — к ближайшему своему пункту по направлению к центру войск (`base:{id}`); переправа: первая точка пересечения оси наступающего с большой рекой (`v.rivers`, `major`), если в 3 км нет моста или переправы (`v.crossings`, `v.bridges`) и есть свободный парк (`v.parksBy?.[issuer]` или `v.parks`), — `bridge:rule{i}`; без пункта управления (`scope === null`) — те же правила по `v.own`.
  - `export function variantFeatures(p: PlanVariantView, name: (id: string) => string): { kind: 'arrow' | 'line' | 'point'; pts: LngLat[]; name: string }[]` — ось — стрелка, правая и левая линии — линии, точка цели — точка (`objectiveMark`), переправы и базы — точки; у нынешней модели — стрелки `orders[].at`.
  - `export function dirDraftOf(d: VariantDir, level: LevelId): DirDraft` — `{ ...blankDir(d.to, level), task: dirTaskOf(d.task), form, axis, immediate, subsequent, boundaries: [d.right, d.left], mainBlow, commit, echelon, note, noteAuto: !d.note }`.
  - `export function planFallback(rules: PlanVariantView[], llm: { done: boolean; ok: boolean; error?: string; count: number }): { variants: PlanVariantView[]; warning?: string }` — модель недоступна (`!llm.done && !llm.count`) или ответила без вариантов — `rules`; при ошибке — `warning` `Советник не ответил ({error}) — показаны варианты по правилам.`
  - `export function historyLoss(v: TurnView, dirs: VariantDir[]): string[]` — в режиме `intent` имена получателей-штабов, не взятых игроком и не ведомых им (`control !== 'player' && !led`).
  - `applyPlan(idx: number, only: boolean, edit = false): Promise<string>` в `CommandView` — целиком: решение, по `dirs` — `queueOp(directive)` (`toDirective(dirDraftOf(d, level), view)` с `issuer`), распоряжения; `edit` — `dirs` в проекты пункта (`post.dirs`, без очереди), вкладка «Приказы» → «Пункт управления», открыт первый получатель; ответ голосом — сколько приказов в очереди или в проекте.

- [ ] **Step 1: Падающие тесты** (`plan-rules.test.ts`, фикстура пункта фронта из `command-post.test.ts` + доклады и база):
  - `варианты по правилам — всем подчинённым, с пометкой` — `fromCore(...)`: `source === 'rules'`, `dirs.map(d => d.to)` = получатели пункта, у каждого `right`/`left` непусты, `decision.intent` начинается с `c.label`.
  - `дополнение варианта модели правилом` — приказ модели одной армии из двух → `dirs` по обеим, у второй `filled: true`, у первой — задача модели и `right` из `base`; `filled` = имя второй.
  - `приказ выбывшему — снят с пометкой` (Review Focus 3) — приказ модели дивизии `destroyed` → не в `dirs`, в `orders` `ok: false`, `issue === 'выбыл или не в подчинении'`.
  - `нынешняя модель — без новых приказов названы` — `issuer: null`, у одной из трёх армий приказ → `kept` — две другие.
  - `тыл и переправы по правилам` — подвоз армии 30 ч при `rangeHours: 24` → act `base:…`; ось через большую реку без моста → act `bridge:rule0` с `at` на реке; приоритет — главный удар.
  - `на карте — ось, линии, точка цели` — `variantFeatures` даёт для каждого `dirs[i]` стрелку и две линии, имена с именем получателя.
  - `historyLoss: получатели по истории названы` (Review Focus 4) — `mode: 'intent'`, `su_1uf` `script` → `['1-й Украинский фронт']`; взятый — пусто.
  - `без модели — варианты по правилам с пометкой` и `модель не ответила — варианты по правилам с предупреждением` (Review Focus 1) — `planFallback`: модель недоступна → правила без предупреждения; `ok: false, error: 'таймаут'` и 0 вариантов модели → правила, `warning === 'Советник не ответил (таймаут) — показаны варианты по правилам.'`.
  - `voice-staff.test.ts`: `parseStaff('принимаю второй и поправлю')` → `command.variant.pick { n: 2, edit: true }`; `command.variants` доступно при `advisorReady: false` и агентной модели.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/plan-rules.test.ts apps/editor/tests/voice-staff.test.ts` — FAIL.
- [ ] **Step 3: Реализовать** `plan-rules.ts`; протокол и обработчик потока (`hq` нет — верхняя инстанция стороны; нет агентной модели — `ok: false, error: 'варианты по правилам — в игре на агентной модели'`); `askPlan(count)`: агентная модель — сначала `plan-rules` (быстро, база для дополнения и запас), модель на связи — затем `plan` как прежде, каждый `plan-variant` → `completeVariant` с базой вида `continue`; модель не на связи или `plan-done` без вариантов — `planFallback`. `Decision`: убрать блок «Составить советником (ИИ)»; `.plan-cta` — `select` 1–3 (`command.variants.count`) и главная кнопка `StaffButton action="command.variants"` «Варианты советника», подпись — `советник (ИИ) и правила: задачи всем подчинённым, полосы, ось, резервы, тыл, переправы` / `советник не на связи — варианты по правилам (варианты командующих)`; нынешняя модель без связи — кнопка недоступна, `title`: `Советник не на связи; варианты по правилам — в игре на агентной модели`. `PlanBlock`: у варианта `source === 'rules'` — `<i className="plan-src">{RULES_MARK}</i>`; список `dirs` («{имя} — {задача}: {цель}», `filled` — «дополнено правилом»), `kept` — «без новых приказов: …»; кнопки «Принять целиком» (`command.variant.pick { n }`), «Принять и поправить» (`command.variant.pick { n, edit: true }`), ссылка «только решение»; перед принятием целиком при `historyLoss` непусто — `confirmAsync('Директивы снимут с истории: {имена}. Принять вариант?', { ok: 'Принять' })`. Слой `plan`: раскрытый непринятый вариант — `variantFeatures` (прозрачность 0,45, подписи «вариант N: …»).
- [ ] **Step 4:** тесты — PASS; `npx vitest run apps/editor/tests/voice-completeness.test.ts apps/editor/tests/voice-staff.test.ts` — PASS; typecheck.
- [ ] **Step 5: Описание:** «Поля решения — составить» — убрать абзац и снимок про «Составить советником (ИИ)» (кнопки нет; поле советником — искрой у поля); «Советник» — одна кнопка «Варианты советника»: что входит в вариант, дополнение правилом, без модели — варианты командующих с пометкой, на карте, «принять целиком» / «принять и поправить», предупреждение в «истории как замысле». Ссылки на раздел 9.1 и подписи снимков `decision-ai.jpg`, `game-advisor-plans.jpg` — сверить (пересъёмка — задача 8).
- [ ] **Step 6:** живые снимки через мост: варианты по правилам (без модели) — список и вариант на карте; принятый «с правкой» — проект в пункте управления; `npm test …`; коммит `feat(советник): «Варианты советника» — полные варианты всем подчинённым, по правилам без модели, на карте`.

### Task 8: Голос, снимки и сборка описания

**Files:**
- Modify: `apps/editor/tests/voice-completeness.test.ts` (исключения — только если новые обработчики не через реестр, с причиной), `scripts/voice-e2e.mjs` (часть `game`: шаги «составь заново оценку обстановки», «ходатайство о линии с …», «ближайшая задача — Зелов», «варианты советника», «принимаю первый и поправлю»), `docs/system.md` (раздел 9.1 — новые фразы; подписи снимков), `docs/img/decision-ai.jpg` (удалить, если абзац убран, — и ссылку), `docs/img/game-advisor-plans.jpg`, `docs/img/game-directives.jpg`, `docs/img/command-post-army.jpg`, новые `docs/img/post-objects.jpg`, `docs/img/post-petition.jpg`, `docs/img/post-variants-map.jpg`; `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`
- Test: `apps/editor/tests/voice-completeness.test.ts`, `scripts/voice-e2e.mjs --only game`

**Interfaces:**
- Consumes: действия `decision.compose.replace`, `decision.petition.*`, `command.dir.object`, `command.dir.note.compose`, `command.variants`, `command.variant.pick { edit }` (задачи 1, 3–5, 7).

- [ ] **Step 1:** добавить шаги в часть `game` `scripts/voice-e2e.mjs` (каждый — фраза, ожидаемое действие и признак на экране: поле с пометкой, линия ходатайства, точка цели с подписью, бейдж `по правилам, без модели`, проект в пункте управления).
- [ ] **Step 2:** `node scripts/voice-e2e.mjs --only game > <scratchpad>/voice.log 2>&1` в фоне; итог: `grep -c '^ok'` и `grep -v '^ok' | tail` — без отказов.
- [ ] **Step 3:** раздел 9.1 — фразы; снимки (Playwright 1440×900, JPEG, через мост): «Решение» с пометками «составлено по обстановке», ходатайство с линией и ответом, список объектов и точка цели, вариант по правилам на карте, журнал с ответом Ставки; подписи курсивом — то, что видно; ссылки на разделы («раздел 19.8», «19.13») проверить.
- [ ] **Step 4:** `npm run kb:seed`, `npm run model:index`, `CHROMIUM_PATH=… npm run docs:system` — `docs/system.pdf`, `docs/system.docx` пересобраны без ошибок.
- [ ] **Step 5:** `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `cargo test -p agents-core 2>&1 | grep "test result"` — без ошибок и FAIL.
- [ ] **Step 6:** коммит `docs(пункт управления): описание, голос и снимки этапа 4`.
