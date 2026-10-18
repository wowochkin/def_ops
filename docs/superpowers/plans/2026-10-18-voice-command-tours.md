# Голос: командование без рук и туры — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в голосовом режиме вся работа — от запуска до разбора операции в «Командовании» — без прикосновения к
компьютеру; туры с подсветкой по каждому разделу и вступительный тур о приложении.

**Architecture:** окно (`apps/editor/src/voice`): реестр действий — единственный путь и для кнопок, и для голоса;
разборщик с подтверждением необратимого; `places.ts` — места и соединения по названию; `tour.tsx` — движок
тура поверх любого раздела; тексты туров — `voice/tours/*.ts`. Сервис голоса не меняется, кроме роли
посредника в `say` (уже есть).

**Tech Stack:** TypeScript, React, vitest, Playwright (поддельный микрофон, `--fake`, поддельная LM Studio).

**Spec:** `docs/superpowers/specs/2026-10-18-voice-command-tours-design.md` (и основная
`2026-10-17-voice-control-design.md`, «Кто пользуется», разделы 4–5).

**Опись** (файлы, строки, обработчики): `.superpowers/sdd/2026-10-18-voice-command-tours/inventory.md`.

## Global Constraints

- Русский язык интерфейса, текстов, комментариев, коммитов; коммиты с двумя строками атрибуции сессии.
- Пользователи — пожилые эксперты: простые слова, крупно (панель ≥ 18 px), без технических терминов, честно о
  возможностях; ответы штаба 1–3 фразы, числа словами (`speakable`).
- Кнопка и голос вызывают одно действие реестра; `available()` проверяет активный раздел и состояние (раздел
  «Переигровка» смонтирован и в фоне).
- Необратимое (`irreversible: true`) голосом — только после «да»; подтверждение ждёт 15 с.
- «Штаб, отбой» — дежурный режим (микрофон открыт, только «Штаб, на связь»); кнопка «Выключить голос» —
  микрофон закрыт.
- Подсветка — только по `data-tour="…"`; у каждого шага тура `target` существует в исходниках.
- Перед коммитом: `npm run typecheck`, `npm test`; при изменении окна — `VOICE_PYTHON=… node scripts/voice-e2e.mjs`
  (и `--no-stub`). Описание (`docs/system.md`, `docs/guide.md`, снимки, PDF/DOCX) — в Task 9, остальные задачи
  описание не трогают.

## Review Focus

- Голосом исполняется действие, недоступное сейчас (раздел в фоне, игра не идёт, расчёт хода) — не исполняется,
  причина простыми словами (Task 5–7, тесты).
- «Да», сказанное после истечения 15 с или после новой просьбы, не проводит ход (Task 1, 7, тест).
- Похожие названия мест/соединений («Зелов» / «Зеловские высоты», «восьмая» / «восьмая гвардейская») — не
  выбирается молча неверное: переспрос с вариантами (Task 2, тест).
- Тур не ломается, когда элемента нет или раздел сменился посреди тура; «хватит» снимает притемнение
  полностью (Task 3, e2e).
- Дежурный режим не исполняет ничего, кроме «на связь»; эхо собственной фразы штаба его не будит (Task 1, тест).

---

### Task 1: Без рук — дежурный режим, подтверждение, окна голосом

**Files:** `voice/dispatch.ts`, `voice/registry.ts`, `voice/VoicePanel.tsx`, `voice/panel-state.ts`,
`voice/Calibration.tsx`, `voice/Voices.tsx`, `dialogs.ts`, new `voice/dictation.ts`, `voice/actions/shell.ts`;
tests `apps/editor/tests/voice-*.test.ts`; `scripts/voice-e2e.mjs`.

**Interfaces — Produces:**
- `Dispatcher` — состояние подтверждения: `pending: { action, params, text, until }`; «да/нет/отмена» и синонимы
  («так точно», «подтверждаю», «отставить»); модель на необратимое — через то же подтверждение.
- Режим «дежурю»: событие окна `voice:standby` (`detail: boolean`); в дежурном — исполняется только
  `shell.wake` («Штаб, на связь / подъём / включись»).
- `dialogs.ts`: открытое окно регистрирует временные действия `dialog.answer {choice}` (да/нет/вариант по номеру
  или названию), `dialog.text {text}` (для `askText`), штаб зачитывает вопрос; снятие — при закрытии.
- `dictation.ts`: `fieldActions(id: string, title: string, get: () => string, set: (s: string) => void)` →
  действия `<id>.write {text}`, `<id>.append {text}`, `<id>.clear`, `<id>.read`; `readAloud(text)` — по частям с
  «дальше»/«хватит».
