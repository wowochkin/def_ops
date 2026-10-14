# База знаний ↔ моделирование, часть 2 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** любой вход (текст, скан, таблица, пакет агента, ручная правка) даёт кандидатов-фактов с формальной частью; общие проверки отправляют их в базу, в очередь «На проверку» или отбрасывают; принятое идёт в модель только через сборщик части 1; факты правятся вручную.

**Architecture:** чистое ядро в `packages/knowledge` (кандидат, проверки, сборка кандидатов из ответов модели и таблиц, задание агенту); поток разбора и хранилище в `apps/editor/src/kb` (IndexedDB v7, перенос прежних очередей); интерфейс в «Знаниях», «Материалах» и «Основе модели». Языковая модель — только извлечение, сопоставление столбцов, перекрёстное прочтение и подсказки в очереди.

**Tech Stack:** TypeScript, React, vitest, IndexedDB, pdfjs-dist, mammoth, `read-excel-file` (MIT; новая зависимость редактора, только чтение XLSX в браузере), OpenAI-совместимый сервер моделей (LM Studio / llama.cpp / Ollama) с сообщениями-картинками.

**Spec:** `docs/superpowers/specs/2026-10-14-kb-model-part2-design.md`

## Global Constraints

- Язык интерфейса, описания, сообщений коммитов — русский.
- Каждый коммит, меняющий поведение, обновляет `docs/system.md`; изменения интерфейса — снимки `docs/img/` (Playwright, 1440×900, JPEG, подпись курсивом описывает видимое). Описание, снимки, PDF/Word — в задаче 10 (решение: промежуточные задачи не меняют видимого поведения до задачи 7).
- В описании нет дат и упоминаний ассистента и служебных веток.
- Тексты книг в репозиторий не попадают: тестовые документы — короткие собственные пересказы и вымышленные выписки.
- Перед коммитом: `npm run typecheck` и `npm test`.
- Коммит-трейлер: `Co-Authored-By: <модель исполнителя> <noreply@anthropic.com>` и `Claude-Session: https://claude.ai/code/session_01EusBDCagxPoefzFjPKgVmB`.
- Пороги правдоподобия (дивизия 20 000, корпус 60 000, армия 150 000, фронт / группа армий 1 200 000; потери за сутки ≤ 1/3 численности; пополнение ≤ 1/2 численности) — строки-допущения в `packages/sim/data/rules/norms.json`.
- Правило выбора факта части 1 не меняется, кроме последнего звена: человек > авто > без проверки (сид считается «человек»).
- Названия моделей нигде не зашиты; роли: `kbModel` (разбор, есть), `scanModel`, `crossModel`, выключатель `crossCheck` (по умолчанию `true`).
- Сканы — только моделью со зрением; без неё документ «ждёт распознавания».

## Review Focus

1. Числа с разделителями разрядов и в разных записях («4 910», «4 910» с неразрывным пробелом, «4.910», «4,9 тыс.») — `numbers` должен находить первые три и не находить «4,9 тыс.» как 4910 (сомнение не нужно — это `fail`, и кандидат отбрасывается с понятной причиной). Тест — задача 1.
2. Повторная загрузка того же документа или пакета — ни одного нового факта, всё в счётчике повторов. Тест — задача 6.
3. Таблица в Windows-1251 / с `;` как разделителем / с десятичной запятой — разбирается так же, как UTF-8 с `,`. Тест — задача 3.
4. Скан, где модель вернула расшифровку, но цитата кандидата в ней не найдена (модель «пересказала») — `fail` и отброшено, а не принято. Тест — задача 2.
5. Перенос: база v6 с принятыми положениями и линиями и с выгрузкой `version: 1` → после открытия v7 факты есть, ничего не задвоено при повторном открытии. Тест — задача 6.

---

### Task 1: Кандидат, проверки 1–7, итог, звено «человек > авто»

