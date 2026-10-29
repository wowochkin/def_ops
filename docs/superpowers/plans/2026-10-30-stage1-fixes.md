# Этап 1. Исправления и небольшие доработки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Десять пунктов этапа 1 спецификации: неподвижная вкладка «Командующий», сворачиваемый график состязания в одной
колонке с легендой, скорость 1 ч/с, раздельные «взять»/«вернуть», переезд карты к штабу, зоны влияния в «Переигровке»,
«только своё» в «Штабах» и «Приказах», посредник только там, где действует, и журнал действий противника в «истории как
замысле», разграничительные линии армий без отставания, укомплектованность «от штата» рядом с «от начала операции».

**Architecture:** Интерфейсные пункты — малые чистые функции (формат чисел, доступность подвкладок, отбор «своего»,
центр штаба, выбор кадра зон) в отдельных модулях `apps/editor/src/*.ts` с тестами vitest, а компоненты React только
вызывают их; кнопки — через действия реестра голоса. Три пункта с пометкой «разбор» (посредник, линии, укомплектованность)
начинаются с выяснения причины по названным файлам; исправление — по найденному, тест закрепляет требование
спецификации. Модель меняется только в п. 9 и только в режимах `agents`/`intent` — прежние отпечатки остаются.

**Tech Stack:** TypeScript (apps/editor на React, packages/sim), Rust (crates/agents-core), vitest, cargo test,
Playwright через мост разработки `scripts/agents-bridge.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-command-pack-design.md` (этап 1, «Общие правила», «Проверка»)

## Global Constraints

- Язык интерфейса, описания, сообщений коммитов — русский; идентификаторы кода — английские, как в репозитории.
- Прежние отпечатки не меняются: `SEELOW_48_DIGEST = 16519880440056134377`, `LEGACY_GAME_DIGEST = 5949968270007021613`
  (`crates/agents-core/tests/command.rs:34-35`). Пункт 9 меняет модель только в режимах командования `agents` и `intent`;
  если отпечаток всё же сменился — обновить его в том же коммите с объяснением в комментарии над константой (как там уже сделано).
- Каждый новый обработчик интерфейса — через действие реестра (`act`, `ActButton`); `apps/editor/tests/voice-completeness.test.ts`
  зелёный без новых исключений; существующие исключения (`'(e) => setSpeed(+e.target.value)'` в `Player`) — дословно как есть.
- Числа в карточках и вкладке «Командующий»: часы и километры — целые, доли — две цифры с запятой («0,50»), тысячи —
  с неразрывным пробелом (`toLocaleString('ru-RU')`); цифры моноширинные (`font-variant-numeric: tabular-nums`).
- Выбор скорости — ровно `1, 3, 6, 12, 24, 48` ч/с в «Переигровке» и в игре (общий `Player`).
- Сохранённое в браузере — только удобства (раскрыт график, показаны зоны): чтение и запись в `try/catch`, без хранилища всё работает.
- Числа штатной численности — только с источником (база знаний, `docs/sources/`); без источника — строка-допущение в
  `packages/sim/data/rules/norms.json`, чисел не придумывать.
- Живая проверка интерфейса — снимком через мост разработки: окно 1440×900, JPEG; снимки для описания — в `docs/img/`,
  рабочие — в `evals-out/stage1/` (не коммитится).
- Правила `CLAUDE.md`: проверки — только итог (`npm run typecheck 2>&1 | tail -3`,
  `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`), во время работы — точечно `npx vitest run <файл>`; полный `npm test` и
  `typecheck` — перед каждым коммитом; описание, снимки, `docs:system`, `kb:seed`, `model:index` — в последней задаче.

## Review Focus

- Старое сохранение переигровки без зон влияния (`SimResult.zones` нет) — «Слои» показывают «Зоны влияния» выключенными
  с подсказкой «в этом сохранении зон нет — рассчитайте заново», карта и легенда без ошибок (тест — задача 3).
- Час проигрывания дробный (ползунок на 12,4 ч) — числа вкладки «Командующий» и карточек не дробятся, ширина колонок та же
  (тест — задача 1).
- Штаб без действующих дивизий (разбитая армия) выбран в списке — карта не едет, без ошибки, уведомление «у штаба нет
  войск на карте» (тест — задача 6).
- Пункт управления не выбран (нет `post.issuer`: режим «как сейчас», «гибрид» до выбора) или выбрана верхняя инстанция —
  «Штабы» и документы показывают всё, переключателя «показать все» нет (тест — задача 4).
- Смена уровня пункта прячет открытую подвкладку «Приказов» — открывается «Пункт управления»; голосом «открой тыл» на
  уровне без тыла — ответ с причиной, а не пустая вкладка (тест — задача 5).

---

## Карта файлов

