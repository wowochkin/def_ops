# Интро сеанса выставочного режима

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** После касания заставки, до выбора фронта, проиграть трёхмерную визитную карточку с заранее записанной речью; оператор может выключить её со следующего сеанса.

**Architecture:** Режиссёр получает фазу `intro` между `attract` и `welcome`. Речь — четыре фразы без подстановок в `berlin-1945.lines.json`, клипы как у остальных заготовок. Картина — Three.js в `IntroView`: центр снимает рельеф театра, левый экран крутит решётку факторов, правый — рой. Компонент живёт только в этой фазе.

**Tech Stack:** TypeScript, Vitest, React, Three.js (`three`), существующие `director`, `settings`, `voice-queue`, `heightGrid` театра.

**Спека:** `docs/superpowers/specs/2026-11-07-expo-intro-design.md`

## Global Constraints

- Интро не заменяет заставку и не меняет выбор фронта, карточки и расчёт хода.
- Касание картины интро не пропускает. Пропуск — только кнопка «Пропустить» на центральном экране.
- Речь заставки глушится в момент входа в интро.
- Живой синтез для этих четырёх фраз не используется.
- Почта на экране ровно `info@profdailog.ru`. В речь не входит.
- Нет клипов — сцена всё равно кончается сама через `INTRO_FALLBACK_MS` = 48_000.
- Выключатель в сохранённых настройках отсутствует — интро включено.
- Смена выключателя не обрывает уже идущее интро.
- Рельеф центра — `Theatre.heightGrid`, не отдельная модель гор.
- Язык интерфейса и сообщений коммитов — русский.

---

### Task 1: Выключатель в настройках

**Files:**
- Modify: `apps/editor/src/expo/settings.ts`
- Test: `apps/editor/tests/expo-settings.test.ts`

**Interfaces:**
- Produces: `ExpoSettings.intro: boolean`, `EXPO_DEFAULTS.intro === true`

- [ ] **Step 1: Write the failing test**

В тесте значений по умолчанию ожидать `intro: true`. Во втором тесте: объект версии 1 без поля `intro` после `normalizeSettings` даёт `intro: true` и не пишет проблему про отсутствие поля (как `attractCall`, которого нет в старом файле).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/editor/tests/expo-settings.test.ts`
Expected: FAIL, `intro` нет в типе или в объекте.

- [ ] **Step 3: Write minimal implementation**

Добавить `intro: boolean` в `ExpoSettings` и `EXPO_DEFAULTS` (`true`). В `normalizeSettings`, если `r.intro === undefined`, брать `d.intro` без записи в `problems`. Иначе `pick('intro', r.intro, isBool, d.intro)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/editor/tests/expo-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/editor/src/expo/settings.ts apps/editor/tests/expo-settings.test.ts
git commit -m "Выставочный режим: настройка интро сеанса, по умолчанию включено."
```

### Task 2: Фаза режиссёра

**Files:**
- Modify: `apps/editor/src/expo/director.ts`
- Test: `apps/editor/tests/expo-director.test.ts`

**Interfaces:**
- Consumes: `cfg.intro`
- Produces: фаза `{ kind: 'intro' }`; события `{ t: 'introDone' }` и `{ t: 'skipIntro' }`; константа `INTRO_FALLBACK_MS = 48_000`

- [ ] **Step 1: Write the failing test**

Три случая в `expo-director.test.ts`:

1. `intro: true` (по умолчанию). С заставки `touch` даёт фазу `intro`, не `welcome`. Эффект входа содержит `say` с ключом `intro-1`.
2. `intro: false`. С заставки `touch` по-прежнему даёт `welcome`.
3. Из `intro` события `introDone` и `skipIntro` оба дают `welcome`. Повторный `touch` в фазе `intro` фазу не меняет.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/editor/tests/expo-director.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

В union `Phase` добавить `{ kind: 'intro' }`. В `step` для `touch` на `attract`: если `cfg.intro`, входить в `{ kind: 'intro' }`, иначе как сейчас в `welcome`. `touch` на `result` по-прежнему в `welcome` (интро только со заставки). `introDone` и `skipIntro` из `intro` входят в `welcome`. Добавить оба события в тип `DirectorEvent` и в `isInput`, чтобы простой не считался. `SAY_ON_ENTER` для `intro` не ставить одним ключом: при входе в фазу положить в эффекты четыре `say` подряд — `intro-1` … `intro-4`, приоритет `scene`, сцена `intro`. Запасной срок: в `advance` для фазы `intro` кандидат на `phaseStart + INTRO_FALLBACK_MS`, который шлёт переход в `welcome`, только если фаза всё ещё `intro`. Голосовое завершение придёт раньше и снимет фазу, кандидат тогда не сработает.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/editor/tests/expo-director.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/editor/src/expo/director.ts apps/editor/tests/expo-director.test.ts
git commit -m "Выставочный режим: фаза интро между заставкой и выбором фронта."
```

### Task 3: Четыре фразы

**Files:**
- Modify: `apps/editor/src/expo/bank-data/berlin-1945.lines.json`

**Interfaces:**
- Produces: ключи `say.intro-1` … `say.intro-4`, без фигурных скобок

- [ ] **Step 1: Add the lines**

```json
"intro-1": ["Система опирается на большие объёмы исторических данных, математическое и агентное моделирование и искусственный интеллект."],
"intro-2": ["В бой заложено много факторов, среди них пространственные. Искусственный интеллект разбирает их вместе."],
"intro-3": ["Искусственный интеллект помогает принять взвешенное решение по всестороннему разбору обстановки и проигрывает много вариантов, чтобы командующий выбрал итог."],
"intro-4": ["Модель настроена на Берлинскую операцию по открытым данным и может масштабироваться, в том числе на современные условия и на данные, которые поступают сразу."]
```