**Files:**
- Create: `packages/knowledge/src/candidate.ts`, `packages/knowledge/src/checks.ts`
- Modify: `packages/knowledge/src/schema.ts` (Fact: `check?`, `evidence?`, `corrects?`), `packages/knowledge/src/resolve.ts` (последнее звено сортировки), `packages/knowledge/src/index.ts` (экспорт), `packages/sim/data/rules/norms.json` (пять допущений)
- Test: `packages/knowledge/tests/checks.test.ts`, дополнить `packages/knowledge/tests/resolve.test.ts`

**Interfaces:**
- Produces: типы `Origin`, `Evidence`, `Candidate`, `CheckId`, `CheckResult` — ровно как в разделе 1 проекта; `Fact.check?: { by: 'auto' | 'human'; at: string; results: CheckResult[]; docRolledBack?: true }`, `Fact.evidence?: Evidence`, `Fact.corrects?: string`.
- Produces (`checks.ts`):
  - `numbersIn(text: string): number[]` — все числа текста; разряды через пробел, неразрывный пробел, узкий неразрывный пробел, точку (если группа ровно из 3 цифр).
  - `claimNumbers(c: Claim): number[]` — значения claim (personnel, tanks, guns, killed, wounded, missing, total).
  - `interface CheckCtx { text?: string; transcript?: string; rowExists?: boolean; formations: { id: string; name: string; echelon?: string; personnel?: number }[]; entries: Entry[]; theatre?: { locate(name: string): { at: [number, number] } | null }; op?: { start: string; end: string }; strengthOf(subject: string, at: string): number | null; existing: Fact[] }`
  - `runChecks(c: Candidate, ctx: CheckCtx): CheckResult[]` — проверки `quote`, `numbers`, `subject`, `place`, `date`, `plausible`, `duplicate` (без `cross`); заполняет `c.claim.subject` при однозначном сопоставлении (`matchFormation`, затем `matchEntry`).
  - `verdictOf(results: CheckResult[]): Candidate['verdict']` — `fail` → `drop`, `doubt` → `review`, иначе `auto`.
  - `PLAUSIBLE` — пороги из Global Constraints (`{ strength: { division: 20000, corps: 60000, army: 150000, front: 1200000, army_group: 1200000 }, dailyLossShare: 1/3, reinforceShare: 1/2 }`).

- [ ] **Step 1: Тесты `checks.test.ts`**
  - `numbersIn('убито 4 910 и 4 910, ранено 4.910')` → `[4910, 4910, 4910]`; `numbersIn('4,9 тыс.')` не содержит `4910`.
  - кандидат `losses` с `killed: 4910`, цитата «потери убитыми 4 910» → `numbers: ok`; цитата «потери убитыми 4,9 тыс.» → `numbers: fail`, `verdictOf` → `drop`.
  - `quote`: текст содержит цитату с иными пробелами и переносом строки → `ok`; нет → `fail`; скан с «1 2?0» в цитате → `doubt`.
  - `subject`: «8-я гвардейская армия» при сценарии с `su_8gva` → `ok` и `claim.subject === 'su_8gva'`; имя, подходящее к двум записям → `doubt` с `why`, содержащим оба названия.
  - `date`: `1945-04-08` при операции 16.04–2.05 → `ok` (7 суток до начала); `1945-04-01` → `doubt`; `1945-13-01` → `fail`.
  - `plausible`: дивизия 25 000 → `doubt`; потери за сутки 6 000 при численности 15 000 → `doubt`; `parent` дивизии = дивизия → `doubt`.
  - `duplicate`: тот же claim и `source` в `existing` → `fail`; тот же claim, другой источник → `ok`.