| Файл | Что | Задача |
|---|---|---|
| `apps/editor/src/num-format.ts` (новый) | формат чисел карточек и «Командующего» | 1 |
| `apps/editor/src/CommanderPanel.tsx`, `AgentCard.tsx`, `FormationCard.tsx`, `styles.css` | общий формат, моноширинные цифры, закреплённые колонки | 1 |
| `apps/editor/src/voice/registry.ts`, `ReplayView.tsx` | крючки разработки `window.__act`, `window.__replayCard` | 1 |
| `scripts/stage1-shots.mjs` (новый) | живые снимки и проверка раскладки через мост, части `--only` | 1–9 |
| `apps/editor/src/replay-dock.ts` (новый) | скорости плеера, ключ и чтение «раскрыт график» | 2 |
| `apps/editor/src/RivalryChart.tsx`, `ReplayView.tsx`, `styles.css` | свёртка графика, общая колонка с легендой | 2 |
| `packages/sim/src/zones.ts`, `apps/editor/src/sim/worker.ts`, `sim/protocol.ts`, `zones-overlay.ts`, `map-legend.ts`, `ReplayView.tsx` | зоны влияния в «Переигровке» | 3 |
| `apps/editor/src/post-views.ts`, `CommandStaffs.tsx`, `CommandView.tsx` | «только своё», раздельные кнопки | 4 |
| `apps/editor/src/post-staff.ts`, `CommandView.tsx`, `voice/actions/screen.ts` | доступные подвкладки «Приказов» | 5 |
| `apps/editor/src/engine/*`, `map-level-scale.ts`, `post-views.ts`, `CommandPost.tsx`, `CommandStaffs.tsx`, `CommandView.tsx`, `ReplayView.tsx` | переезд карты к штабу | 6 |
| `apps/editor/src/command-forms.ts`, `sim/agents-game.ts`, `sim/game-worker.ts`, `sim/game-protocol.ts`, `CommandView.tsx`, `crates/agents-core/src/game.rs` | посредник и журнал противника | 7 |
| `crates/agents-core/src/command/band.rs`, `command/agent.rs`, `intent/dispatch.rs`, `trace.rs`, `packages/sim/src/agents.ts`, `publish.ts` | линии армий без отставания | 8 |
| `packages/sim/data/rules/establishment.json` (новый), `packages/sim/src/establishment.ts` (новый), `reports.ts`, `norms.ts`, `norms.json`, отчёты и голос | укомплектованность от штата | 9 |
| `docs/system.md`, `docs/img/*`, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/*.json`, `docs/norms-check.md` | описание | 10 |

Живые проверки всех задач идут одним сценарием `scripts/stage1-shots.mjs` (создаётся в задаче 1, каждая задача дописывает
свою часть). Перед запуском: `cargo build --release -p agents-core --bin agents-game` и сервер разработки в фоне
`cd apps/editor && npx vite` (адрес `http://localhost:5173`).

---

### Task 1: Общий формат чисел и неподвижная вкладка «Командующий»

Пункт 1 спецификации. Причина дрожи: час вкладки — `agentHour = hourOf(start, time)` (`AgentCard.tsx:19`) дробный при
проигрывании, а `CommanderPanel.tsx:99` пишет `задержка {tick - p.rival.asOf} ч` без округления; доли и километры
форматируются в каждом файле по-своему (`CommanderPanel.tsx:16-21`, `AgentCard.tsx:58-64,160`, `FormationCard.tsx:10-11,65,100`).

**Files:**
- Create: `apps/editor/src/num-format.ts`
- Modify: `apps/editor/src/CommanderPanel.tsx:16-21,89-107`, `apps/editor/src/AgentCard.tsx:58-64,160`, `apps/editor/src/FormationCard.tsx:10-11,65,100`
- Modify: `apps/editor/src/styles.css:2040,2050-2051` (+ правило для `.ag-panel`)
- Modify: `apps/editor/src/voice/registry.ts` (крючок разработки), `apps/editor/src/ReplayView.tsx:350-352` (крючок карточки)
- Create: `scripts/stage1-shots.mjs`
- Test: `apps/editor/tests/num-format.test.ts` (новый), `apps/editor/tests/commander-ui.test.ts`

**Interfaces:**
- Produces (`apps/editor/src/num-format.ts`):
  - `fmtHours(h: number): string` — целые часы, не меньше 0: `"13 ч"`
  - `fmtKm(km: number): string` — целые км с группировкой ru-RU: `"1 234 км"`
  - `fmtFrac(x: number): string` — две цифры с запятой: `"0,50"`
  - `fmtCount(x: number): string` — целое с группировкой ru-RU, `NaN` → `"0"`
  - `fmtPct(x: number | null): string` — `"99 %"`, `null` → `"—"`
- Produces (только `import.meta.env.DEV`): `window.__act(id: string, params?: unknown): Promise<string | void>` (=`act` реестра),
  `window.__replayCard(id: string | null): void` (открыть карточку штаба в «Переигровке»).
- Produces: `scripts/stage1-shots.mjs [--url http://localhost:5173] [--out evals-out/stage1] [--only <части через запятую>]`;
  части: `commander, dock, zones, staffs, orders, fly, umpire, bounds, manning`; каждая печатает `ok <часть>: <что проверено>`
  или `FAIL <часть>: <что>` и завершает процесс с кодом 1 при любом `FAIL`.

- [ ] **Step 1: Write the failing tests**

`apps/editor/tests/num-format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fmtCount, fmtFrac, fmtHours, fmtKm, fmtPct } from '../src/num-format';

describe('общий формат чисел карточек', () => {
  it('часы и километры — целые, доли — две цифры с запятой, тысячи — с неразрывным пробелом', () => {
    expect(fmtHours(13.416)).toBe('13 ч');
    expect(fmtHours(-2)).toBe('0 ч');
    expect(fmtKm(12.6)).toBe('13 км');
    expect(fmtKm(1234.4)).toBe('1 234 км');
    expect(fmtFrac(0.5)).toBe('0,50');
    expect(fmtFrac(1)).toBe('1,00');
    expect(fmtCount(4920.6)).toBe('4 921');
    expect(fmtCount(Number.NaN)).toBe('0');
    expect(fmtPct(0.987)).toBe('99 %');
    expect(fmtPct(null)).toBe('—');
  });
});
```
В `apps/editor/tests/commander-ui.test.ts`, в `describe('отрисовка командующих')`:
```ts
it('дробный час проигрывания: задержка сводки — целые часы, без дробей', () => {
  const html = renderToString(createElement(CommanderPanel, { trace: trace([zhukov]), c: zhukov, tick: 12.4, onTick: () => {}, names }));
  expect(html).toContain('задержка 6 ч');
  expect(html).not.toMatch(/задержка \d+[.,]\d/);
  expect(html).toContain('<colgroup>'); // колонки картины закреплены
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/editor/tests/num-format.test.ts apps/editor/tests/commander-ui.test.ts`
Expected: FAIL — `Failed to resolve import "../src/num-format"`; во втором — `expected … to contain 'задержка 6 ч'`.

- [ ] **Step 3: Implement `num-format.ts` and use it**

`CommanderPanel.tsx`: локальные `n2`, `n0` заменить на `fmtFrac`, `fmtCount`; «прошла» — `fmtKm(a.advanceKm)`;
«своих» — `fmtPct(a.strength)`; задержка — `fmtHours(tick - p.rival.asOf)`; до объекта — `fmtKm`. Таблица `cm-pic`
получает `<colgroup>` с ширинами `38% 70px 56px auto`, CSS `.cm-pic { table-layout: fixed; width: 100%; }`.
`AgentCard.tsx:58-64`: поля 6–9 — `fmtFrac`, люди — `fmtCount`; расстояния строк `:160` — `fmtKm`.
`FormationCard.tsx`: `n0` → `fmtCount`, `pct` → `fmtPct`, боеприпасы — `fmtFrac`, «ближе всех» — `fmtKm`.
CSS: `.ag-panel, .cm-tab { font-variant-numeric: tabular-nums; }`; `.cm-row em` — `min-width: 74px` уже есть, оставить.
Крючки: в `voice/registry.ts` после объявления `act` — `if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __act: typeof act }).__act = act;`;
в `ReplayView.tsx` после `useState` карточки (`:350-352`) — `useEffect` с `window.__replayCard = (id) => { setCardSel(id); setAgentSel(null); }` под `import.meta.env.DEV`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/num-format.test.ts apps/editor/tests/commander-ui.test.ts apps/editor/tests/voice-completeness.test.ts`
Expected: PASS (3 файла).

- [ ] **Step 5: Live check — часть `commander` в `scripts/stage1-shots.mjs`**

Скрипт по образцу `scripts/agents-shots.mjs:1-40` (тот же запуск Chromium, `attachAgentsBridge`, `localStorage` до загрузки,
`shot(name)`). Часть `commander`: `localStorage['def_ops.agents.command'] = 'commanders'`, `#replay` → `[data-action="replay.calc"]` →
дождаться `.take-btn`; `window.__replayCard('su_1bf')`; вкладка «Командующий» (`.ag-tabs button` с текстом «Командующий»);
снимок `commander-before.jpg`; затем 12 раз сдвинуть время на 1 ч (`.pl-track input[type=range]` +1) и после каждого
сдвига сравнить `getBoundingClientRect().width` у `.cm-pic th` — все те же; снимок `commander-after.jpg`.
Печать: `ok commander: ширины колонок неизменны за 12 ч`.

Run: `node scripts/stage1-shots.mjs --only commander`
Expected: `ok commander: …`, файлы `evals-out/stage1/commander-before.jpg`, `commander-after.jpg`; на снимке — «задержка N ч» без дроби.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck 2>&1 | tail -3` → Expected: без `error TS`.
Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без `FAIL`.
```bash
git add apps/editor/src/num-format.ts apps/editor/tests/num-format.test.ts apps/editor/src/CommanderPanel.tsx apps/editor/src/AgentCard.tsx apps/editor/src/FormationCard.tsx apps/editor/src/styles.css apps/editor/src/voice/registry.ts apps/editor/src/ReplayView.tsx apps/editor/tests/commander-ui.test.ts scripts/stage1-shots.mjs
git commit -m "fix(командующий): общий формат чисел, моноширинные цифры — вкладка не дрожит"
```

---

### Task 2: Скорость 1 ч/с и график состязания в одной колонке с легендой

Пункты 2 и 3. Сейчас `.legend` (`styles.css:496`, `left:14px; bottom:92px`) и `.cm-chart` (`styles.css:2076`,
`left:14px; bottom:128px`) стоят независимо и наезжают; график не сворачивается; скорости — `[3, 6, 12, 24, 48]`
(`ReplayView.tsx:741`), `Player` общий для «Переигровки» и игры (`CommandView.tsx:996`).

**Files:**
- Create: `apps/editor/src/replay-dock.ts`
- Modify: `apps/editor/src/ReplayView.tsx:590-599` (колонка), `:740-742` (скорости)
- Modify: `apps/editor/src/RivalryChart.tsx:22-50` (заголовок со свёрткой, действие `map.chart`)
- Modify: `apps/editor/src/styles.css:496,2076` (+ `.map-dock`)
- Modify: `scripts/stage1-shots.mjs` (часть `dock`)
- Test: `apps/editor/tests/replay-dock.test.ts` (новый), `apps/editor/tests/commander-ui.test.ts`

**Interfaces:**
- Consumes: —
- Produces (`apps/editor/src/replay-dock.ts`):
  - `PLAYER_SPEEDS: readonly number[]` = `[1, 3, 6, 12, 24, 48]`
  - `CHART_KEY = 'def_ops.replay.chart'`
  - `readOpen(key: string, dflt: boolean, store?: Pick<Storage, 'getItem'> | null): boolean` — `'open'`/`'closed'` из хранилища, иначе `dflt`; ошибка доступа — `dflt`
- Produces: действие реестра `map.chart` (`{ open?: boolean }`, голос «штаб, сверни график», «штаб, покажи график»);
  обёртка `<div className="map-dock">` — легенда и график внутри, легенда снизу.

- [ ] **Step 1: Write the failing tests**

`apps/editor/tests/replay-dock.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CHART_KEY, PLAYER_SPEEDS, readOpen } from '../src/replay-dock';

describe('плеер и колонка у левого края', () => {
  it('скорости — 1, 3, 6, 12, 24, 48 ч/с', () => { expect([...PLAYER_SPEEDS]).toEqual([1, 3, 6, 12, 24, 48]); });
  it('раскрыт ли график: помнится, без хранилища — по умолчанию', () => {
    expect(readOpen(CHART_KEY, true, { getItem: () => 'closed' })).toBe(false);
    expect(readOpen(CHART_KEY, false, { getItem: () => 'open' })).toBe(true);
    expect(readOpen(CHART_KEY, true, null)).toBe(true);
    expect(readOpen(CHART_KEY, true, { getItem: () => { throw new Error('нет доступа'); } })).toBe(true);
  });
});
```
В `commander-ui.test.ts`:
```ts
it('график: заголовок со свёрткой ▾, кнопка через действие map.chart', () => {
  const html = renderToString(createElement(RivalryChart, { trace: trace([zhukov]), tick: 6, current: 'su_1bf' }));
  expect(html).toMatch(/data-action="map\.chart"[^>]*>(<[^>]+>)*Состязание за/);
  expect(html).toContain('▾');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/editor/tests/replay-dock.test.ts apps/editor/tests/commander-ui.test.ts`
Expected: FAIL — `Failed to resolve import "../src/replay-dock"`; `expected … to match /data-action="map\.chart"…/`.

- [ ] **Step 3: Implement**

`replay-dock.ts` — по интерфейсу. `ReplayView.tsx:741`: `{PLAYER_SPEEDS.map((v) => …)}`; обработчик `onChange` не трогать.
`RivalryChart`: состояние `open` из `readOpen(CHART_KEY, true, localStorage)` (в `try`), заголовок `.cm-chart-h` — `ActButton`
`action="map.chart" params={{ open: !open }}` с текстом «Состязание за … ▾/▸» (как `LegendPanel`, `ReplayView.tsx:827-828`);
`useAction({ id: 'map.chart', section: 'replay', … run })` пишет `localStorage.setItem(CHART_KEY, …)` в `try`; свёрнут — только заголовок.
`ReplayView.tsx:591-599`: `RivalryChart` и `Legend` — внутрь `<div className="map-dock">` (сначала график, затем легенда).
CSS: `.map-dock { position: absolute; left: 14px; bottom: 92px; z-index: 6; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; max-height: calc(100% - 150px); overflow-y: auto; }`,
`.map-dock > .legend, .map-dock > .cm-chart { position: static; }`, `.map-dock > .cm-chart { width: min(640px, calc(100vw - 480px)); }`;
мобильные правила `styles.css:798-805` распространить на `.map-dock`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/replay-dock.test.ts apps/editor/tests/commander-ui.test.ts apps/editor/tests/voice-completeness.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check — часть `dock` (тест раскладки)**

Часть `dock`: как `commander` до вкладки «Командующий»; для четырёх сочетаний «легенда раскрыта/свёрнута × график раскрыт/свёрнут»
(клики по `.legend .lg-h` и `[data-action="map.chart"]`) взять `getBoundingClientRect()` у `.map-dock > .legend` и
`.map-dock > .cm-chart` и проверить, что прямоугольники не пересекаются и оба внутри `.rp-map`; затем выбор скорости:
`.player select` содержит ровно `1 ч/с … 48 ч/с`; в игре (передать командование, `[data-hl="enemy-passive"]`, как
`agents-shots.mjs:73-77`) — тот же список. Снимки `dock-open-open.jpg`, `dock-closed-open.jpg`.

Run: `node scripts/stage1-shots.mjs --only dock`
Expected: `ok dock: 4 сочетания без пересечения`, `ok dock: скорости 1,3,6,12,24,48 в переигровке и в игре`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add apps/editor/src/replay-dock.ts apps/editor/tests/replay-dock.test.ts apps/editor/src/RivalryChart.tsx apps/editor/src/ReplayView.tsx apps/editor/src/styles.css apps/editor/tests/commander-ui.test.ts scripts/stage1-shots.mjs
git commit -m "feat(переигровка): скорость 1 ч/с, график состязания сворачивается и стоит в одной колонке с легендой"
```

---

### Task 3: Зоны влияния в «Переигровке»

Пункт 6. В игре зоны — `sideZones` (`packages/sim/src/zones.ts:180-198`) на начало и конец хода, картинкой
(`CommandView.tsx:535-549`, `zones-overlay.ts`). В «Переигровке» состояния по часам нет — есть снимки `RunResult.snapshots`
(`packages/sim/src/history.ts:157-167`); зоны считаются по снимкам раз в сутки в фоновом потоке расчёта и уходят в
результат. Строки легенды зон сейчас только для командования (`map-legend.ts:79-80`, `command: true`).

**Files:**
- Modify: `packages/sim/src/zones.ts` (новая `snapshotZones`), `packages/sim/src/index.ts` (экспорт, если не через `export *`)
- Modify: `apps/editor/src/sim/protocol.ts:12-35` (`SimResult.zones?`), `apps/editor/src/sim/worker.ts:58-100` и ветка нынешней модели (тот же блок)
- Modify: `apps/editor/src/zones-overlay.ts` (новая `zonesAt`), `apps/editor/src/map-legend.ts:15-23,79-88`
- Modify: `apps/editor/src/ReplayView.tsx:211-212,436-458,577,597-599`
- Modify: `scripts/stage1-shots.mjs` (часть `zones`)
- Test: `packages/sim/tests/zones.test.ts`, `apps/editor/tests/zones-overlay.test.ts`, `apps/editor/tests/map-legend.test.ts`

**Interfaces:**
- Produces (`packages/sim/src/zones.ts`): `snapshotZones(ctx: SimContext, sn: Snapshot, side: string): ZoneGrid` — свои — живые
  соединения стороны `side` из `sn.units`, противник — все остальные живые (туман войны снят, `recon: Infinity`),
  вес — тот же `weight(personnel)`, территория — `sn.territory`, спорные — отрезанные (`cutOff`).
- Produces (`apps/editor/src/sim/protocol.ts`): `SimResult.zones?: { side: string; frames: { time: string; grid: ZoneGrid }[] }` —
  снимки через 24 ч от начала и последний.
- Produces (`apps/editor/src/zones-overlay.ts`): `zonesAt(frames: { time: string; grid: ZoneGrid }[], time: string): { prev: ZoneGrid | null; cur: ZoneGrid | null; from: string; to: string }` —
  время между кадрами k и k+1 → `prev` = k, `cur` = k+1, `from`/`to` — их время; после последнего — `prev: null`, `cur` — последний,
  `from = to` = его время; кадров нет — `cur: null`.
- Produces (`map-legend.ts`): `LegendItem.replay?: boolean`; строки `zones-su` («зона влияния советских войск»,
  `cls: 'lg-zone-own'`) и `zones-de` («зона влияния немецких войск», `cls: 'lg-zone-enemy'`), `key: 'zones'`, все уровни,
  `replay: true`; `legendFor(level, { command })` — командованию без `replay`, «Переигровке» без `command`.
- Produces: ключ `localStorage` `def_ops.replay.zones` (`'on' | 'off'`, по умолчанию показаны).

- [ ] **Step 1: Write the failing tests**

`packages/sim/tests/zones.test.ts` (рядом с тестами `sideZones`, тот же контекст из файла):
```ts
it('зоны по снимку переигровки: свои и противник без тумана войны', () => {
  const sn = { time: ctx.scenario.start, turn: 0, units: [
    { id: ownId, at: ownAt, personnel: 8000, tanks: 0, posture: 'attack', destroyed: false },
    { id: foeId, at: foeAt, personnel: 8000, tanks: 0, posture: 'defend', destroyed: false },
  ] };
  const z = snapshotZones(ctx, sn, ownSide);
  expect(zoneAt(z, ownAt)).toBeGreaterThan(0);
  expect(zoneAt(z, foeAt)).toBeLessThan(0); // противник виден без разведки
});
```
(`ownId/ownAt/foeId/foeAt/ownSide` — те же соединения, что в соседнем тесте `sideZones` этого файла.)
`apps/editor/tests/zones-overlay.test.ts`:
```ts
describe('зоны переигровки по времени', () => {
  const g = (k: number): ZoneGrid => ({ bbox: [14, 52, 15, 53], cols: 1, rows: 1, v: [k] });
  const frames = [{ time: '1945-04-16T05:00', grid: g(1) }, { time: '1945-04-17T05:00', grid: g(2) }];
  it('между кадрами — переход от прежнего к следующему; после последнего — последний; кадров нет — ничего', () => {
    expect(zonesAt(frames, '1945-04-16T17:00')).toEqual({ prev: g(1), cur: g(2), from: '1945-04-16T05:00', to: '1945-04-17T05:00' });
    expect(zonesAt(frames, '1945-04-18T05:00')).toEqual({ prev: null, cur: g(2), from: '1945-04-17T05:00', to: '1945-04-17T05:00' });
    expect(zonesAt([], '1945-04-16T05:00').cur).toBeNull();
  });
});
```
`apps/editor/tests/map-legend.test.ts`:
```ts
it('зоны влияния: в переигровке — стороны по названиям, в командовании — свои и противник', () => {
  expect(legendFor('front').map((x) => x.id)).toEqual(expect.arrayContaining(['zones-su', 'zones-de']));
  expect(legendFor('front').map((x) => x.id)).not.toContain('zones-own');
  expect(legendFor('front', { command: true }).map((x) => x.id)).toEqual(expect.arrayContaining(['zones-own', 'zones-enemy']));
  expect(legendFor('front', { command: true }).map((x) => x.id)).not.toContain('zones-su');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/sim/tests/zones.test.ts apps/editor/tests/zones-overlay.test.ts apps/editor/tests/map-legend.test.ts`
Expected: FAIL — `snapshotZones is not a function` / `zonesAt is not exported`; `expected [...] to contain 'zones-su'`.

- [ ] **Step 3: Implement**

`snapshotZones` — через `influenceZones` (`zones.ts:62`), как `sideZones`. Поток расчёта: в `agents()` (`worker.ts:58-100`)
и в ветке нынешней модели после прогона — `zones: { side: own, frames }`, где `own` — советская сторона (`ctx.scenario.sides`
с `id === 'su'`, иначе первая), `frames` — снимки с временем `start + 24k` ч (ближайший не раньше) и последний; ошибка
расчёта зон — `zones` без поля (карта без зон). «Переигровка»: состояние `zonesOn` из `def_ops.replay.zones` (`try`),
`zonesAt(result.zones.frames, time)` → `zoneUrl` (стороны — по скрытым строкам легенды `zones-su`/`zones-de`) →
`zoneOverlays(...)` → `mapDoc` с `overlays` (как `CommandView.tsx:543-549`); «Слои» — пункт `{ key: 'zones', title: LAYER_TITLE.zones, on: zonesOn, toggle }`
в `LayersMenu` (`ReplayView.tsx:577`), у сохранения без `zones` — флажок выключен и недоступен, `title` «в этом сохранении
зон нет — рассчитайте заново»; легенда — `always` с `zones-su`, `zones-de`, когда зоны на карте.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/sim/tests/zones.test.ts apps/editor/tests/zones-overlay.test.ts apps/editor/tests/map-legend.test.ts apps/editor/tests/legend-levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check — часть `zones`**

Агентный расчёт Берлинской (режим по умолчанию), четвёртые сутки (`.player .ic[title="Вперёд на сутки"]` ×4), уровень «Фронт»;
проверить: в «Слоях» есть «Зоны влияния сторон» и включён; в легенде строки «зона влияния советских войск» и «… немецких войск»;
снимок `replay-zones.jpg`; снять флажок → перезагрузить страницу и пересчитать → флажок снят (помнится).

Run: `node scripts/stage1-shots.mjs --only zones`
Expected: `ok zones: слой и легенда`, `ok zones: выбор помнится`; на снимке — красноватая и голубоватая подкраска под знаками.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add packages/sim/src/zones.ts packages/sim/tests/zones.test.ts apps/editor/src/sim/protocol.ts apps/editor/src/sim/worker.ts apps/editor/src/zones-overlay.ts apps/editor/tests/zones-overlay.test.ts apps/editor/src/map-legend.ts apps/editor/tests/map-legend.test.ts apps/editor/src/ReplayView.tsx scripts/stage1-shots.mjs
git commit -m "feat(переигровка): зоны влияния сторон — слой, строка легенды, выбор помнится"
```

---

### Task 4: «Штабы» — раздельные кнопки и «только своё»

Пункты 4 и 7 (первая часть). Кнопки «взять» и «вернуть истории» — два `ActButton className="link"` подряд без промежутка
(`CommandStaffs.tsx:138-141`) — читаются слитно. Список штабов и журнал документов — все штабы стороны
(`CommandStaffs.tsx:111-112`); `postDocs` (`post-views.ts:86-90`) берёт документы самого штаба и непосредственных
подчинённых, без директив старших.

**Files:**
- Modify: `apps/editor/src/post-views.ts:15-25,86-90`
- Modify: `apps/editor/src/CommandStaffs.tsx:92-158`
- Modify: `apps/editor/src/CommandView.tsx:936` (передать `issuer`)
- Modify: `apps/editor/src/styles.css` (`.staffs-acts`, `.staffs-btn`)
- Modify: `scripts/stage1-shots.mjs` (часть `staffs`)
- Test: `apps/editor/tests/post-views.test.ts`, `apps/editor/tests/command-staffs.test.ts` (новый)

**Interfaces:**
- Produces (`post-views.ts`):
  - `subtreeHqs(v: TurnView, issuer: string): Set<string>` — штаб и все штабы под ним (по `command.hqs[*].parent`, глубина до 8)
  - `postDocs(v: TurnView, issuer: string)` — новое правило: документ штаба из `subtreeHqs`, или документ старшего (предок `issuer`),
    у которого `to` пересекается с `subtreeHqs` либо с дивизиями поддерева
- Produces (`CommandStaffs.tsx`): `Staffs({ v, cmds, issuer }: { v: TurnView; cmds: CommandOp[]; issuer: string | null })`;
  действие `command.staffs.all` (`{ on: boolean }`, голос «штаб, покажи все штабы», «штаб, только мои штабы»);
  «только своё» действует, если `issuer` есть и это не верхняя инстанция.

- [ ] **Step 1: Write the failing tests**

В `apps/editor/tests/post-views.test.ts` (фикстура `v` файла: `f1 → a1 → k1`, `a2` под `f1`):
```ts
it('документы пункта: поддерево и директивы старших в поддерево; чужие — нет', () => {
  const vv = { ...v, command: { ...v.command, documents: [
    { time: '17.04 05:00', hq: 'f1', hqName: 'фронт', kind: 'directive', to: ['a1'], text: 'армии', rule: null },
    { time: '17.04 05:00', hq: 'f1', hqName: 'фронт', kind: 'directive', to: ['a2'], text: 'соседу', rule: null },
    { time: '17.04 06:00', hq: 'k1', hqName: 'корпус', kind: 'order', to: ['d1'], text: 'дивизии', rule: null },
    { time: '17.04 06:00', hq: 'a2', hqName: '33 А', kind: 'order', to: [], text: 'чужое', rule: null },
  ] } } as never;
  expect(postDocs(vv, 'a1').map((d) => d.text)).toEqual(['армии', 'дивизии']);
  expect([...subtreeHqs(vv, 'a1')].sort()).toEqual(['a1', 'k1']);
});
```
`apps/editor/tests/command-staffs.test.ts`:
```ts
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Staffs } from '../src/CommandStaffs';

const hq = (name: string, echelon: string, parent: string | null, control = 'agent') => ({ control, led: false, name, echelon, parent });
const view = (mode: string) => ({ turn: 2, terms: { topGen: 'Ставки' }, places: [], command: {
  mode, led: [], requests: [], historical: [], enemy: { hqs: {}, divisions: {} },
  hqs: { s: hq('Ставка ВГК', 'high_command', null), f1: hq('1-й Белорусский фронт', 'front', 's'), a1: hq('8 гв. А', 'army', 'f1', 'player'), a2: hq('33 А', 'army', 'f1') },
  documents: [{ time: '17.04 05:00', hq: 'a2', hqName: '33 А', kind: 'order', to: [], text: 'чужой приказ', rule: null }],
} }) as never;

describe('вкладка «Штабы»', () => {
  it('«взять» и «вернуть» — отдельные кнопки в рамке с промежутком', () => {
    const html = renderToString(createElement(Staffs, { v: view('intent'), cmds: [], issuer: null }));
    expect(html).toMatch(/<span class="staffs-acts">(<button[^>]*class="staffs-btn[^"]*"[^>]*>[^<]+<\/button>){1,2}<\/span>/);
    expect(html).not.toMatch(/взять<\/button><button[^>]*class="link/);
  });
  it('пункт армии — только её поддерево и документы, переключатель «показать все»; без пункта — всё', () => {
    const own = renderToString(createElement(Staffs, { v: view('agents'), cmds: [], issuer: 'a1' }));
    expect(own).toContain('8 гв. А');
    expect(own).not.toContain('33 А');
    expect(own).not.toContain('чужой приказ');
    expect(own).toContain('data-action="command.staffs.all"');
    const all = renderToString(createElement(Staffs, { v: view('agents'), cmds: [], issuer: null }));
    expect(all).toContain('33 А');
    expect(all).not.toContain('data-action="command.staffs.all"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/editor/tests/post-views.test.ts apps/editor/tests/command-staffs.test.ts`
Expected: FAIL — `subtreeHqs is not a function`; `expected … to match /<span class="staffs-acts">…/`.

- [ ] **Step 3: Implement**

`subtreeHqs`, `postDocs` — по интерфейсу (`ancestry` — `post-views.ts:15-20`; дивизии поддерева — `divisionsUnder`).
`Staffs`: проп `issuer`; `const [all, setAll] = useState(false)`; `scoped = !!issuer && c.hqs[issuer]?.echelon !== 'high_command' && !all`;
список штабов и выбор «Штаб» над документами — `scoped ? list.filter(([id]) => subtreeHqs(v, issuer!).has(id)) : list`; документы — `scoped ? postDocs(v, issuer!) : c.documents`,
затем фильтр по выбору в списке «Штаб»; над списком — `ActButton action="command.staffs.all" params={{ on: !all }}` «показать все» /
«только мои» (только когда пункт есть). Кнопки строки — `<span className="staffs-acts">` с `ActButton className="staffs-btn"`
(«вернуть …» — `className="staffs-btn back"`). CSS: `.staffs-acts { display: inline-flex; gap: 6px; }`,
`.staffs-btn { border: 1px solid var(--line); border-radius: 6px; padding: 1px 8px; background: #fff; font-size: 11.5px; }`.
`CommandView.tsx:936`: `<Staffs v={view} cmds={cmds} issuer={post.issuer} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/post-views.test.ts apps/editor/tests/command-staffs.test.ts apps/editor/tests/voice-completeness.test.ts apps/editor/tests/voice-staff.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check — часть `staffs`**

Игра на агентной модели («История как замысел»), уровень «Армия», пункт — 8-я гв. армия (`window.__act('command.post', { name: 'su_8gva' })`),
вкладка «Штабы»: у строки штаба кнопки в рамке, `getBoundingClientRect` двух кнопок не соприкасаются (промежуток ≥ 4 px);
в списке нет штабов 1-го Украинского фронта; журнал — только поддерево 8 гв. А и директивы фронта ей; «показать все» —
появляются остальные. Снимок `command-staffs.jpg` (для описания — в `docs/img/` в задаче 10).

Run: `node scripts/stage1-shots.mjs --only staffs`
Expected: `ok staffs: кнопки раздельны`, `ok staffs: только поддерево 8 гв. А`, `ok staffs: показать все`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add apps/editor/src/post-views.ts apps/editor/tests/post-views.test.ts apps/editor/src/CommandStaffs.tsx apps/editor/tests/command-staffs.test.ts apps/editor/src/CommandView.tsx apps/editor/src/styles.css scripts/stage1-shots.mjs
git commit -m "feat(штабы): раздельные «взять» и «вернуть»; по умолчанию — только поддерево пункта и его документы"
```

---

### Task 5: «Приказы» — только подвкладки с доступным действием

Пункт 7 (вторая часть). Подвкладки рисуются всегда (`CommandView.tsx:923-925`); что штаб ступени ведёт — `staffScope`
(`post-staff.ts:36-49`), и по нему вкладки внутри говорят «Ставка переправ не наводит…» (`CommandView.tsx:1652-1700,1837,1895`).
Таблица доступности строится из того же `staffScope`.

**Files:**
- Modify: `apps/editor/src/post-staff.ts` (новая `ordersSubs`)
- Modify: `apps/editor/src/CommandView.tsx:103,923-925` (+ откат на «Пункт управления»)
- Modify: `apps/editor/src/voice/actions/screen.ts:125-127` (ответ с причиной)
- Modify: `scripts/stage1-shots.mjs` (часть `orders`)
- Test: `apps/editor/tests/post-staff.test.ts`

**Interfaces:**
- Consumes: `staffScope(v, level, issuer): StaffScope` (`post-staff.ts:36`), `postReserves(v, issuer)` (`post-views.ts:92`)
- Produces (`post-staff.ts`): `ordersSubs(v: TurnView, scope: StaffScope | null): Record<OrdersSub, true | string>` —
  `true` — вкладка видна; строка — почему её нет (голосу). Правила: `scope === null` (игра без пункта) — все `true`;
  `units` — всегда `true`; `rear` — `scope.bases === 'move' || scope.priority`; `bridges` — `scope.bridges === 'build' || scope.allotParks`;
  `reserves` — `postReserves(v, scope.issuer).length > 0`; `bounds` — `scope.bounds === 'armies'`. `OrdersSub` — из `voice/actions/staff.ts:46`.

- [ ] **Step 1: Write the failing test**

В `apps/editor/tests/post-staff.test.ts` (фикстура `v` файла: `top → f1 → a1 (k1), a2`; резервов в ней нет — добавить пустой список):
```ts
it('подвкладки «Приказов» по уровню: только с доступным действием, причина — словами', () => {
  const vr = { ...v, reserveGroups: [] } as TurnView;
  const at = (level: LevelId, issuer: string) => ordersSubs(vr, staffScope(vr, level, issuer));
  expect(at('front', 'f1')).toMatchObject({ units: true, rear: true, bridges: true, bounds: true });
  expect(at('stavka', 'top')).toMatchObject({ rear: true, bridges: true }); // подвоз между фронтами, придача парков
  const corps = at('corps', 'k1');
  expect(corps.units).toBe(true);
  expect(typeof corps.rear).toBe('string');     // стрелковый корпус: тыла нет
  expect(typeof corps.bounds).toBe('string');   // полосы дивизий — приказом в «Пункте управления»
  expect(corps.bridges).toBe(true);             // корпус наводит переправы своими парками
  expect(typeof at('stavka', 'top').bounds).toBe('string'); // линии фронтов — директивой
  expect(typeof at('front', 'f1').reserves).toBe('string'); // резервов нет
  expect(at('front', 'f1').reserves).toMatch(/резерв/);
  expect(Object.values(ordersSubs(vr, null)).every((x) => x === true)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/editor/tests/post-staff.test.ts`
Expected: FAIL — `ordersSubs is not a function`.

- [ ] **Step 3: Implement**

`ordersSubs` — по интерфейсу; причины: тыл — «тыл ведут фронт и армия (у танкового и механизированного корпуса — свой)»,
переправы — «переправы наводят фронт, армия и корпус», резервы — «в подчинении нет резервов», полосы — «полосы этой ступени
задаются в «Пункте управления» (директивой или приказом)». `CommandView`: `const subsOk = ordersSubs(view, scopeNow())`,
кнопки подвкладок — только с `subsOk[k] === true`; `useEffect`: открытая подвкладка стала скрытой — `setSub('units')`.
Голос `command.orders.sub` (`screen.ts:125-127`): `get()` отдаёт и `subsOk`; скрытая — ответ
`` `«${SUB_TITLE[p.sub]}» на этом уровне нет: ${why}.` `` без переключения.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/post-staff.test.ts apps/editor/tests/voice-command.test.ts apps/editor/tests/voice-completeness.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check — часть `orders`**

Игра на агентной модели; «Приказы» на уровнях «Ставка», «Фронт», «Корпус»: собрать тексты `.subtabs button` и сравнить с
`ordersSubs` той же обстановки (`window.__cmdView`); на уровне «Корпус» открыть «Тыл» на уровне «Фронт», переключить уровень
на «Корпус» — открыт «Пункт управления». Снимки `orders-front.jpg`, `orders-corps.jpg`.

Run: `node scripts/stage1-shots.mjs --only orders`
Expected: `ok orders: подвкладки совпадают с таблицей на 3 уровнях`, `ok orders: скрытая подвкладка → Пункт управления`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add apps/editor/src/post-staff.ts apps/editor/tests/post-staff.test.ts apps/editor/src/CommandView.tsx apps/editor/src/voice/actions/screen.ts scripts/stage1-shots.mjs
git commit -m "feat(приказы): видны только подвкладки с доступным на уровне действием"
```

---

### Task 6: Карта переезжает к штабу

Пункт 5. У движка карты только `setView` (`engine/types.ts:61`, `engine/maplibre.ts:116` — `jumpTo`); «показать в
свободной части карты» — `showAt` (`engine/free-center.ts:41-52`); центр войск штаба в переигровке — `hqCentroid`
(`commander-view.ts:234-248`), в игре такого нет. Выбор штаба: список пункта — действие `command.post`
(`CommandPost.tsx:57-75`, селекты `:256-257,313-314`), «Штабы» — строка штаба (`CommandStaffs.tsx`), карточка — `showUnit`
(`CommandView.tsx:468-474`) в игре и `cardSel` (`ReplayView.tsx:350`) в «Переигровке».

**Files:**
- Modify: `apps/editor/src/engine/types.ts:56-73` (`flyTo?`), `apps/editor/src/engine/maplibre.ts:116`
- Modify: `apps/editor/src/engine/free-center.ts` (новая `flyToHq`), `apps/editor/src/map-level-scale.ts` (`ECHELON_LEVEL`)
- Modify: `apps/editor/src/post-views.ts` (новая `hqCenter`)
- Modify: `apps/editor/src/CommandPost.tsx:39,57-75` (параметр `onHq`), `apps/editor/src/CommandStaffs.tsx` (название штаба — кнопка `map.hq`)
- Modify: `apps/editor/src/CommandView.tsx:205,468-474` (действие `map.hq`, полёт из карточки), `apps/editor/src/ReplayView.tsx:350-400` (полёт при открытии карточки штаба)
- Modify: `scripts/stage1-shots.mjs` (часть `fly`)
- Test: `apps/editor/tests/map-fly.test.ts` (новый), `apps/editor/tests/post-views.test.ts`

**Interfaces:**
- Produces (`engine/types.ts`): `MapEngine.flyTo?(v: Partial<ViewState>, ms?: number): void` (maplibre — `map.flyTo({ center, zoom, duration: ms ?? 900, essential: true })`).
- Produces (`map-level-scale.ts`): `ECHELON_LEVEL: Record<string, LevelId>` = `{ high_command: 'stavka', front: 'front', army: 'army', corps: 'corps', division: 'division' }`.
- Produces (`engine/free-center.ts`): `flyToHq(en: Pick<MapEngine, 'getView' | 'setView'> & Partial<Pick<MapEngine, 'flyTo' | 'getContainer'>>, at: LngLat, level: LevelId): void` —
  масштаб `zoomForScale(at[1], levelDefaultScale(level))`; центр смещён в свободную часть карты (`freeOffset`, пиксели → градусы
  на целевом масштабе; без `document` — проверки в node — центр ровно `at`); есть `flyTo` — плавно, нет — `setView`.
- Produces (`post-views.ts`): `hqCenter(v: TurnView, hq: string): LngLat | null` — среднее положение `divisionsUnder(v, hq)`,
  взвешенное по `personnel`; дивизий нет — `null`.
- Produces: действие `map.hq` (`{ name: string }`, голос «штаб, покажи восьмую гвардейскую армию на карте»), только в игре;
  `usePost(..., openTab, onHq?: (id: string) => void)`.

- [ ] **Step 1: Write the failing tests**

`apps/editor/tests/map-fly.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { zoomForScale } from '@def-ops/core';
import { flyToHq } from '../src/engine/free-center';
import { ECHELON_LEVEL, levelDefaultScale } from '../src/map-level-scale';

describe('переезд карты к штабу', () => {
  const at: [number, number] = [14.3, 52.6];
  it('плавно, масштаб по ступени штаба', () => {
    const calls: unknown[] = [];
    flyToHq({ getView: () => ({ center: [13, 52], zoom: 7, bearing: 0 }), setView: () => calls.push('jump'), flyTo: (v) => calls.push(v) }, at, ECHELON_LEVEL.army);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ center: at, zoom: zoomForScale(at[1], levelDefaultScale('army')) });
  });
  it('движок без плавного перехода — прыжком; ступени — фронт, армия, корпус, дивизия', () => {
    const calls: unknown[] = [];
    flyToHq({ getView: () => ({ center: [13, 52], zoom: 7, bearing: 0 }), setView: (v) => calls.push(v) }, at, 'corps');
    expect(calls[0]).toMatchObject({ center: at, zoom: zoomForScale(at[1], levelDefaultScale('corps')) });
    expect(ECHELON_LEVEL).toMatchObject({ front: 'front', army: 'army', corps: 'corps', division: 'division', high_command: 'stavka' });
  });
});
```
В `apps/editor/tests/post-views.test.ts`:
```ts
it('центр войск штаба — по численности; без действующих дивизий — null', () => {
  const c = hqCenter(v as never, 'k1')!; // d1 (14.5, 52.6) и d2 (14.52, 52.58), по 8000
  expect(c[0]).toBeCloseTo(14.51, 5);
  expect(c[1]).toBeCloseTo(52.59, 5);
  expect(hqCenter(v as never, 'нет')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/editor/tests/map-fly.test.ts apps/editor/tests/post-views.test.ts`
Expected: FAIL — `flyToHq is not exported`, `hqCenter is not a function`.

- [ ] **Step 3: Implement**

По интерфейсу. Игра: `map.hq` в `CommandView` — `findHq` по названию, `hqCenter(view, id)`; `null` → уведомление
«{штаб}: у штаба нет войск на карте» и ответ голосу тот же; иначе `flyToHq(eng, at, ECHELON_LEVEL[echelon])`. `usePost(..., () => {...}, (id) => tap('map.hq', { name: id }))` —
`command.post` с `name` после `setChosen` зовёт `onHq(id)`. «Штабы»: название штаба в строке — `ActButton className="link staffs-go" action="map.hq" params={{ name: id }}`.
`showUnit(id)`: у штаба (`echelon !== 'division'`) — тоже `map.hq`. «Переигровка»: `useEffect` на `cardSel` (штаб, не дивизия) —
`hqCentroid(agentRun.trace, cardSel, agentHour)` или место знака (`agentSelAt`) → `flyToHq(eng, at, ECHELON_LEVEL[echelon])`; час в
зависимостях эффекта не участвует (карта не едет при проигрывании).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/map-fly.test.ts apps/editor/tests/post-views.test.ts apps/editor/tests/voice-completeness.test.ts apps/editor/tests/command-post.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check — часть `fly`**

Игра: выбрать в списке пункта «Армия» 8 гв. А → через 1,5 с центр `window.__cmdEngine.getView().center` ближе 15 км к
`hqCenter` этой армии (считается в странице из `window.__cmdView`), масштаб — 1:200 000 ± шаг; «Штабы» → щелчок по
«5-я ударная армия» — центр сменился; «Переигровка»: `window.__replayCard('su_1bf')` — масштаб 1:500 000. Снимки
`fly-army.jpg`, `fly-replay-front.jpg`.

Run: `node scripts/stage1-shots.mjs --only fly`
Expected: `ok fly: пункт → 8 гв. А`, `ok fly: «Штабы» → 5 уд. А`, `ok fly: карточка фронта в переигровке`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add apps/editor/src/engine apps/editor/src/map-level-scale.ts apps/editor/src/post-views.ts apps/editor/src/CommandPost.tsx apps/editor/src/CommandStaffs.tsx apps/editor/src/CommandView.tsx apps/editor/src/ReplayView.tsx apps/editor/tests/map-fly.test.ts apps/editor/tests/post-views.test.ts scripts/stage1-shots.mjs
git commit -m "feat(командование): карта плавно переезжает к выбранному штабу, масштаб по ступени"
```

---

### Task 7: Посредник — только где действует; действия противника в журнале «истории как замысла»

Пункт 8 (разбор).

**Files:**
- Modify: `apps/editor/src/command-forms.ts` (новая `umpireApplies`)
- Modify: `apps/editor/src/CommandView.tsx:1944-1962` (`Journal`), `:1964-2036` (`Umpire`, переключатель `:1991`), `:2047-2070` (`UmpireNotes`)
- Modify: `apps/editor/src/sim/agents-game.ts:14-66` (`TraceCommand.enemyRequests`, новая `enemyLog`, `enemyVisible`)
- Modify: `apps/editor/src/sim/game-worker.ts:100-125,535-547,647-700` (журнал противника в ход и в вид)
- Modify: `apps/editor/src/sim/game-protocol.ts` (`JournalDay.enemy?`, `TurnView.enemyLog?`)
- Modify: `crates/agents-core/src/game.rs:686-694` (запросы противника в разделе `command` следа)
- Modify: `scripts/stage1-shots.mjs` (часть `umpire`)
- Test: `apps/editor/tests/agents-command.test.ts`, `apps/editor/tests/command-forms.test.ts`, `crates/agents-core/tests/game.rs`

**Interfaces:**
- Produces (`command-forms.ts`): `umpireApplies(engine: 'army' | 'agents' | undefined): true | string` — строка — почему настройки нет.
- Produces (`agents-game.ts`):
  - `interface EnemyEntry { tick: number; time: string; hq: string; who: string; kind: 'document' | 'decision' | 'withdraw' | 'request' | 'answer' | 'intent'; text: string; divisions: string[] }`
  - `enemyLog(t: AgentGameTrace, side: string, from: number, to: number): EnemyEntry[]` — стороны, кроме `side`, за часы `(from, to]`:
    документы штабов (`t.documents`), решения командующих (`t.commanders`, выбранный вариант и `why`), смены «по истории / сдвинут / сам»
    (`t.intent`), отходы дивизий (журнал `→ отступление`), запросы на отход и ответы (`t.command.enemyRequests`); `divisions` — дивизии,
    к которым запись относится (у штаба — его поддерево по `t.hqs`/`t.divisions`); по времени.
  - `enemyVisible(e: EnemyEntry, seen: ReadonlySet<string>): boolean` — хотя бы одна из `e.divisions` обнаружена разведкой.
  - `TraceCommand.enemyRequests?: { hq: string; division: string; tick: number; answer: boolean | null }[]`
- Produces (`game-protocol.ts`): `JournalDay.enemy?: string[]` (только видимое игроку), `TurnView.enemyLog?: EnemyEntry[]` (всё, последние 400).

- [ ] **Step 1: Разбор — где учитывается «Посредник на модели»**

Прочитать: `apps/editor/src/sim/game-worker.ts:513-523` (условие `llm.umpire && !agents`), `:536-539` (запись поправок),
`:223` (`playTurn(..., t.umpire)` — повтор записи), `crates/agents-core/src/` (`grep -rn "umpire\|mods" crates/agents-core/src` —
поправок к боям ядро не принимает), `CommandView.tsx:1991-1993` (переключатель и описание показываются всегда).
Вопрос: в каких режимах игры поправки посредника доходят до расчёта боя? Ожидаемый вывод (подтвердить или исправить
по прочитанному): только на нынешней модели (`engine === 'army'`); на агентной (в том числе «история как замысел») бои считает
ядро, посредник не вызывается, а переключатель вводит в заблуждение. Вывод — одной фразой в отчёт задачи и в описание
(задача 10, раздел 6 «Посредник» и раздел 24).

- [ ] **Step 2: Write the failing tests**

`apps/editor/tests/command-forms.test.ts`:
```ts
it('посредник на модели: настройка — только на нынешней модели, на агентной — объяснение', () => {
  expect(umpireApplies('army')).toBe(true);
  expect(umpireApplies(undefined)).toBe(true);
  expect(umpireApplies('agents')).toMatch(/агентн.*ядро/);
});
```
`apps/editor/tests/agents-command.test.ts` (фикстура `trace` файла + разведка):
```ts
describe('журнал противника в «истории как замысле»', () => {
  const t = { ...trace({ mode: 'intent', hqs: [], led: [], requests: [], historical: [],
      enemyRequests: [{ hq: 'de_101ak', division: 'de_d1', tick: 3, answer: true }] }),
    journal: [{ tick: 4, time: '1945-04-16T09:00', agent: 'de_d1', text: 'оборона → отступление' }],
    commanders: [{ hq: 'de_101ak', side: 'de', name: 'Буссе', decisions: [{ tick: 3, trigger: 'цикл', chosen: 0, why: 'держать рубеж', options: [{ kind: 'hold', label: 'Держать' }] }] }],
  } as never;
  it('документы, решения командующих, отходы, запросы и ответы противника — за ход, по времени', () => {
    const log = enemyLog(t, 'su', 0, 27);
    expect(log.map((e) => e.kind)).toEqual(['document', 'decision', 'request', 'answer', 'withdraw']);
    expect(log.every((e) => e.hq.startsWith('de_'))).toBe(true);
    expect(log.find((e) => e.kind === 'document')!.divisions).toEqual(['de_d1']);
  });
  it('игроку — только то, что видит разведка; посреднику — всё', () => {
    const log = enemyLog(t, 'su', 0, 27);
    expect(log.filter((e) => enemyVisible(e, new Set()))).toEqual([]);
    expect(log.filter((e) => enemyVisible(e, new Set(['de_d1'])))).toHaveLength(log.length);
  });
});
```
`crates/agents-core/tests/game.rs`:
```rust
#[test]
fn trace_has_enemy_requests() {
    let g = seelow_game(Mode::Intent, 24); // помощник файла (tests/game.rs:102); не поднимается на Зееловском — Mode::Agents
    let t = g.trace();
    assert!(t["command"]["enemyRequests"].is_array(), "запросы противника в следе");
    assert!(t["command"]["requests"].as_array().unwrap().iter().all(|r| r["hq"].as_str().unwrap().starts_with("su_")), "свои — отдельно");
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run apps/editor/tests/command-forms.test.ts apps/editor/tests/agents-command.test.ts`
Expected: FAIL — `umpireApplies is not a function`, `enemyLog is not a function`.
Run: `cargo test --release -p agents-core --test game trace_has_enemy_requests`
Expected: FAIL — `запросы противника в следе`.

- [ ] **Step 4: Implement**

`game.rs:688`: рядом с `requests` — `enemy_requests` с тем же видом по штабам не своей стороны; ключ `"enemyRequests"`.
`enemyLog`/`enemyVisible` — по интерфейсу; тексты: документ — `` `${dm} ${hqName} · ${KIND_RU}: ${text}` ``, решение —
`` `${dm} ${name}: ${label} — ${why}` ``, запрос — `` `${dm} ${hqName}: запрос на отход ${divisionName}` ``, ответ — «отход разрешён»/«в отходе отказано».
Поток игры (`advance`, ветка `agents`): `const log = enemyLog(t, rec.human, from, t.frames.length - 1)`;
видимые — `detected(...)` по последнему кадру, как в `fog()` (`game-worker.ts:632-644`); `journal.push(day(...))` получает
`enemy: log.filter(visible).map((e) => e.text)`; общий `enemyLogAll` (обрезка до 400) — в `TurnView.enemyLog`.
`Journal`: раздел «Противник (по разведке)» из `d.enemy`. `Umpire`: переключатель посредника — только при `umpireApplies(view.engine) === true`,
иначе на его месте `<p className="muted">` с текстом причины; часть «Как действовал противник» при `enemy` `agents`/`intent` —
список `view.enemyLog` по ходам (новее сверху); `UmpireNotes` на агентной модели — «Поправок нет: бои считает ядро агентной модели».
Обработчик переключателя не менять (`voice-completeness`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/editor/tests/command-forms.test.ts apps/editor/tests/agents-command.test.ts apps/editor/tests/voice-completeness.test.ts apps/editor/tests/voice-umpire.test.ts`
Expected: PASS.
Run: `cargo test --release -p agents-core --test game` и `cargo test --release -p agents-core --test command`
Expected: PASS (отпечатки `SEELOW_48_DIGEST`, `LEGACY_GAME_DIGEST` прежние).

- [ ] **Step 6: Live check — часть `umpire`**

Игра «История как замысел», один ход; «Посредник»: переключателя «Посредник на модели…» нет, есть пояснение; «Как действовал
противник» — не пусто (документы немецких штабов этого хода); «Журнал» — раздел «Противник (по разведке)», каждая его строка
есть в списке посредника, а строк о дивизиях, которых нет в `window.__cmdView.intel`, — нет. Снимки `umpire-intent.jpg`, `journal-enemy.jpg`.

Run: `node scripts/stage1-shots.mjs --only umpire`
Expected: `ok umpire: переключателя нет на агентной`, `ok umpire: противник в журнале посредника`, `ok umpire: журнал — только видимое`.

- [ ] **Step 7: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add apps/editor/src/command-forms.ts apps/editor/tests/command-forms.test.ts apps/editor/src/sim/agents-game.ts apps/editor/tests/agents-command.test.ts apps/editor/src/sim/game-worker.ts apps/editor/src/sim/game-protocol.ts apps/editor/src/CommandView.tsx crates/agents-core/src/game.rs crates/agents-core/tests/game.rs scripts/stage1-shots.mjs
git commit -m "fix(посредник): настройка только на нынешней модели; действия противника — в журнале посредника и по разведке в журнале"
```

---

### Task 8: Разграничительные линии армий не отстают

Пункт 9 (разбор). Требование: в каждый час у армии на карте — её действующая полоса, линии доходят до переднего края армии
и на глубину ближайшей задачи; армия не дальше 5 км за своей нарисованной полосой, если ядро само не вывело её за полосу.

**Files:**
- Modify (по разбору): `crates/agents-core/src/command/band.rs` (новые `outside_km`, `reach_km`, `extend_band`), `crates/agents-core/src/command/agent.rs:55-71` (`current_band`),
  `crates/agents-core/src/intent/dispatch.rs` и цикл штаба-агента в `command/agent.rs` (продление), `crates/agents-core/src/trace.rs:48-70` (полосы в след)
- Modify (по разбору): `packages/sim/src/agents.ts:12-33,103-140` (`AgentTrace.bands?`), `packages/sim/src/publish.ts:691-735` (линии армий из следа)
- Modify: `scripts/stage1-shots.mjs` (часть `bounds`)
- Test: `crates/agents-core/tests/intent.rs`, `packages/sim/tests/agents.test.ts`

**Interfaces:**
- Produces (`band.rs`): `outside_km(p: XY, band: &Band) -> f64` — 0 внутри, иначе `p.dist(point_in_band(p, band))`;
  `reach_km(band: &Band, base: XY, dir: XY) -> f64` — докуда по оси (проекция на `dir` от `base`) доходят обе границы (меньшая);
  `extend_band(band: &Band, base: XY, dir: XY, to_km: f64) -> Band` — обе границы продлены по направлению своего последнего отрезка до проекции `to_km`.
- Produces (`agent.rs`): `current_band(sim: &Sim, h: u32) -> Option<(Band, XY, XY)>` — полоса, начало оси и направление по
  `sim.command.intent[h]` и `subs_of(sim, h)` через `frame`; замысла нет — `None`.
- Produces (след, `trace.rs`): `"bands": [{ "hq": id, "tick": u32, "left": [[lng,lat]…], "right": [[lng,lat]…] }]` — при каждой смене
  полосы армии (новый замысел или продление); TS: `AgentTrace.bands?: { hq: string; tick: number; left: LngLat[]; right: LngLat[] }[]`.

- [ ] **Step 1: Разбор — почему линии остаются на месте директивы**

Прочитать: `packages/sim/src/publish.ts:691-735` (линии армий — `sectorMap`/`sectorLines` по снимкам, «где действует директива,
расчётная линия идёт по ней»), `packages/sim/src/sectors.ts:55-80,139-180,240-310` (`effectiveBoundaries`, `historical`), `apps/editor/src/sim/agents-game.ts:95-101`
(игра: `boundaries: base.scenario.boundaries` — исторические линии без смены), `crates/agents-core/src/command/agent.rs:55-71` (`frame`:
границы — `intent.boundaries` директивы, отданной однажды), `crates/agents-core/src/command/control.rs:31` (`intent[h]` меняется только
новой директивой), `crates/agents-core/src/intent/dispatch.rs` (подаёт ли диспетчер новую полосу армии при продвижении).
Вопросы: (а) рисуется ли на карте полоса ядра или своя, по снимкам и историческим линиям; (б) меняется ли `intent[h].boundaries`
армии по мере продвижения. Замер: прогнать Берлинскую `intent` до часов 24/72/144 (тест шага 2 с `-- --nocapture`, печать по армиям
`outside` и `reach` против переднего края) и тот же расчёт в «Переигровке» — снимок части `bounds`. Вывод — в отчёт задачи и в описание (раздел 19.8).

- [ ] **Step 2: Write the failing tests (закрепляют требование при любом выводе разбора)**

`crates/agents-core/tests/intent.rs` (помощники файла `intent_sim`, `run_to`, `under`, `hq`):
```rust
/// Пункт 9 спецификации пакета: у каждой советской армии в часы 24, 72, 144 «Истории как замысла» дивизии не дальше 5 км
/// за действующей полосой (кроме посланных ядром за полосу — цель приказа вне полосы), а полоса доходит до переднего края
/// армии и до рубежа ближайшей задачи.
#[test]
fn intent_bands_follow_armies() {
    use agents_core::command::{agent::current_band, band::{outside_km, reach_km}};
    use agents_core::model::Echelon;
    let mut sim = intent_sim();
    for tick in [24, 72, 144] {
        run_to(&mut sim, tick);
        for h in 0..sim.world.hqs.len() as u32 {
            let w = &sim.world.hqs[h as usize];
            if w.side != Side::Su || w.echelon != Echelon::Army { continue; }
            let Some((band, base, dir)) = current_band(&sim, h) else { continue };
            let mut front = 0.0f64;
            for i in under(&sim, h) {
                let d = &sim.world.divisions[i];
                front = front.max((d.vars.pos.x - base.x) * dir.x + (d.vars.pos.y - base.y) * dir.y);
                let sent_out = d.order.as_ref().is_some_and(|o| outside_km(o.target, &band) > 0.0);
                assert!(sent_out || outside_km(d.vars.pos, &band) <= 5.0, "{} час {tick}: {} за полосой на {:.1} км", w.id, d.id, outside_km(d.vars.pos, &band));
            }
            let task = sim.command.intent[h as usize].as_ref().and_then(|x| x.immediate.as_ref())
                .map(|l| l.pts.iter().map(|p| (p.x - base.x) * dir.x + (p.y - base.y) * dir.y).fold(0.0, f64::max)).unwrap_or(0.0);
            assert!(reach_km(&band, base, dir) >= front.max(task) - 0.5, "{} час {tick}: полоса до {:.1} км, передний край {front:.1}, задача {task:.1}", w.id, reach_km(&band, base, dir));
        }
    }
}
```
`packages/sim/tests/agents.test.ts` (фикстура `trace()` файла — ход на 12 ч, армия `su_8gva`; контекст — как в тесте `:54`):
```ts
it('линии армий на карте — полосы из следа ядра, по часам их смены', async () => {
  const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
  const t: AgentTrace = { ...trace(), bands: [
    { hq: 'su_8gva', tick: 0, left: [[14.6, 52.70], [14.2, 52.70]], right: [[14.6, 52.50], [14.2, 52.50]] },
    { hq: 'su_8gva', tick: 6, left: [[14.6, 52.70], [13.9, 52.70]], right: [[14.6, 52.50], [13.9, 52.50]] },
  ] };
  const { ctx, run } = agentsToRun(base, t, 3);
  const doc = runToDocument(ctx, run, agentsHistory({ divisions: [], events: [] }, history), { name: 'проба' });
  const lines = doc.features.filter((f) => f.layerId === 'lvl-op-bounds' && f.name?.startsWith('Полоса 8')) as LineFeature[];
  expect(lines.filter((f) => f.time?.from === '1945-04-16T05:00')).toHaveLength(2);       // левая и правая
  expect(lines.filter((f) => f.time?.from === '1945-04-16T11:00' && f.points.some((p) => p[0] === 13.9))).toHaveLength(2);
  expect(lines.find((f) => f.time?.from === '1945-04-16T05:00')!.time?.to).toBe('1945-04-16T11:00');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --release -p agents-core --test intent intent_bands_follow_armies -- --nocapture`
Expected: FAIL — `cannot find function current_band` (затем, после заготовок функций, — `… полоса до … км, передний край …` или
`… за полосой на … км`: это и есть подтверждение разбора).
Run: `npx vitest run packages/sim/tests/agents.test.ts`
Expected: FAIL — линий из `bands` нет.

- [ ] **Step 4: Implement — по выводу разбора**

Всегда: `outside_km`, `reach_km`, `extend_band`, `current_band`; след — `bands` (запись в `Sim` при смене `intent[h]` армии и при
продлении; только для `echelon == "army"`); `agentsToRun` переносит `bands` в контекст, `boundaryFeatures` (`publish.ts`) при наличии
`bands` рисует обе границы полосы каждой армии в `lvl-op-bounds` (и `sim-bounds` на уровнях корпуса и дивизии) — название
`Полоса ${shortName(армия)}: правая разграничительная линия` / `…: левая …`, `time.from` = час смены, `to` — следующая смена (последняя — `null`);
расчётные линии армий по снимкам для агентной модели не рисуются; линии фронтов — как были.
Если разбор показал, что полоса ядра не продвигается (`intent[h]` неизменен, `reach_km` меньше переднего края): в цикле штаба-агента
(`command/agent.rs`) и в шаге диспетчера `intent` (`intent/dispatch.rs`) — продление: передний край армии по оси дальше
`reach_km(...) - 0.5 × глубина полосы` → `intent[h].boundaries` заменяются продлёнными `extend_band(..., front + depth)`, где
`depth` — глубина ближайшей задачи от переднего края (нет — 20 км); документ штаба вида `instruction` «продлить полосу до …».
Продление действует только в режимах командования `agents` и `intent` (`command_mode` не `legacy`).
Если разбор показал, что ядро полосу продвигает, а отстаёт только рисунок, — продление в ядре не добавлять, хватает рисунка из следа.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --release -p agents-core --test intent intent_bands_follow_armies` → Expected: PASS.
Run: `cargo test --release -p agents-core` → Expected: PASS, в том числе `coordination_one_changes_nothing` и `legacy_game_unchanged`
(отпечатки прежние; сменился — см. Global Constraints).
Run: `npx vitest run packages/sim/tests/agents.test.ts packages/sim/tests/sectors.test.ts` → Expected: PASS.

- [ ] **Step 6: Live check — часть `bounds`**

«Переигровка» Берлинской «История как замысел», уровень «Фронт», часы 24/72/144 (ползунок): для каждой советской армии
доля её дивизий (`window.__replayEngine` + знаки уровня «Корпус») вне её линий ≤ 5 км — печать по часам; снимки
`bounds-h24.jpg`, `bounds-h72.jpg`, `bounds-h144.jpg` — линии у переднего края, не на рубеже исходной директивы.

Run: `node scripts/stage1-shots.mjs --only bounds`
Expected: `ok bounds: час 24`, `ok bounds: час 72`, `ok bounds: час 144`.

- [ ] **Step 7: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add crates/agents-core/src crates/agents-core/tests/intent.rs packages/sim/src/agents.ts packages/sim/src/publish.ts packages/sim/tests/agents.test.ts scripts/stage1-shots.mjs
git commit -m "fix(полосы): линии армий — действующая полоса ядра по часам, доходят до переднего края и рубежа задачи"
```

---

### Task 9: Укомплектованность — «от штата» и «от начала операции»

Пункт 10 (разбор). Сейчас `strength = personnel / initial.personnel` (`packages/sim/src/reports.ts:194`), а `initial` в агентной
игре — первый кадр операции (`packages/sim/src/agents.ts:204-240`, `initial: r0[iPers]`): мерило «от начала операции», отсюда
98–99 %. Численность дивизий сценария — уже некомплект (`berlin-1945.json`: `su_12gsd` 4 920 чел. при штате около 11,7 тыс.).

**Files:**
- Create: `packages/sim/data/rules/establishment.json`, `packages/sim/src/establishment.ts`
- Modify: `packages/sim/src/agents.ts:110-112` (`FormationDef.staffKind` у дивизий = `d.kind`), тип `FormationDef` (поле `staffKind?: string`)
- Modify: `packages/sim/src/reports.ts:120-123,194,320-340` (`UnitReport.manning`), `apps/editor/src/post-views.ts:27-41` (`aggregate`)
- Modify: `packages/sim/src/norms.ts:15-21,150-160` (мера `establishment`), `packages/sim/data/rules/norms.json` (строки штатов)
- Modify: `apps/editor/src/voice/actions/staff.ts:196-205`, `apps/editor/src/voice/report.ts:40-55,116-125`, `apps/editor/src/decision-drafts.ts:45`,
  `apps/editor/src/CommandView.tsx:1048,1082,1151,1824`
- Modify: `scripts/stage1-shots.mjs` (часть `manning`)
- Test: `packages/sim/tests/strength.test.ts`, `packages/sim/tests/norms.test.ts`, `apps/editor/tests/voice-staff.test.ts`

**Interfaces:**
- Produces (`establishment.json`): `{ "_about": "...", "rows": [{ "id": "su-sd-1944", "side": "su", "kinds": ["sd"], "personnel": <число из источника>, "title": "...", "kb": "...", "source": "...", "reliability": "A|B|C" }] }`.
- Produces (`establishment.ts`): `establishmentOf(side: string, kind: string | undefined): { personnel: number; title: string; source: string } | null`.
- Produces (`reports.ts`): `UnitReport.manning: number | null` — доля от штата (`personnel / establishment.personnel`; у штаба — сумма людей /
  сумма штатов дивизий со штатом; штата нет — `null`); `strength` — без изменений, «от начала операции».
- Produces (`norms.ts`): мера `{ kind: 'establishment'; id: string }` — значение — `personnel` строки `establishment.json`, сверка с `expect`.
- Produces (`apps/editor/src/num-format.ts`, из задачи 1): `fmtPct`; новая `manningText(u: Pick<UnitReport, 'manning' | 'strength'>): string` —
  `"42 % от штата, 97 % от начала операции"`; без штата — `"97 % от начала операции"`.

- [ ] **Step 1: Разбор — от чего считаются 98–99 % и что говорит база знаний**

Прочитать: `packages/sim/src/reports.ts:194,337`, `packages/sim/src/agents.ts:204-240` (`initial`), `apps/editor/src/sim/agents-game.ts:95-101`,
`apps/editor/src/voice/actions/staff.ts:196-205`, `apps/editor/src/voice/report.ts:45-55`. Сверка численности: `npm run -s sim:census -- --json evals-out/census/census.json`
и записи `personnel` базы (`grep -o '"key":"personnel"[^}]*' packages/knowledge/data/seed.json | head`) против `personnel` дивизий
`packages/sim/data/scenarios/agents/berlin-1945.json`: отчёт о расхождениях (дивизия, сценарий, база, источник) — в отчёт задачи;
исправить в сценарии только те, у которых в базе есть источник (через данные сборки `npm run agents:berlin-data`, не руками в JSON).
Штаты: найти в `docs/sources/` и в базе знаний (`grep -rn "штат" docs/sources packages/knowledge/data/curated`) штатную численность
стрелковой дивизии РККА 1944–45 гг. (спецификация: около 11,7 тыс.; гвардейская — того же порядка), танкового и механизированного
корпуса, немецких пехотной и танковой дивизий 1944–45 гг. Есть источник — строка в `establishment.json` и в `norms.json`
(`measure.kind: 'establishment'`, `expect` — пределы из источника); нет — строка-допущение в `norms.json`
(`measure.kind: 'assumption'`, `why` — какого документа не хватает), в `establishment.json` её нет, и `manning` для этого вида — `null`.

- [ ] **Step 2: Write the failing tests**

`packages/sim/tests/strength.test.ts`:
```ts
import { establishmentOf } from '../src/establishment';
import rows from '../data/rules/establishment.json';

it('штат по виду соединения: у каждой строки — источник; неизвестный вид — null', () => {
  for (const r of rows.rows) { expect(r.source).not.toBe(''); expect(r.personnel).toBeGreaterThan(0); }
  const sd = establishmentOf('su', 'sd');
  expect(sd!.personnel).toBeGreaterThanOrEqual(11000);
  expect(sd!.personnel).toBeLessThanOrEqual(12500);
  expect(establishmentOf('su', 'нет такого')).toBeNull();
});
it('укомплектованность: от штата и от начала операции — разные мерила', () => {
  // дивизия sd: 4 920 при 5 000 на начало операции
  const [u] = unitReports(ctxWith({ staffKind: 'sd', personnel: 4920, initial: 5000 }), state, 'su', null);
  expect(u.strength).toBeCloseTo(0.984, 3);
  expect(u.manning).toBeCloseTo(4920 / establishmentOf('su', 'sd')!.personnel, 3);
});
```
(`ctxWith`/`state` — помощник файла с одной советской дивизией; нет — собрать по образцу соседних тестов `strength.test.ts`.)
`apps/editor/tests/voice-staff.test.ts`:
```ts
it('черновик донесения — укомплектованность от штата и от начала операции', () => {
  const t = draftReportText({ ...view, own: [{ ...unit, status: 'active', strength: 0.97, manning: 0.42 }] } as never, EMPTY_DECISION);
  expect(t).toContain('42 % от штата, 97 % от начала операции');
});
```
`packages/sim/tests/norms.test.ts`: строки `measure.kind === 'establishment'` ссылаются на существующий `id` `establishment.json`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/sim/tests/strength.test.ts packages/sim/tests/norms.test.ts apps/editor/tests/voice-staff.test.ts`
Expected: FAIL — `Cannot find module '../src/establishment'`; `expected … to contain '42 % от штата…'`.

- [ ] **Step 4: Implement**

По интерфейсу; `manningText` — в `num-format.ts`. Новое мерило везде, где говорится об укомплектованности: `draftReportText`
(`staff.ts:201` — «средняя укомплектованность {manningText(среднее)}»), доклад голосом (`report.ts:50,123`), черновик сводки
(`decision-drafts.ts:45`), карточка объединения и сводки «Доклады» (`CommandView.tsx:1048,1082,1151,1824` — полоса — по
`manning ?? strength`, подпись — `manningText`). Среднее по группе — по людям и штатам (сумма людей / сумма штатов), не среднее долей.
Норматив: в `norms.ts` ветка `establishment` рядом с `assumption` (`norms.ts:156-157`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/sim/tests/strength.test.ts packages/sim/tests/norms.test.ts apps/editor/tests/voice-staff.test.ts apps/editor/tests/post-views.test.ts apps/editor/tests/decision-drafts.test.ts`
Expected: PASS.
Run: `npm run sim:norms -- --doc docs/norms-check.md` → Expected: строки штатов в отчёте, без ошибок.

- [ ] **Step 6: Live check — часть `manning`**

Игра на агентной модели; «Доклады» пункта армии: у армии — «… % от штата, … % от начала операции», доля от штата заметно ниже
(не 98–99 %); голос «штаб, доложи обстановку» (`window.__act('command.report')`) — ответ содержит «от штата». Снимок `manning-reports.jpg`.

Run: `node scripts/stage1-shots.mjs --only manning`
Expected: `ok manning: доклады — от штата и от начала`, `ok manning: голос — от штата`.

- [ ] **Step 7: Typecheck, full tests, commit**

Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → Expected: без ошибок и `FAIL`.
```bash
git add packages/sim/data/rules/establishment.json packages/sim/data/rules/norms.json packages/sim/src packages/sim/tests apps/editor/src apps/editor/tests docs/norms-check.md scripts/stage1-shots.mjs
git commit -m "feat(укомплектованность): от штата по виду соединения (с источником) и от начала операции — в докладах и голосе"
```

---

### Task 10: Описание системы, снимки, PDF и Word, база знаний, выжимка

Правила `CLAUDE.md`, пункты 1–6.

**Files:**
- Modify: `docs/system.md` — раздел 6: «Агент на карте» / вкладка «Командующий» (неподвижные числа), график состязания (свёртка, колонка
  с легендой), плеер (скорость 1 ч/с), «Зоны влияния сторон» (теперь и в «Переигровке»), «Командование по ступеням в экране
  командования» (раздельные кнопки, «только своё», «показать все», переезд карты к штабу), «Приказы» (видимые подвкладки), «Посредник»
  (только на нынешней модели — вывод разбора задачи 7; журнал противника в «истории как замысле»), доклады (укомплектованность от штата и
  от начала операции — вывод разбора задачи 9); раздел 18.1 «Состав и численность» (штаты, расхождения с базой); раздел 19.8 «Полосы фронтов
  и разграничительные линии» и 19.14 «История как замысел» (вывод разбора задачи 8, продление полосы, если сделано); раздел 22 —
  цифры только из свежего `npm run sim:demo`; раздел 24 (посредник).
- Modify: `docs/img/replay-commander.jpg`, `replay-commander-map.jpg`, `command-staffs.jpg`, `command-docs.jpg`, `voice-zones.jpg`
  (или новый `replay-zones.jpg`), `replay-layers.jpg`; новые: `replay-zones.jpg`, `journal-enemy.jpg`, `bounds-army.jpg`
- Modify: `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json`, `packages/knowledge/data/model-index.json`, `docs/norms-check.md`

- [ ] **Step 1: Свежие цифры модели**

Run: `npm run sim:demo 2>&1 | tail -20`
Expected: прогон без ошибок; цифры раздела 22 (в том числе 22.8 «История как замысел», если задача 8 меняла модель) — переписать из этого вывода.

- [ ] **Step 2: Текст `docs/system.md`**

Дописать и поправить разделы по списку выше; устаревшее убрать («график поверх легенды», «скорость от 3 ч/с», «98–99 %»);
после правки — `grep -n "раздел [0-9]\+\.[0-9]\+" docs/system.md` и сверить ссылки с заголовками. Без дат, без упоминаний ассистента и
веток.

- [ ] **Step 3: Снимки**

Снимки для описания — частями `scripts/stage1-shots.mjs` с `--out docs/img` (окно 1440×900, JPEG) и `node scripts/agents-shots.mjs`
для `command-staffs.jpg`, `command-docs.jpg`; под каждым новым — подпись курсивом о том, что на снимке действительно видно
(посмотреть снимок перед подписью).

Run: `node scripts/stage1-shots.mjs --only commander,dock,zones,staffs,umpire,bounds,manning --out docs/img`
Expected: все строки `ok …`, файлы в `docs/img/`.

- [ ] **Step 4: База знаний, нормативы, выжимка**

Run: `npm run kb:seed 2>&1 | tail -3` → Expected: `seed.json` пересобран без ошибок.
Run: `npm run sim:norms -- --doc docs/norms-check.md 2>&1 | tail -3` → Expected: без ошибок.
Run: `npm run model:index 2>&1 | tail -3` → Expected: `model-index.json` пересобран.
Run: `npx vitest run packages/knowledge/tests/model-index.test.ts packages/knowledge/tests/seed-fresh.test.ts packages/knowledge/tests/seed-norms.test.ts`
Expected: PASS.

- [ ] **Step 5: PDF и Word**

Run: `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system 2>&1 | tail -3`
Expected: `docs/system.pdf` и `docs/system.docx` собраны без ошибок.

- [ ] **Step 6: Сквозная проверка голоса, итоговые проверки, коммит**

Run (в фоне): `node scripts/voice-e2e.mjs --only game > evals-out/stage1/voice.txt 2>&1`, затем
`grep -c '^ok' evals-out/stage1/voice.txt` и `grep -v '^ok' evals-out/stage1/voice.txt | tail`
Expected: строк не-`ok` с ошибками нет.
Run: `npm run typecheck 2>&1 | tail -3` и `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` и `cargo test --release -p agents-core 2>&1 | grep -E "test result|FAILED"`
Expected: без ошибок и `FAIL`/`FAILED`.
```bash
git add docs/system.md docs/img docs/system.pdf docs/system.docx docs/norms-check.md packages/knowledge/data/seed.json packages/knowledge/data/model-index.json
git commit -m "docs: этап 1 пакета доработок — описание, снимки, база знаний, выжимка"
```