- Действия: `voice.calibrate.*` (старт, «готово», «заново», закрыть), `voices.preview {name}`,
  `voices.assign {name, role}`, `voices.record {name}`, `voices.delete {name}` (irreversible), `voices.close`.
- Голос включён по умолчанию; первый запуск без калибровки — предложение калибровки после вступления (флаг
  для Task 3: событие `voice:ready-first`).

- [ ] Тесты: подтверждение — «да» исполняет; «нет», 15 с, новая просьба — отмена; «да» после отмены — ничего;
  модель вызывает необратимое → вопрос, не исполнение. Дежурный: «Штаб, открой карты» не исполняется, «Штаб,
  на связь» — будит; фраза штаба (эхо) не будит. Окно `confirmAsync` — «да» нажимает «ОК»; `chooseAsync` —
  «второй»; `askText` — диктовка. Калибровка и окно «Голоса» проходят без щелчков (e2e). Диктовка в поле и
  чтение по частям.
- [ ] Реализация; проверки; коммит «Голос без рук: дежурный режим, подтверждение, окна голосом».

### Task 2: Места и соединения по названию

**Files:** new `apps/editor/src/voice/places.ts`, test `apps/editor/tests/voice-places.test.ts`.

**Interfaces — Produces:**
- `findPlace(text: string, places: Place[]): { place?: Place; options: Place[] }` — нестрогое сравнение
  (нормализация ё/регистра/дефисов, падежные окончания, расстояние Левенштейна с порогом от длины, исходное
  латинское название в скобках); однозначно — `place`, иначе 2–3 `options`.
- `parseRelative(text): { km: number; dir: Rumb; ref: string } | null` («восемь километров северо-восточнее
  Зелова», «в 5 км к западу от …») и `nearestPlace(at: LngLat, places): Place`.
- `findUnit(text, units: { id: string; name: string }[]): { unit?; options }` — номера словами и цифрами,
  порядковые («восьмая гвардейская» ↔ «8 гв. А», «29-й ск»), сокращения из `short()` CommandView.
- Без зависимостей от React; данные — `TurnView.places`, `own`, `intel`, `groups`.

- [ ] Тесты на реальных данных театра `oder-berlin-1945` и сценария (через `@def-ops/sim`): «Зеловские высоты»,
  «Зелов», «Кюстрин» (рус/нем), неоднозначность → варианты, «восемь километров северо-восточнее Зелова»,
  «восьмая гвардейская», «первый гвардейский танковый», «пятая ударная»; обычное слово не даёт места.
- [ ] Реализация; коммит «Голос: места и соединения по названию».

### Task 3: Движок тура и вступление

**Files:** new `voice/tour.tsx`, `voice/tours/index.ts`, `voice/tours/intro.ts`, `voice/tours/voice-panel.ts`,
`voice/actions/tour.ts`, `styles.css`; `Shell.tsx` (`data-tour` на колонке и разделах), `VoicePanel.tsx`
(`data-tour`, флажок «Вступление при запуске»); tests `voice-tour.test.ts`, e2e.

**Interfaces — Produces:**
- `type TourStep = { target: string; title: string; text: string; more?: string; example?: string;
  prepare?: { action: string; params?: unknown }; unavailable?: string }`; `type Tour = { id: string;
  section: Section | 'intro' | 'voice'; title: string; steps: TourStep[] }`.
- `startTour(id)`, `stopTour()`; действия `tour.start {section?}`, `tour.intro`, `tour.next`, `tour.back`,
  `tour.repeat`, `tour.more`, `tour.pause`, `tour.resume`, `tour.stop`, `tour.introOff`.
- Озвучка шага — через тот же путь, что ответы штаба (роль `chief`), конец речи → следующий шаг.
- Вступление при запуске (настройка `localStorage['def_ops.voice.intro']`, по умолчанию вкл.); после него —
  предложение калибровки, если её не было (`voice:ready-first` из Task 1).
- Предложение тура при первом входе в раздел (`localStorage['def_ops.tour.seen']`).

- [ ] Тесты: каждый `target` всех туров есть в исходниках (`data-tour="…"` grep), каждое `prepare` —
  существующее обратимое действие; движок: нет элемента → `unavailable`, смена раздела → тур остановлен или
  продолжен по `prepare`; «хватит» снимает притемнение. e2e: вступление с подсветкой кнопок колонки, «дальше»,
  «назад», «хватит»; снимок.
- [ ] Реализация (тексты вступления — по `docs/system.md` часть I, без выдумок); коммит «Голос: туры —
  движок и вступление».

### Task 4: Туры разделов (кроме Переигровки и Командования) и вкладки голосом