- [ ] **Step 2:** `npx vitest run packages/knowledge/tests/checks.test.ts` — FAIL (нет модуля).
- [ ] **Step 3:** реализовать `candidate.ts`, `checks.ts`, поля `Fact`; строки норм в `norms.json` (`kind: "assumption"`, без источника, по образцу соседних допущений).
- [ ] **Step 4: Тест resolve** — два факта одного вида, надёжности и даты: `check.by: 'human'` побеждает `'auto'`, `'auto'` побеждает пользовательский факт без `check`; факт сида равен «человеку». Звено — последнее в сортировке, после сравнения `updated` (как в проекте: «после более свежего документа»).
- [ ] **Step 5:** `npm run typecheck && npm test` — PASS; `npm run sim:norms -- --doc docs/norms-check.md`.
- [ ] **Step 6:** коммит «База знаний: кандидат-факт и проверки».

### Task 2: Извлечение из текста и скана, перекрёстное прочтение

**Files:**
- Modify: `packages/knowledge/src/extract.ts` (схема `claims`, промпт, сборка кандидатов)
- Create: `packages/knowledge/src/cross.ts`, `packages/knowledge/src/scan.ts`
- Test: `packages/knowledge/tests/extract-claims.test.ts`, `packages/knowledge/tests/cross.test.ts`, `packages/knowledge/tests/scan.test.ts`; записанные ответы — `packages/knowledge/tests/fixtures/llm/*.json`

**Interfaces:**
- Consumes: Task 1 (`Candidate`, `runChecks`, `verdictOf`).
- Produces:
  - `EXTRACT_SCHEMA` / `OPERATION_EXTRACT_SCHEMA` с массивом `claims` (поля: `kind` — один из 9 видов; `subject`, `parent`, `place` — названия как в тексте; `between: [string, string]`; `date`, `dateTo` (ISO); `personnel`, `tanks`, `guns`, `killed`, `wounded`, `missing`, `total`; `state` для переправ; `lat`, `lon`, `approxKm`; `quote`). Массивы `positions`, `boundaries` убираются из схемы операции; `infrastructure` остаётся только для дорог и рубежей (переправы — `claims` вида `crossing`).
  - `ExtractedClaim` — тип элемента `claims`.
  - `toCandidates(claims: ExtractedClaim[], doc: Pick<KbDocument, 'id' | 'name' | 'reliability' | 'operation'>, where: { chunk: number } | { page: number; box?: [number, number, number, number] }, origin: 'text' | 'scan'): Candidate[]` — без проверок (их делает поток).
  - `scanMessages(imageDataUrl: string, docName: string, op?: OperationHint): ChatMessage[]` и `SCAN_SCHEMA` (`{ transcript: string; claims: ExtractedClaim[] (с box) }`); в промпте: «дословно, неразборчивые знаки — ?, не исправлять, не пересказывать».
  - `stripes(width: number, height: number): { y: number; h: number }[]` — 1 полоса, если `height / width ≤ 1.6`, иначе 2–4 полосы с перекрытием 10 %.
  - `crossMessages(quote: string): ChatMessage[]`, `CROSS_SCHEMA` (`{ side: 'own' | 'enemy' | 'unknown'; plan: boolean; subject: string; date: string; dateTo?: string; numbers: { value: number; meaning: 'personnel' | 'tanks' | 'guns' | 'killed' | 'wounded' | 'missing' | 'total' | 'other' }[]; note: string }`), `crossCompare(c: Candidate, answer: CrossAnswer, match: (name: string) => string | null): CheckResult` — doubt при `plan`, `side` противоположной стороне соединения, другом соединении после сопоставления, другом смысле числа; `why` — по-русски с `note` модели.
  - `ChatMessage.content` в `services/staff/src/llm/client.ts` расширяется до `string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[]`.

