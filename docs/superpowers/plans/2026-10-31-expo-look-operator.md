# Выставочный режим: основа оформления и меню оператора — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Меню оператора со сводкой, крупными действиями и вкладками; общая тема стенда (цвета, шрифты, кегль для 80″), применённая к меню и к заглушкам сцен.

**Architecture:** Тема — переменные CSS в `expo/theme.css`, `expo.css` пользуется только ими. Мелкие элементы меню (шаг числа, порядок мониторов, сводка служб) — в `expo/operator-parts.tsx`; `OperatorMenu.tsx` собирает их во вход по ПИН, сводку, действия и вкладки. Поведение меню (сохранение сразу через `normalizeSettings`, блокировка ПИН, пауза сеанса) не меняется.

**Tech Stack:** React/TypeScript, vitest + happy-dom + @testing-library/react, Playwright (снимки), `@fontsource/pt-mono`.

**Spec:** `docs/superpowers/specs/2026-10-31-expo-look-operator-design.md`.

## Global Constraints

- Язык интерфейса, описания, коммитов — русский; правила `CLAUDE.md` (снимки 1440×900 JPEG с подписями о видимом, `npm run docs:system`, в описании нет дат).
- Ветка `claude/expo`.
- Без сети на стенде: шрифты — только пакеты `@fontsource/*`.
- Цвета: фон `#0f1a18`, панель `#16231f`, линия `#3a4a44`, текст `#eee8d8`, второстепенный `#b9b6a6`, золото `#f2c14e`, тревога `#7a1f1a`, свои `#c4382c`, противник `#3d6fb6`, готово `#2f9e55`, ожидание `#c9a227`, нет связи `#c4382c`.
- Кегль экранов посетителя: текст ≥ 32 px, второстепенный ≥ 28 px, заголовки 64–96 px, таймер 120 px; меню оператора — 18–20 px.
- Шаги: таймер 5 с (10–120), бездействие 10 с (30–600), возврат после итога 5 с (5–120), число экранов 1 (1–3).
- Сцены, карта, анимация — не в этой работе (этап 4).
- Проверки: `npx vitest run <файл>`; перед коммитом задачи — `npm run typecheck 2>&1 | tail -3`, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`.

---

### Task 1: Тема стенда и заглушки сцен посетителя

**Files:**
- Create: `apps/editor/src/expo/theme.css`
- Modify: `apps/editor/src/expo/expo.css`, `apps/editor/src/expo/ExpoView.tsx` (подвал), `apps/editor/demo/fonts.ts`, `package.json` (devDependencies или dependencies редактора — где лежат остальные `@fontsource`), `apps/editor/tests/expo-root.test.tsx`

**Interfaces:**
- Produces: переменные CSS `--expo-bg`, `--expo-panel`, `--expo-line`, `--expo-text`, `--expo-muted`, `--expo-gold`, `--expo-alarm`, `--expo-own`, `--expo-enemy`, `--expo-ok`, `--expo-wait`, `--expo-fail`, `--expo-serif`, `--expo-sans`, `--expo-mono`, `--expo-text-min`, `--expo-text-small` на `:root`; класс `.expo-primary` — золотая главная кнопка; класс `.expo-danger` — тёмно-красная кнопка.

- [ ] **Step 1: Падающий тест** — в `expo-root.test.tsx`:

```tsx
it('visitor footer has no service captions', () => {
  const state = step(initialState(0), { t: 'jump', phase: 'turn' }, EXPO_DEFAULTS).state;
  const view = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} send={() => {}} />);
  expect(view.queryByText(/Каркас выставочного режима/)).toBeNull();
});
```

- [ ] **Step 2:** `npx vitest run apps/editor/tests/expo-root.test.tsx` — FAIL (надпись есть).
- [ ] **Step 3:** `npm install @fontsource/pt-mono -w @def-ops/editor` (или в корень — туда же, где `@fontsource/pt-serif`: `rg -n pt-serif package.json apps/editor/package.json`); в `demo/fonts.ts` — `import '@fontsource/pt-mono/400.css';`.
- [ ] **Step 4:** `theme.css`:

```css
/* Тема выставочного стенда: цвета, шрифты, кегль (80″ с 2–4 м — текст не меньше 32 px). */
:root {
  --expo-bg: #0f1a18; --expo-panel: #16231f; --expo-line: #3a4a44;
  --expo-text: #eee8d8; --expo-muted: #b9b6a6;
  --expo-gold: #f2c14e; --expo-alarm: #7a1f1a;
  --expo-own: #c4382c; --expo-enemy: #3d6fb6;
  --expo-ok: #2f9e55; --expo-wait: #c9a227; --expo-fail: #c4382c;
  --expo-serif: 'PT Serif', serif; --expo-sans: 'PT Sans Narrow', sans-serif; --expo-mono: 'PT Mono', monospace;
  --expo-text-min: 32px; --expo-text-small: 28px;
}
```

- [ ] **Step 5:** `expo.css` — первой строкой `@import './theme.css';`; все цвета и шрифты заменить переменными; `.expo` — `font: var(--expo-text-min) var(--expo-sans)`; `.expo h1` — 80 px PT Serif; `.expo h2` — 48 px; `.expo-timer` — 120 px `var(--expo-mono)`; `.expo button.expo-secondary` — `font-size: var(--expo-text-small)`; `.expo-footer` — `font-size: var(--expo-text-small)`; новые:

```css
.expo button.expo-primary, .expo-operator button.expo-primary { background: var(--expo-gold); color: #1d1a12; border-color: var(--expo-gold); font-weight: 700; }
.expo button.expo-primary:hover, .expo-operator button.expo-primary:hover { background: #ffd469; }
.expo-operator button.expo-danger { background: var(--expo-alarm); border-color: #a3392f; color: #fff4ec; }
```

  медиазапрос `max-width: 800px` не трогать (окно разработки).
- [ ] **Step 6:** `ExpoView.tsx`: убрать `<span>Каркас выставочного режима · сцены без расчёта операции</span>`; главные кнопки сцен («Коснитесь, чтобы принять командование», «К решениям», «Ещё раз») — `className="expo-primary"`.
- [ ] **Step 7:** тест — PASS; `npx vitest run apps/editor/tests/expo-` — PASS.
- [ ] **Step 8:** Коммит `feat(выставка): тема стенда — цвета, шрифты, кегль для 80″`.

### Task 2: Элементы меню — шаг числа, порядок мониторов, сводка служб

**Files:**
- Create: `apps/editor/src/expo/operator-parts.tsx`, `apps/editor/tests/expo-operator-parts.test.tsx`

**Interfaces:**
- Consumes: `ProbeStates`, `PROBE_NAMES` (`health.ts`), `ExpoStats` (`stats.ts`), `MonitorInfo` (`windows.ts`).
- Produces:
  - `function Stepper(p: { label: string; value: number; min: number; max: number; step: number; onValue: (v: number) => void }): JSX.Element` — `role="group"` с `aria-label={label}`; кнопки `aria-label={`${label}: меньше`}` и `…: больше`; значение в `<output>`; кнопка на границе — `disabled`.
  - `function moveMonitor(order: string[], ids: string[], id: string, by: -1 | 1): string[]` — чистая: полный порядок (сначала `order` из известных `ids`, затем остальные `ids` по их порядку), сдвиг `id` на `by` в пределах списка.
  - `function MonitorOrder(p: { monitors: MonitorInfo[]; order: string[]; onOrder: (order: string[]) => void }): JSX.Element` — нумерованный список «N. Имя · id» с кнопками `aria-label={`${name}: выше`}`/`…: ниже`.
  - `const PROBE_WORDS: Record<ProbeState, string> = { wait: 'проверяю…', ok: 'готово', fail: 'нет связи', off: 'не требуется' }`.
  - `function ServiceSummary(p: { health: ProbeStates; note: string | null; stats: ExpoStats; screens: { open: number; want: number } }): JSX.Element` — четыре строки «Имя — слово» с отметкой `data-state={state}`; у экранов — «Экраны — {open} из {want}» при `ok`; строка `note`; три числа «Начато», «Завершено», «Сбоев».

- [ ] **Step 1: Падающие тесты** (`expo-operator-parts.test.tsx`, happy-dom):

```tsx
// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MonitorOrder, ServiceSummary, Stepper, moveMonitor } from '../src/expo/operator-parts';
afterEach(cleanup);

it('stepper moves by step and stops at bounds', () => {
  const values: number[] = [];
  const view = render(<Stepper label="Время выбора, с" value={115} min={10} max={120} step={5} onValue={(v) => values.push(v)} />);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: больше' }));
  expect(values).toEqual([120]);
  view.rerender(<Stepper label="Время выбора, с" value={120} min={10} max={120} step={5} onValue={(v) => values.push(v)} />);
  expect((view.getByRole('button', { name: 'Время выбора, с: больше' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: меньше' }));
  expect(values).toEqual([120, 115]);
  expect(view.getByRole('group', { name: 'Время выбора, с' }).textContent).toContain('120');
});

it('monitor order fills unknown and moves within bounds', () => {
  expect(moveMonitor([], ['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  expect(moveMonitor(['c', 'x'], ['a', 'b', 'c'], 'c', -1)).toEqual(['c', 'a', 'b']);
  expect(moveMonitor(['b'], ['a', 'b'], 'a', 1)).toEqual(['b', 'a']);
  const saved: string[][] = [];
  const view = render(
    <MonitorOrder
      monitors={[
        { id: 'a', name: 'Левый', x: 0, y: 0, width: 1, height: 1, scale: 1 },
        { id: 'b', name: 'Правый', x: 1, y: 0, width: 1, height: 1, scale: 1 },
      ]}
      order={[]}
      onOrder={(o) => saved.push(o)}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: 'Правый: выше' }));
  expect(saved).toEqual([['b', 'a']]);
  expect((view.getByRole('button', { name: 'Левый: выше' }) as HTMLButtonElement).disabled).toBe(true);
});

it('summary speaks words, not codes', () => {
  const view = render(
    <ServiceSummary
      health={{ core: 'ok', voice: 'fail', model: 'off', windows: 'ok' }}
      note="Запуск в режиме без ИИ"
      stats={{ sessions: 3, finished: 2, failures: 1 }}
      screens={{ open: 2, want: 3 }}
    />,
  );
  for (const t of ['Ядро — готово', 'Голос — нет связи', 'Языковая модель — не требуется', 'Экраны — 2 из 3', 'Запуск в режиме без ИИ']) expect(view.getByText(t)).toBeTruthy();
  expect(view.queryByText(/\bok\b|\boff\b/)).toBeNull();
});
```

- [ ] **Step 2:** `npx vitest run apps/editor/tests/expo-operator-parts.test.tsx` — FAIL (нет модуля).
- [ ] **Step 3:** Реализация `operator-parts.tsx`:

```tsx
/** Элементы меню оператора: шаг числа, порядок мониторов, сводка служб и статистики дня. */
import { PROBE_NAMES, type ProbeState, type ProbeStates } from './health';
import type { ExpoStats } from './stats';
import type { MonitorInfo } from './windows';

export function Stepper({ label, value, min, max, step, onValue }: { label: string; value: number; min: number; max: number; step: number; onValue: (v: number) => void }) {
  const to = (v: number) => onValue(Math.min(max, Math.max(min, v)));
  return (
    <div className="expo-stepper" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}: меньше`} disabled={value <= min} onClick={() => to(value - step)}>−</button>
        <output>{value}</output>
        <button type="button" aria-label={`${label}: больше`} disabled={value >= max} onClick={() => to(value + step)}>+</button>
      </div>
    </div>
  );
}

export function moveMonitor(order: string[], ids: string[], id: string, by: -1 | 1): string[] {
  const first = [...new Set(order)].filter((x) => ids.includes(x));
  const full = [...first, ...ids.filter((x) => !first.includes(x))];
  const i = full.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= full.length) return full;
  [full[i], full[j]] = [full[j], full[i]];
  return full;
}

export function MonitorOrder({ monitors, order, onOrder }: { monitors: MonitorInfo[]; order: string[]; onOrder: (order: string[]) => void }) {
  const ids = monitors.map((m) => m.id);
  const full = moveMonitor(order, ids, '', 1);
  if (!monitors.length) return <p className="expo-muted">Мониторы не найдены.</p>;
  return (
    <ol className="expo-monitors">
      {full.map((id, i) => {
        const m = monitors.find((x) => x.id === id)!;
        return (
          <li key={id}>
            <span>{m.name} · {m.id}</span>
            <button type="button" aria-label={`${m.name}: выше`} disabled={i === 0} onClick={() => onOrder(moveMonitor(order, ids, id, -1))}>↑</button>
            <button type="button" aria-label={`${m.name}: ниже`} disabled={i === full.length - 1} onClick={() => onOrder(moveMonitor(order, ids, id, 1))}>↓</button>
          </li>
        );
      })}
    </ol>
  );
}

export const PROBE_WORDS: Record<ProbeState, string> = { wait: 'проверяю…', ok: 'готово', fail: 'нет связи', off: 'не требуется' };

export function ServiceSummary({ health, note, stats, screens }: { health: ProbeStates; note: string | null; stats: ExpoStats; screens: { open: number; want: number } }) {
  return (
    <section className="expo-summary" aria-label="Состояние стенда">
      <ul>
        {(Object.keys(PROBE_NAMES) as (keyof ProbeStates)[]).map((id) => (
          <li key={id} data-state={health[id]}>
            {id === 'windows' && health[id] === 'ok' ? `${PROBE_NAMES[id]} — ${screens.open} из ${screens.want}` : `${PROBE_NAMES[id]} — ${PROBE_WORDS[health[id]]}`}
          </li>
        ))}
      </ul>
      {note && <p className="expo-note">{note}</p>}
      <dl>
        <div><dt>Начато</dt><dd>{stats.sessions}</dd></div>
        <div><dt>Завершено</dt><dd>{stats.finished}</dd></div>
        <div><dt>Сбоев</dt><dd>{stats.failures}</dd></div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 4:** тест — PASS.
- [ ] **Step 5:** Коммит `feat(выставка): элементы меню оператора — шаг числа, порядок мониторов, сводка служб`.

### Task 3: Меню оператора — сводка, действия, вкладки

**Files:**
- Modify: `apps/editor/src/expo/OperatorMenu.tsx`, `apps/editor/src/expo/ExpoRoot.tsx`, `apps/editor/src/expo/ExpoSetup.tsx`, `apps/editor/src/expo/scenes.tsx`, `apps/editor/src/expo/expo.css`, `apps/editor/tests/expo-operator.test.tsx`, `scripts/expo-shots.mjs`, `scripts/expo-core-check.mjs`

**Interfaces:**
- Consumes: `Stepper`, `MonitorOrder`, `ServiceSummary` (задача 2); `.expo-primary`, `.expo-danger` (задача 1).
- Produces:
  - `function phaseLabel(state: DirectorState): string` в `scenes.tsx` — та же строка, что показывает `PhaseTitle` (`PhaseTitle` пользуется ею).
  - `OperatorProps`: вместо `status?: string` — `summary?: { phase: string; health: ProbeStates; note: string | null; stats: ExpoStats; screens: { open: number; want: number } }` и `monitors?: () => Promise<MonitorInfo[]>`.
  - Вкладки — `role="tablist"`, кнопки `role="tab"` «Сеанс», «Экраны», «Звук», «Доступ» с `aria-selected`; содержимое — `role="tabpanel"`.

- [ ] **Step 1: Тесты** — в `expo-operator.test.tsx` заменить `authenticated menu changes saved settings and exits via callback`, `monitor order preserves separators until editing finishes`, `number fields allow an incomplete value while typing` на:

```tsx
const enter = (view: ReturnType<typeof render>) => {
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
};

it('authenticated menu changes saved settings and exits via callback', () => {
  let seconds = 0, exited = false;
  const view = render(<OperatorMenu settings={EXPO_DEFAULTS} onSave={async (s) => { seconds = s.timer.seconds; }} onClose={() => {}} onExit={() => { exited = true; }} onAction={() => {}} />);
  enter(view);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: больше' }));
  expect(seconds).toBe(35);
  fireEvent.click(view.getByRole('button', { name: 'Выйти в полный режим' }));
  expect(exited).toBe(true);
});

it('settings are split into tabs', () => {
  const view = render(<OperatorMenu settings={EXPO_DEFAULTS} onSave={async () => {}} onClose={() => {}} onExit={() => {}} onAction={() => {}} />);
  enter(view);
  expect(view.getByRole('tab', { name: 'Сеанс' }).getAttribute('aria-selected')).toBe('true');
  expect(view.queryByText('Новый ПИН (4–8 цифр)')).toBeNull();
  fireEvent.click(view.getByRole('tab', { name: 'Доступ' }));
  expect(view.getByText('Новый ПИН (4–8 цифр)')).toBeTruthy();
  expect(view.queryByRole('group', { name: 'Время выбора, с' })).toBeNull();
});

it('screens tab saves monitor order', async () => {
  let saved = EXPO_DEFAULTS;
  const monitors = async () => [
    { id: 'a', name: 'Левый', x: 0, y: 0, width: 1, height: 1, scale: 1 },
    { id: 'b', name: 'Правый', x: 1, y: 0, width: 1, height: 1, scale: 1 },
  ];
  const view = render(<OperatorMenu settings={EXPO_DEFAULTS} monitors={monitors} onSave={async (s) => { saved = s; }} onClose={() => {}} onExit={() => {}} onAction={() => {}} />);
  enter(view);
  fireEvent.click(view.getByRole('tab', { name: 'Экраны' }));
  fireEvent.click(await view.findByRole('button', { name: 'Правый: выше' }));
  expect(saved.screens.order).toEqual(['b', 'a']);
});

it('summary shows services in words', () => {
  const view = render(
    <OperatorMenu settings={EXPO_DEFAULTS} summary={{ phase: 'Перелом 2 из 3 · Решение · на паузе', health: { core: 'ok', voice: 'fail', model: 'off', windows: 'ok' }, note: null, stats: { sessions: 1, finished: 0, failures: 0 }, screens: { open: 1, want: 1 } }} onSave={async () => {}} onClose={() => {}} onExit={() => {}} onAction={() => {}} />,
  );
  enter(view);
  expect(view.getByText('Голос — нет связи')).toBeTruthy();
  expect(view.getByText('Перелом 2 из 3 · Решение · на паузе')).toBeTruthy();
});
```

  Остальные тесты файла (угол, сочетание, блокировка ПИН) и `expo-root-menu.test.tsx` не меняются.
- [ ] **Step 2:** `npx vitest run apps/editor/tests/expo-operator.test.tsx` — FAIL (нет вкладок, нет «: больше»).
- [ ] **Step 3:** `scenes.tsx` — вынести строку заголовка в `phaseLabel(state)`; `PhaseTitle` возвращает `<span>{phaseLabel(state)}</span>`.
- [ ] **Step 4:** `OperatorMenu.tsx` — переписать разметку после входа (вход по ПИН, `pinAttempt`, `save` через `normalizeSettings`, сброс при закрытии — как были):

```tsx
type Tab = 'session' | 'screens' | 'sound' | 'access';
const TABS: [Tab, string][] = [['session', 'Сеанс'], ['screens', 'Экраны'], ['sound', 'Звук'], ['access', 'Доступ']];
// в компоненте:
const [tab, setTab] = useState<Tab>('session');
const [found, setFound] = useState<MonitorInfo[]>([]);
useEffect(() => { if (open && authorized && tab === 'screens') void monitors?.().then(setFound).catch(() => setFound([])); }, [open, authorized, tab, monitors]);
// разметка после входа:
<>
  {summary && <p className="expo-phase">{summary.phase}</p>}
  {summary && <ServiceSummary health={summary.health} note={summary.note} stats={summary.stats} screens={summary.screens} />}
  <div className="expo-operator-actions">
    {setup ? (
      <button className="expo-primary" onClick={onExit}>Включить выставочный режим</button>
    ) : (
      <>
        <button className="expo-primary" onClick={() => onAction({ t: 'restart' })}>Начать заново</button>
        <label>Перейти к фазе<select …как было…/></label>
        <button onClick={() => onAction('identify')}>Показать номера экранов</button>
        <button onClick={() => onAction('reboot')}>Перезапустить стенд</button>
        <button className="expo-danger" onClick={onExit}>Выйти в полный режим</button>
      </>
    )}
  </div>
  <div role="tablist" className="expo-tabs">
    {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>)}
  </div>
  <div role="tabpanel" className="expo-settings">
    {tab === 'session' && <>
      {/* Режим ИИ, Ввод — select как были; флажок «Голосовой ввод» */}
      <fieldset><legend>Фронты</legend>{/* два флажка FRONT_NAMES как были, рядом */}</fieldset>
      <fieldset><legend>Таймер выбора</legend>
        {flag('Таймер выбора', settings.timer.on, (v) => save({ timer: { ...settings.timer, on: v } }))}
        <Stepper label="Время выбора, с" value={settings.timer.seconds} min={10} max={120} step={5} onValue={(v) => save({ timer: { ...settings.timer, seconds: v } })} />
      </fieldset>
      <Stepper label="Бездействие, с" value={settings.idleSeconds} min={30} max={600} step={10} onValue={(v) => save({ idleSeconds: v })} />
      <Stepper label="Возврат после итога, с" value={settings.resultSeconds} min={5} max={120} step={5} onValue={(v) => save({ resultSeconds: v })} />
    </>}
    {tab === 'screens' && <>
      <Stepper label="Число экранов" value={settings.screens.count} min={1} max={3} step={1} onValue={(v) => save({ screens: { ...settings.screens, count: v as 1 | 2 | 3 } })} />
      <MonitorOrder monitors={found} order={settings.screens.order} onOrder={(order) => save({ screens: { ...settings.screens, order } })} />
    </>}
    {tab === 'sound' && <>{/* флажок «Фоновый звук», два range громкости — как были */}</>}
    {tab === 'access' && <>{/* «Новый ПИН (4–8 цифр)» — как был; флажок «Запускать сразу в выставочном режиме» */}</>}
  </div>
</>
```

  Удалить `NumberSetting`, состояние `order` и поле «Порядок экранов (идентификаторы через запятую)», абзац `<p>{status}</p>`. Вход по ПИН: поле и кнопка в `.expo-pin` по центру.
- [ ] **Step 5:** `ExpoRoot.tsx` — вместо `status` передать:

```tsx
summary={{
  phase: `${phaseLabel(frame.state)}${frame.state.paused ? ' · на паузе' : ''}`,
  health, note, stats,
  screens: { open: frame.count, want: (hostRef.current?.configuration() ?? frame.settings).screens.count },
}}
monitors={() => windowsRef.current?.monitors() ?? Promise.resolve([])}
```

  удалить константу `status`. `ExpoSetup.tsx` — `monitors={() => expoWindows().monitors()}` (импорт из `./windows`).
- [ ] **Step 6:** `expo.css` — стили меню на переменных темы:

```css
.expo-operator { width: min(100%, 1100px); background: var(--expo-panel); border: 1px solid var(--expo-line); color: var(--expo-text); font: 19px var(--expo-sans); }
.expo-phase { margin: 0 0 14px; font: 22px var(--expo-serif); color: var(--expo-muted); }
.expo-summary { display: grid; grid-template-columns: 1fr auto; gap: 8px 32px; padding: 16px 20px; border: 1px solid var(--expo-line); border-radius: 8px; margin-bottom: 18px; }
.expo-summary ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
.expo-summary li::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; background: var(--expo-muted); }
.expo-summary li[data-state='ok']::before { background: var(--expo-ok); }
.expo-summary li[data-state='wait']::before { background: var(--expo-wait); }
.expo-summary li[data-state='fail']::before { background: var(--expo-fail); }
.expo-summary dl { display: flex; gap: 24px; margin: 0; }
.expo-summary dd { margin: 0; font: 34px var(--expo-mono); color: var(--expo-gold); }
.expo-summary dt { font-size: 15px; color: var(--expo-muted); }
.expo-note { grid-column: 1 / -1; margin: 4px 0 0; color: var(--expo-wait); }
.expo-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--expo-line); margin: 22px 0 16px; }
.expo-operator .expo-tabs button { min-height: 48px; background: transparent; border: 0; border-bottom: 3px solid transparent; }
.expo-operator .expo-tabs button[aria-selected='true'] { border-bottom-color: var(--expo-gold); color: var(--expo-gold); }
.expo-stepper > div { display: flex; align-items: center; gap: 10px; }
.expo-stepper output { min-width: 64px; text-align: center; font: 26px var(--expo-mono); }
.expo-operator .expo-stepper button { width: 48px; min-height: 48px; padding: 0; font-size: 26px; }
.expo-operator fieldset { border: 1px solid var(--expo-line); border-radius: 6px; padding: 10px 14px; display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.expo-monitors { margin: 0; padding-left: 24px; display: grid; gap: 8px; }
.expo-monitors li { display: flex; gap: 10px; align-items: center; }
.expo-monitors li span { flex: 1; }
.expo-pin { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 40px 0; }
.expo-pin input { font: 34px var(--expo-mono); text-align: center; letter-spacing: 8px; width: 260px; }
```

  удалить прежние разрозненные правила `.expo-settings`, `.expo-operator form`, повтор `.expo-operator input/select`.
- [ ] **Step 7:** Скрипты: в `expo-shots.mjs` и `expo-core-check.mjs` строку `await page.getByLabel('Время выбора, с').fill('45');` заменить на:

```js
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Время выбора, с: больше' }).click();
```

- [ ] **Step 8:** `npx vitest run apps/editor/tests/expo-` — PASS; typecheck.
- [ ] **Step 9:** Коммит `feat(выставка): меню оператора — сводка служб, крупные действия, вкладки настроек`.

### Task 4: Живая проверка, снимки, описание

**Files:**
- Modify: `docs/img/expo-*.jpg`, `docs/system.md` (раздел 2.1), `docs/system.pdf`, `docs/system.docx`

- [ ] **Step 1:** `npm run dev -w @def-ops/editor -- --port 5180 --strictPort` в фоне; `EXPO_URL=http://localhost:5180 node scripts/expo-shots.mjs` — `{"ok":true,"errors":[]}`; `CARGO_TARGET_DIR=$PWD/target cargo build --release -p agents-core --bin agents-game` и `EXPO_URL=http://localhost:5180 node scripts/expo-core-check.mjs` — `ok: true`.
- [ ] **Step 2:** Посмотреть снимки `expo-attract`, `expo-welcome`, `expo-turn`, `expo-operator`, `expo-result`, `expo-startup`; поправить подписи в `docs/system.md` так, чтобы описывали видимое (меню: сводка служб цветными отметками, статистика дня, действия, вкладки «Сеанс · Экраны · Звук · Доступ»); в тексте 2.1 — порядок экранов списком мониторов кнопками «выше»/«ниже», шаги чисел кнопками «−»/«+».
- [ ] **Step 3:** `CHROMIUM_PATH=… npm run docs:system`; `npm run typecheck`, `npm test`.
- [ ] **Step 4:** Ручная проверка в настольном приложении (`npm run desktop:app` из рабочей копии на ветке `claude/expo`): меню открывается ⌃⌥⇧O, вкладки, «−»/«+», порядок мониторов, сводка. Результат — в отчёт.
- [ ] **Step 5:** Коммит `docs(выставка): меню оператора и тема стенда — снимки и описание`.