**Files:** new `voice/tours/{editor,modeling,maps,library,knowledge,staff}.ts`, `voice/actions/tabs.ts`;
`data-tour` в `App.tsx`, `Palette.tsx`, `Timeline.tsx`, `LayersPanel.tsx`, `Inspector.tsx`,
`modeling/ModelingView.tsx` (+ вкладки), `Shell.tsx` (Карты, ИИ), `TheatreView.tsx`, `MapsPanel.tsx`,
`library-page.tsx`, `KnowledgeView.tsx`; tests.

**Interfaces — Produces:** действия `modeling.tab {tab}`, `knowledge.tab {tab}`, `maps.tab {tab}` (через
существующие события/состояние вкладок); туры 6–12 шагов, каждый говорит, что в разделе можно голосом.
Подсветка внутри iframe «Знаки» (`iframe.contentDocument`).

- [ ] Тесты: targets/prepare (общий тест Task 3), вкладки голосом; e2e — тур «Знаки» (iframe) и «Моделирование».
- [ ] Реализация; коммит «Голос: туры по разделам, вкладки голосом».

### Task 5: Командование голосом — вход, обстановка, карта

**Files:** new `voice/actions/command.ts` (общие помощники), `ReplayView.tsx`, `CommandView.tsx`
(вкладки, доклады, разведка, карта, туман, выход), `Sectors.tsx`; tests `voice-command.test.ts`.

**Interfaces — Consumes:** Task 1 (подтверждение, окна, диктовка), Task 2 (`findPlace`, `findUnit`).
**Produces:** `replay.calc {operation?}`, `replay.takeCommand {at?}`, `replay.continue`, `command.enemyMode`,
`command.tab {tab}`, `command.report` (доклад обстановки по `TurnView` без модели, «подробнее»),
`command.intel`, `command.unit.report {name}`, `command.unit.show {name}`, `command.journal.read {day?}`,
`map.level`, `map.layer {layer, on}`, `map.sector {name}`, `map.show {place|unit}`, `map.zoomIn`, `map.zoomOut`,
`map.legend`, `command.reveal {on}`, `command.exit`, `command.discard` (irreversible).
Кнопки этих мест переведены на `ActButton`/`act`.

- [ ] Тесты (vitest, компоненты с поддельным Worker или чистые функции доклада): доклад обстановки — 5–7 фраз,
  числа словами; недоступно вне игры/в фоне; «покажи Зелов» ставит вид; «восьмая гвардейская» — доклад.
- [ ] Реализация; коммит «Голос: командование — вход, обстановка, карта».

### Task 6: Командование голосом — советник, решение, приказы, распоряжения

**Files:** `CommandView.tsx` (Advisor, PlanBlock, Decision, Orders, OrderEditor, Rear, Bridges, Reserves,
Bounds), `voice/actions/command.ts`; tests.

**Produces:** `command.variants {count}`, `command.variant.more {n}`, `command.variant.pick {n, only?}`
(замена непустого проекта — irreversible), `command.advisor.ask {text}`, `command.advisor.stop`,
`command.advisor.take {n}`, поля решения через `fieldActions` (`decision.assessment`, `.enemy`, `.intent`,
`.risks`, `.report`, `.request`) + `decision.fromLast {field}`, `decision.draftReport`, `decision.missing`;
`command.order {unit, task, place?|enemy?, notes?}`, `command.order.cancel {unit}`, `command.orders.list`;
`command.rear.base {army, place}`, `command.rear.priority {armies}`, `command.bridge {place}`,
`command.reserve.commit {army, place}`, `command.reserve.cancel {army}`, `command.bounds.propose {army, neighbor}`,
`command.bounds.put`. Неисполнимое — текст проверки Worker голосом.

- [ ] Тесты: «восьмой гвардейской наступать на Зеловские высоты» → черновик приказа с целью; «выбираю
  второй» при непустом проекте → подтверждение; «подробнее о втором» читает замысел; диктовка замысла;
  неоднозначное место — переспрос.
- [ ] Реализация; коммит «Голос: командование — советник, решение, приказы».

### Task 7: Ход, посредник, разбор, полнота

**Files:** `CommandView.tsx` (ход, отказ штаба противника, посредник, конец игры), `ReviewView.tsx`,
new `voice/umpire.ts`, `voice/files.ts` (сохранение в «Загрузки» в настольном приложении), tests
`voice-completeness.test.ts`, `voice-umpire.test.ts`; `scripts/voice-e2e.mjs` (сценарий «без рук»).