- [ ] **Step 1: Тесты** — по записанным ответам:
  - текст с выпиской о потерях 8 гв. А за 16–19.04 (вымышленная фраза) → кандидат `losses` с `subject` '' и `names.subject: '8 гв. А'`, `evidence.kind: 'quote'`;
  - ответ скана, где цитата кандидата не входит в `transcript` → после `runChecks` с `transcript` — `quote: fail` (Review Focus 4);
  - `stripes(1000, 1400)` → 1 полоса; `stripes(1000, 3000)` → 3 полосы, каждая с перекрытием ≥ 10 % соседней;
  - `crossCompare`: «уничтожено до 1 200 солдат противника» для `su_8gva`, ответ `side: 'enemy'` → doubt; `plan: true` → doubt; совпадение → ok.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3:** реализовать; прежние `toPositionProposals`, `toBoundaryProposals`, `toInfraProposals` для переправ остаются до задачи 6 (их вызывает старый поток), но новые документы их не используют.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** коммит «База знаний: факты всех видов из текста и сканов, перекрёстное прочтение».

### Task 3: Таблицы и JSON

**Files:**
- Create: `packages/knowledge/src/tables.ts`, `docs/facts-template.md`, `apps/editor/public/samples/facts-template.csv`, `apps/editor/public/samples/facts-template.json`
- Modify: `apps/editor/package.json` (`read-excel-file`), `apps/editor/src/kb/text.ts` (чтение CSV/XLSX в строки)
- Test: `packages/knowledge/tests/tables.test.ts`

**Interfaces:**
- Produces:
  - `TEMPLATE_COLUMNS = ['kind','subject','date','date_to','personnel','tanks','guns','killed','wounded','missing','total','parent','place','lat','lon','approx_km','source','pages','reliability','quote','note']`.
  - `parseCsv(text: string): string[][]` — разделитель `,` или `;` (по первой строке), кавычки, десятичная запятая не ломает разбор.
  - `decodeTable(bytes: Uint8Array): string` — UTF-8, иначе Windows-1251 (`TextDecoder('windows-1251')`), если в UTF-8 есть символы замены.
  - `type ColumnMeaning = (typeof TEMPLATE_COLUMNS)[number] | 'skip' | { day: string; field: 'personnel' | 'tanks' | 'guns' | 'killed' | 'wounded' | 'missing' | 'total' }`.
  - `isTemplate(header: string[]): boolean`.
  - `mappingMessages(header: string[], sample: string[][]): ChatMessage[]`, `MAPPING_SCHEMA` (`{ kind: Claim['kind']; columns: ColumnMeaning[] }`).
  - `rowsToCandidates(rows: string[][], mapping: { kind: Claim['kind']; columns: ColumnMeaning[] }, doc: Pick<KbDocument,'id'|'name'|'reliability'|'operation'>): { candidates: Candidate[]; errors: { row: number; why: string }[]; skipped: string[] }` — одна строка → кандидат; «дни в столбцах» → кандидат на каждую непустую ячейку (`date` = день столбца); `evidence.kind: 'row'`.
  - `parseFactsJson(json: unknown, doc: …): { candidates: Candidate[]; errors: { row: number; why: string }[] }` — формат `{ format: 'def-ops-facts', version: 1, source?: { title, ref, reliability }, facts: [строки шаблона как объекты] }`; иной `format` → ошибка «не формат def-ops-facts».

- [ ] **Step 1: Тесты**
  - CSV шаблона (UTF-8, `,`) и тот же в Windows-1251 с `;` и `12,5` в `approx_km` → одинаковые кандидаты (Review Focus 3);
  - «дни в столбцах»: заголовок `Соединение;16.04.1945;17.04.1945`, сопоставление `[subject, {day:'1945-04-16',field:'total'}, {day:'1945-04-17',field:'total'}]` → 2 кандидата на строку с непустыми ячейками;
  - строка с датой `32.04.1945` → `errors[0].row === 2`, `why` содержит «дата»;
  - JSON с `format: 'other'` → ошибка; корректный → кандидаты с `origin: 'agent'`, если у факта есть `ref`, иначе `'table'`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать; `docs/facts-template.md` — описание столбцов по-русски с примерами (вымышленные значения). **Step 4:** PASS, typecheck. **Step 5:** коммит «База знаний: таблицы и JSON фактов».