Почты в строках нет.

- [ ] **Step 2: Commit**

```bash
git add apps/editor/src/expo/bank-data/berlin-1945.lines.json
git commit -m "Выставочный режим: четыре фразы интро без подстановок."
```

Клипы появятся у оператора командой `npm run expo:prepare`. В этом плане их не генерировать.

### Task 4: Голос

**Files:**
- Modify: `apps/editor/src/expo/stage.ts`

**Interfaces:**
- Consumes: эффекты `say` ключей `intro-1`…`intro-4`, сцена `intro`
- Produces: при входе в сцену `intro` очередь заставки очищена до первого клипа интро

- [ ] **Step 1: Hush the attract**

В `handle`, если пришло `say` или `scene` со сценой `intro`, вызвать уже существующий обрыв круга заставки (`stopAttract`: `queue.clear()` и `voice.silence()`), затем отдать эффект бегуну как обычно. Четыре фразы встают в очередь сцена за сценой и доигрывают сами. Отдельной логики «клипа нет» в голосе не добавлять: запасной срок уже в режиссёре.

- [ ] **Step 2: Commit**

```bash
git add apps/editor/src/expo/stage.ts
git commit -m "Выставочный режим: речь заставки обрывается перед интро."
```

### Task 5: Три картины

**Files:**
- Create: `apps/editor/src/expo/intro-view.tsx`
- Create: `apps/editor/src/expo/intro.css`
- Modify: `apps/editor/package.json` (зависимость `three`)

**Interfaces:**
- Consumes: `Theatre.heightGrid` через уже доступный контекст театра стенда; номер окна `0 | 1 | 2`; номер звучащей фразы `1 | 2 | 3 | 4`
- Produces: `IntroView({ pane: 'factors' | 'film' | 'swarm', line: 1 | 2 | 3 | 4, onSkip?: () => void })`

- [ ] **Step 1: Add three**

`npm install three` и типы `@types/three` в `apps/editor`. Других трёхмерных библиотек не ставить.

- [ ] **Step 2: Implement IntroView**

Один компонент, три ветки `pane`. Общий холст: тёмный фон `#070d0c`, золото `#e2b657`, крем `#f4e7c8`. При размонтировании — `cancelAnimationFrame`, `dispose` геометрий и материала, `forceContextLoss`.

`film`. Плоскость по сетке высот театра (подвыборка, чтобы вершин было не больше 256×256). Камера за `INTRO_FALLBACK_MS` проезжает с восточного края кадра к западному, высота небольшая. Реки — светлые линии поверх рельефа. Дуга из нескольких кривых впереди камеры к 4-й фразе сходится в одну.

`factors`. Девять подписей: местность, реки и дороги, снабжение, инженерные заграждения, погода, усталость войск, потери, время, ступени командования. Они медленно загораются по кругу. Тонкая линия соединяет те, что ярче половины.

`swarm`. Около 400 точек. Каждую кадр часть смещается к случайным соседям, часть — вдоль нескольких путей. К кадру, соответствующему 4-й фразе, пути визуально сходятся. Привязки к смене фразы у движения нет; фраза только подпись.

Внизу каждого панно строка текущей фразы (тексты из Task 3) и `info@profdailog.ru`. Кнопка «Пропустить» рендерится только при переданном `onSkip`.

- [ ] **Step 3: Commit**

```bash
git add apps/editor/package.json package-lock.json apps/editor/src/expo/intro-view.tsx apps/editor/src/expo/intro.css
git commit -m "Выставочный режим: трёхмерное интро, решётка факторов и рой."
```

### Task 6: Вставка в стенд

**Files:**
- Modify: `apps/editor/src/expo/ExpoView.tsx`
- Modify: `apps/editor/src/expo/OperatorMenu.tsx`
- Modify: `docs/system.md` (короткий абзац в разделе выставочного хода, без даты и без упоминания помощника)

**Interfaces:**
- Consumes: `IntroView`, фаза `intro`, `settings.intro`
- Produces: на фазе `intro` шапка и подвал стенда скрыты; окно 0 — `factors`, окно 1 и режим «все вместе» — `film` с `onSkip`, окно 2 — `swarm`

- [ ] **Step 1: Render**

Если `state.phase.kind === 'intro'`, вместо обычной сцены рендерить `IntroView`. Номер фразы брать из последней строки очереди сцены `intro` (1, если речи ещё нет). `onSkip` на центральном панно шлёт `{ t: 'skipIntro' }`.

- [ ] **Step 2: Operator checkbox**

Рядом с голосом заставки: «Интро сеанса». Подпись: «После заставки, не вместо неё». `save({ intro: v })`.

- [ ] **Step 3: Describe**

В `docs/system.md` в описании хода стенда одна фраза: касание заставки открывает интро, его можно выключить в меню оператора, тогда касание сразу ведёт к выбору фронта.

- [ ] **Step 4: Commit**

```bash
git add apps/editor/src/expo/ExpoView.tsx apps/editor/src/expo/OperatorMenu.tsx docs/system.md
git commit -m "Выставочный режим: интро на трёх экранах и выключатель у оператора."
```

## Self-review

- Спека 1 (ход, глушение, запасной срок, выключатель не обрывает текущий сеанс) — задачи 2 и 4.
- Спека 2 (четыре фразы, факторы не в голосе, почта не в голосе) — задача 3.
- Спека 3 (рельеф театра, дуга, почта, пропуск только в центре) — задачи 5 и 6.
- Спека 4 (решётка, рой, строка фразы на боковых) — задача 5.
- Спека 5 (меню, умолчание, старый файл) — задача 1.
- Спека 6 (заставка и выбор фронта не меняются) — задача 2: `result` и единственный фронт не затронуты.