**Produces:** `command.turn` (irreversible, проверки готовности со словами), `command.ai.retry`,
`command.ai.skip`, `umpireReport(view, record, ai) -> string` (по правилам) и с моделью — 3–5 фраз голосом
посредника (роль `umpire`); `command.umpire.repeat`, `command.enemy.read`, `command.review.compose`,
`command.review.read {section}`, `command.review.save`, `command.journal.save`; тест полноты (спека 3.7).

- [ ] Тесты: «проводи ход» без решения — говорит, чего нет; с решением — подтверждение, «да» шлёт `turn`; доклад
  посредника звучит голосом посредника после `view` нового хода; без модели — по правилам; полнота: все
  обработчики через реестр, исключения с причиной. e2e «без рук»: запуск → вступление (хватит) → «покажи
  переигровку» → «рассчитай» → «принять командование» → «принимаю» → «доложи обстановку» → «дай два варианта» →
  «выбираю первый» → «проводи ход» → «да» → доклад посредника — без единого щелчка.
- [ ] Реализация; коммит «Голос: ход с подтверждением, доклад посредника, разбор; полнота командования».

### Task 7b: Подсветка исполненного голосом (добавлено по указанию пользователя)

**Files:** `voice/registry.ts` (поле `highlight?: (p, result) => string | string[]` — селекторы `data-action`/`data-tour`/
`data-hl`), `voice/TourLayer.tsx` (рамка без притемнения, `flash(targets, ms)`), действия `actions/*.ts`, `CommandView.tsx`
(атрибуты `data-hl` на вариантах, строках приказов, полях решения, распоряжениях), карта (метка места — через
существующий слой/отметку); tests `voice-highlight.test.ts`, e2e.

**Interfaces — Produces:** `flash(targets: string[], ms = 2500)`; `act(id, p, { by: 'voice' | 'mouse' })` — подсветка
только при `by: 'voice'`; у каждого голосового действия раздела «Переигровка», окон голоса и вкладок — `highlight`.

- [ ] Тесты: тест полноты подсветки (у каждого действия с `say` в этих областях есть `highlight` или исключение с
  причиной); `act` голосом зовёт `flash`, мышью — нет; e2e: «выбираю первый» — рамка на варианте, «восьмой гвардейской
  наступать на Зелов» — рамка на приказе, «оперативный уровень» — на переключателе; рамка исчезает через ~2,5 с.
- [ ] Реализация; коммит «Голос: подсветка исполненного голосом».

### Task 7c: Разбор хода на карте и зоны влияния сторон (по указанию пользователя)

**Files:** new `voice/tours/turn.ts` (шаги разбора хода из данных), движок тура (шаги с картой: `map: { at, zoom?,
play?: [from, to] }`, метка-пульс на карте), `CommandView.tsx` / карта (слой «Зоны влияния»), worker/`TurnView` (данные
боёв с местом и зоны влияния — от расчётной линии фронта и положения соединений — сколько уже есть в sim; недостающее — минимально добавить в протокол),
`voice/actions/turn.ts` (после хода — разбор вместо голого доклада; «покажи ход»); tests, e2e.

- [ ] Тесты: шаги разбора строятся из данных хода (бои с местом, цели, тыл), туман войны соблюдён (нет данных о
  противнике сверх разведки); шаг с `play` проигрывает время хода; «хватит»/«дальше»/команда посреди разбора;
  зоны влияния: по свою сторону фронта и вокруг соединений, затухание, спорные без цвета, противник — по разведке; переключатель слоя и голос. e2e: ход → «Сведения готовятся» →
  разбор с переездами карты и меткой → «хватит»; снимок с зонами влияния.
- [ ] Реализация; коммит «Голос: разбор хода на карте, зоны влияния сторон».

### Task 8: Туры Переигровки и Командования

**Files:** new `voice/tours/{replay,command}.ts`; `data-tour` в `ReplayView.tsx`, `CommandView.tsx`,
`ReviewView.tsx`; tests; e2e.

- [ ] Тесты: targets; тур командования вне игры — объясняет, как попасть, и предлагает начать; в игре —
  примеры фраз из реестра (`say` существующих действий). e2e — тур в игре со снимком.
- [ ] Реализация; коммит «Голос: туры переигровки и командования».

### Task 9: Описание

**Files:** `docs/system.md` 9.1 (+ «Туры», «Командование голосом», «Без рук»), `docs/guide.md` 4.11,
`services/voice/README.md` (проверка на Mac — сценарий без рук), снимки, `npm run docs:system`,
`npm run docs:guide`.

- [ ] Тексты и снимки; сборка; проверки; коммит «Голос: описание — командование без рук и туры».

**Порядок:** Task 1 ∥ Task 2 → Task 3 ∥ Task 5 → Task 4 ∥ Task 6 → Task 7 → Task 7b → Task 7c → Task 8 → Task 9.