### Task 4: Задание для агента

**Files:**
- Create: `packages/knowledge/src/agent-task.ts`
- Test: `packages/knowledge/tests/agent-task.test.ts`

**Interfaces:**
- Consumes: `compileOperation` (часть 1: `provenance` с пометкой допущения), `coverageHints`, `hintsMarkdown`.
- Produces: `agentTask(op: { id: string; title: string; start: string; end: string }, gaps: { formation: string; name: string; kinds: Claim['kind'][] }[], hints: SearchHint[]): string` и `operationGaps(compiled: ReturnType<typeof compileOperation>, names: Map<string, string>): { formation: string; name: string; kinds: Claim['kind'][] }[]` (входы-допущения численности, подчинённости, положений; потерь — если у соединения нет ни одного факта `losses`).
- Разделы md: «Задание», «Зачем», «Что найти» (таблица соединений и видов), «Где искать» (из подсказок), «Общие правила» (по образцу `docs/tsamo-agent-task.md`: только документ с шифром и ссылкой; пересказ до 300 знаков; цитата до 25 слов; WGS84 и `approx_km`; время как в документе; «пустой результат — тоже результат», перечень просмотренного), «Формат ответа» (ссылка на столбцы `TEMPLATE_COLUMNS` и пример JSON `def-ops-facts` из двух вымышленных строк).

- [ ] **Step 1: Тест** — для Берлинской операции из сида: md содержит название операции, строку о 8-й гв. армии с видом «потери», раздел «Формат ответа» и `"format": "def-ops-facts"`; не содержит дат вне операции в разделе «Что найти».
- [ ] **Step 2–4:** FAIL → реализация → PASS. **Step 5:** коммит «База знаний: задание для агента по пробелам операции».

### Task 5: Роли моделей и картинки в запросах

**Files:**
- Modify: `services/staff/src/llm/client.ts` (тело запроса с частями-картинками; `degenerate` не трогать), `apps/editor/src/sim/game-protocol.ts` (`scanModel?`, `scanThinking?`, `crossModel?`, `crossThinking?`, `crossCheck?: boolean`), `apps/editor/src/ModelPicker.tsx` (роли `scan`, `cross`), раздел настроек «Модель и штабы» (найти по заголовку), `apps/editor/src/kb/kb.ts` (`scanLlm`, `crossLlm` по образцу `kbLlm`)
- Create: `apps/editor/src/kb/vision-probe.ts`
- Test: `services/staff/tests/client-image.test.ts`, `apps/editor/tests/vision-probe.test.ts`

**Interfaces:**
- Produces: `scanLlm(llm: LlmSettings): LlmSettings`, `crossLlm(llm: LlmSettings): LlmSettings`; `probeVision(llm: LlmSettings, fetchImpl?: typeof fetch): Promise<{ ok: boolean; why?: string }>` — рисует на OffscreenCanvas число «4817», просит назвать число; ok, если в ответе есть «4817»; ошибка сервера про изображения → `{ ok: false, why: 'эта модель не видит изображений' }`.
- В настройках: выключатель «Перекрёстная проверка» (по умолчанию включён) и подсказка «лучше другая модель, чем для разбора».

- [ ] **Step 1: Тесты** — тело запроса с картинкой содержит `content: [{type:'text'},{type:'image_url',image_url:{url:'data:image/png;base64,…'}}]`; `probeVision` с подменённым fetch: ответ «4817» → ok; ответ 400 «image input not supported» → `ok: false` и текст про изображения.
- [ ] **Step 2–4:** FAIL → реализация → PASS. **Step 5:** коммит «Модели: роли чтения сканов и перекрёстной проверки».

### Task 6: Хранилище v7, приём кандидатов, перенос, откат

**Files:**
- Modify: `apps/editor/src/kb/store.ts` (VER 7; хранилища `candidates`, `pages`, `transcripts`), `apps/editor/src/kb/kb.ts` (API ниже; `exportUser`/`importUser` version 2), `apps/editor/src/modeling/sync.ts` (`acceptPositions`, `acceptBoundaries` больше не пишут правки операции — удалить вызовы записи в `edits.positions`/`edits.boundaries`; оставить разбор для переноса)
- Create: `apps/editor/src/kb/candidates.ts`, `apps/editor/src/kb/migrate.ts`
- Test: `apps/editor/tests/kb-candidates.test.ts`, `apps/editor/tests/kb-migrate.test.ts` (IndexedDB — `fake-indexeddb`, если уже есть в devDependencies; иначе добавить)

**Interfaces:**
- Consumes: Task 1.
- Produces (`candidates.ts`):
  - `acceptCandidate(c: Candidate, by: 'auto' | 'human', ctx: { formations: …; theatre?: … }): Promise<{ entry: string; index: number } | { pending: 'no-entry' }>` — пишет `Fact` (`claim`, `check`, `evidence`, `source`, `pages`, `reliability`, `quote`, `corrects`) в запись соединения (`formationEntries`/`matchEntry`); нет записи, но соединение в сценарии — создаёт `formationEntry`; нет нигде — `pending`.
  - `saveCandidates(list: Candidate[]): Promise<{ auto: number; review: number; drop: number; duplicate: number }>` — `auto` → `acceptCandidate(…,'auto')`; `review` → хранилище `candidates` (`state: 'pending'`); `drop` → хранилище `candidates` с `state: 'rejected'` и причиной (для итогов документа); `duplicate` — только счётчик.
  - `decideCandidates(ids: string[], accept: boolean, edits?: Record<string, Partial<Candidate>>): Promise<void>` — принятие человеком (`check.by: 'human'`) с правками из карточки.
  - `rollbackDocument(docId: string): Promise<{ removed: number; kept: number }>` — удаляет факты `check.by === 'auto'` с `evidence.doc === docId`; у `human` — `check.docRolledBack = true` (в интерфейсе — «документ откачен»).
  - `correctBuiltin(ref: FactRef, next: Claim, meta: { source: string; pages?: string; reliability?: Reliability; note?: string }): Promise<void>` — факт пользователя с `corrects = \`${ref.entry}#${ref.index}|${fingerprint(ref.fact)}\`` и `setPin(pinKey(kind, subject, moment), 'none')` встроенного для моментов, где он выбирался (начало операции и его собственная дата).
  - `staleCorrections(entries: Entry[]): { entry: string; index: number }[]` — исправления, у которых отпечаток встроенного не совпадает.
- `migrate.ts`: `migrateV7(): Promise<{ facts: number; candidates: number }>` — идемпотентно (метка в хранилище `pins` с id `migrated:v7`).
- `kb.ts`: каждое изменение — `kbChanged()` (часть 1), чтобы сборщик пересобрал операцию.

- [ ] **Step 1: Тесты**
  - `saveCandidates` с одним `auto`, одним `review`, одним `drop` → факт в записи, кандидат в очереди, отброшенный с причиной;
  - повторная загрузка того же списка → `duplicate === 3`, новых фактов нет (Review Focus 2);
  - `rollbackDocument` снимает `auto`, оставляет `human` с пометкой;
  - `correctBuiltin` → факт с `corrects`, закрепление `'none'`; после смены значения встроенного в сиде `staleCorrections` возвращает его;
  - перенос: база v6 с принятым положением и линией → факты с `claim` и `check.by: 'human'`; второй запуск — без изменений; `importUser` файла `version: 1` → то же (Review Focus 5).
- [ ] **Step 2–4:** FAIL → реализация → PASS, `npm run typecheck && npm test`.
- [ ] **Step 5:** коммит «База знаний: кандидаты, приём, перенос, откат документа».

### Task 7: Поток разбора

**Files:**
- Create: `apps/editor/src/kb/ingest.ts`
- Modify: `apps/editor/src/kb/kb.ts` (`addFile` принимает все типы; `process` заменяется вызовом `ingest`), `apps/editor/src/kb/text.ts` (страницы PDF → картинки для сканов; признак скана — меньше 50 знаков текста на страницу), `apps/editor/src/KnowledgeView.tsx` и `apps/editor/src/modeling/Materials.tsx` (одна кнопка «Загрузить», `accept` со всеми типами, диапазон страниц, прогресс «часть / страница N из M; авто X, на проверку Y, отброшено Z»)
- Test: `apps/editor/tests/ingest.test.ts` (подменённый `LlmClient` с записанными ответами задачи 2)

**Interfaces:**
- Consumes: задачи 1–6.
- Produces: `ingest(docId: string, llm: LlmSettings, o: { hint?: OperationHint; pages?: [number, number]; mapping?: { kind; columns }; onProgress(p: { done: number; total: number; auto: number; review: number; drop: number; stage: string }): void; signal?: AbortSignal }): Promise<IngestResult>`, где `IngestResult = { auto; review; drop; duplicate; failedParts: number[]; needsMapping?: { header: string[]; sample: string[][]; proposed: { kind; columns } }; waitingVision?: true }`.
- Порядок для каждой части/страницы: извлечение → `toCandidates` → `runChecks` → (если `crossCheck` и итог не `drop`) `crossCompare` → `verdictOf` → `saveCandidates` → `doc.processed` (продолжение с места остановки). При выключенной перекрёстной проверке кандидаты `text`/`scan` с итогом `auto` получают `doubt` «перекрёстная проверка выключена».
- Ошибки: недоступный сервер / таймаут — остановка, `processed` сохранён; `degenerate` — повтор без схемы (как в `services/staff/src/live/decide.ts`), вторая неудача — часть в `failedParts`.
- Таблица не по шаблону без `mapping` → `needsMapping` (с предложением модели), разбор не начинается.

- [ ] **Step 1: Тесты** — текст из двух частей: прогресс дважды, итог совпадает с суммой; остановка после первой части и повторный вызов — вторая часть разбирается, первая нет; выключенная перекрёстная проверка → все кандидаты из текста в очереди; таблица не по шаблону → `needsMapping`; скан при `scanModel`, не видящей картинок → `waitingVision`.
- [ ] **Step 2–4:** FAIL → реализация → PASS.
- [ ] **Step 5:** коммит «База знаний: единый разбор документов, сканов и таблиц».

### Task 8: Очередь «На проверку», итоги документа, сопоставление столбцов

**Files:**
- Create: `apps/editor/src/kb/ReviewQueue.tsx`, `apps/editor/src/kb/DocumentResults.tsx`, `apps/editor/src/kb/ColumnMapping.tsx`
- Modify: `apps/editor/src/KnowledgeView.tsx` (вкладка «На проверку» со счётчиком; итоги у документа; окно сопоставления по `needsMapping`), `apps/editor/src/styles.css`
- Test: `apps/editor/tests/review-queue.test.ts` (чистые функции: группировка причин, фильтры, «принять все, где сомнение только в …»)

**Interfaces:**
- Consumes: `decideCandidates`, `rollbackDocument`, `ingest` (с `mapping`).
- Produces: `doubtKinds(c: Candidate): CheckId[]`; `filterQueue(list: Candidate[], f: { doc?: string; kind?: Claim['kind']; subject?: string; reason?: CheckId }): Candidate[]`; `onlyDoubt(list: Candidate[], reason: CheckId): Candidate[]`.
- Карточка: значения правятся на месте; соединение — выбор из соединений сценария и записей (предложенное первым); доказательство справа: цитата с подсветкой чисел / картинка страницы (из `pages`) с прямоугольником `box` и расшифровкой / строка таблицы; причины сверху; «Принять», «Отклонить», «Почему сомнение», «Предложи исправление» (запрос модели роли разбора: кандидат + доказательство + причины → текст объяснения или правка полей; правка подставляется в карточку, принимает человек).
- Итоги документа: три счётчика, отброшенное с причинами, принятое со ссылками на записи, «Откатить документ» (через `confirmAsync`).

- [ ] **Step 1–4:** тесты чистых функций → реализация → PASS; ручная проверка в dev-сервере на документе из задачи 7.
- [ ] **Step 5:** коммит «База знаний: очередь на проверку, итоги документа, сопоставление столбцов».

### Task 9: Правка фактов, «исправить», «Основа модели», задание агенту

**Files:**
- Create: `apps/editor/src/kb/FactForm.tsx`
- Modify: `apps/editor/src/KnowledgeView.tsx` (`ModelFacts` — значок «авто / человек / встроенный», «изменить», «удалить», «исправить», «+ Факт»; пометка «встроенный факт изменился — пересмотрите» по `staleCorrections`), `apps/editor/src/modeling/BasisTab.tsx` и `apps/editor/src/modeling/basis.ts` (разбивка по проверенности в итоге; в источнике числа — как принят и доказательство; кнопка «Задание для агента» → скачивание md из `agentTask`), «Подсказки, что искать» (та же кнопка)
- Test: `apps/editor/tests/fact-form.test.ts` (сборка claim из полей формы по каждому виду; без источника → факт без `reliability`, предупреждение «допущение»), дополнить `apps/editor/tests/basis.test.ts` (разбивка human/auto/seed)

**Interfaces:**
- Consumes: `correctBuiltin`, `staleCorrections`, `runChecks` (замечания в форме, сохранить можно), `agentTask`, `operationGaps`.
- Produces: `formToClaim(kind: Claim['kind'], fields: Record<string, string>): { claim: Claim } | { error: string }`; `basisSummary` получает в каждой ячейке поля `human`, `auto`, `seed`.

- [ ] **Step 1–4:** тесты → реализация → PASS.
- [ ] **Step 5:** коммит «База знаний: правка фактов, исправление встроенных, задание агенту из «Основы модели»».

### Task 10: Сквозная проверка, описание, снимки

**Files:**
- Modify: `docs/system.md` (часть I — «Знания»: загрузка, очередь, итоги, правка, задание агенту, настройки ролей; часть II — откуда берутся факты модели, проверки и пороги правдоподобия, звено «человек > авто»), `docs/img/*.jpg`, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json` (`npm run kb:seed`), `docs/norms-check.md`
- Create: тестовые материалы вне репозитория (scratchpad): выписка-пересказ потерь (txt), таблица потерь по дням (CSV, вымышленные числа, отмеченные в описании как пример), пакет `def-ops-facts`

- [ ] **Step 1:** на Берлинской операции загрузить три материала; записать: принято автоматически / на проверку / отброшено по каждому; «Основа модели» до и после (доли A/B/C/допущений, разбивка человек/авто/встроенное); сверка численности (`compareStrength`) до и после. Скан — на 1–2 страницах, если на машине есть модель со зрением; иначе на записанном ответе, с пометкой в описании.
- [ ] **Step 2:** снимки: загрузка с ходом разбора; итоги документа с отброшенным; очередь с картинкой страницы (или цитатой, если скана нет — подпись говорит, что видно); окно сопоставления столбцов; редактируемые «Формальные факты» с «исправить»; настройки трёх ролей.
- [ ] **Step 3:** описание по правилам репозитория; цифры — только из шага 1; `npm run kb:seed`; `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system`; `npm run typecheck && npm test`.
- [ ] **Step 4:** коммит «База знаний ↔ моделирование, часть 2: описание, снимки, результаты».
