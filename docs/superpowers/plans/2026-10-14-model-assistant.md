# Ассистент модели — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вкладка «Ассистент» в «Моделировании» отвечает на технические вопросы о модели по выжимке из части II описания, нормативов и кода, со ссылками на источники.

**Architecture:** инструмент сборки режет описание, нормативы и код на фрагменты в `model-index.json`; чистые функции в `packages/knowledge` ищут фрагменты в два хода и собирают запрос; редактор показывает разговор и источники, отвечает модель роли «база знаний».

**Tech Stack:** TypeScript, tsx, vitest, React; существующие `Index` (`packages/knowledge/src/search.ts`), `LlmClient`, `kbLlm`.

**Spec:** `docs/superpowers/specs/2026-10-14-model-assistant-design.md`

## Global Constraints

- Язык интерфейса, описания, коммитов — русский; в описании нет дат и упоминаний ассистента-разработчика и веток.
- Фрагменты: описание ~2500 знаков максимум, тело функции до 80 строк; поиск — до 6 фрагментов описания и нормативов и до 6 кода, всего не больше 24 000 знаков; дозапрос один, до 4 фрагментов; разговор в запросе — 3 последние пары; в `localStorage` — 20 пар.
- Отвечает модель роли «база знаний» (`kbLlm`).
- Перед коммитом: `npm run typecheck` и `npm test`.

## Review Focus

1. Функция Rust внутри `impl` с вложенными замыканиями и строками, содержащими `{`/`}` — тело вырезается целиком и правильно (баланс скобок без учёта строк и комментариев). Тест — задача 1.
2. Раздел описания с таблицей длиннее 2500 знаков — таблица не разрезается посередине. Тест — задача 1.
3. Дозапрос с именем, которого нет в выжимке — ответ всё равно приходит (без добавленных фрагментов), без зацикливания. Тест — задача 2.
4. Сервер моделей недоступен — найденные фрагменты показаны, сообщение об ошибке понятное. Тест — задача 2.
5. Разговор в `localStorage` повреждён или недоступен — вкладка открывается с пустым разговором. Тест — задача 3.

---

### Task 1: Выжимка

**Files:**
- Create: `packages/knowledge/src/model-index.ts` (нарезка, чистые функции), `packages/knowledge/tools/build_model_index.ts`, `packages/knowledge/data/model-index.json`
- Modify: `package.json` (скрипт `"model:index": "tsx packages/knowledge/tools/build_model_index.ts"`), `packages/knowledge/src/index.ts`
- Test: `packages/knowledge/tests/model-index.test.ts`

**Interfaces — Produces:**
- `ModelFragment` — как в разделе 1 проекта.
- `docFragments(md: string): ModelFragment[]` — часть II (с заголовка «# Часть II»), подразделы `##`/`###`/`####` с путём заголовков, длинные — по абзацам до 2500 знаков, таблицы целиком, строки `![…](…)` и подпись курсивом сразу под ними — пропуск; `refs` — имена в обратных кавычках вида `name.ts`, `name.rs`, `camelCase`/`snake_case`.
- `normFragments(norms: unknown): ModelFragment[]`.
- `tsFragments(path: string, src: string): ModelFragment[]`, `rsFragments(path: string, src: string): ModelFragment[]` — функции/константы/структуры с комментарием над ними; тело — по балансу скобок без учёта строк, символов и комментариев; длиннее 80 строк — обрезка «… строки N–M»; `#[cfg(test)]`-модули пропускаются.
- `buildModelIndex(root: string): ModelFragment[]` (инструмент пишет JSON, отсортированный по id).

- [ ] **Step 1:** тесты: подраздел с путём заголовков; длинный раздел → несколько фрагментов с заголовком; таблица длиннее порога — целиком (Review Focus 2); изображение с подписью — пропущено; `refs` из обратных кавычек; норматив с источником и допущение; TS-функция с JSDoc; Rust `fn` в `impl` с замыканием и строкой `"{"` — тело целиком (Review Focus 1); тело 120 строк — обрезка с номерами; `#[cfg(test)] mod tests` — пропущен; свежесть: `buildModelIndex(repo)` равен файлу.
- [ ] **Step 2:** FAIL → реализация → `npm run model:index` → PASS; `npm run typecheck && npm test`.
- [ ] **Step 3:** коммит «Ассистент модели: выжимка описания, нормативов и кода».

### Task 2: Поиск, запрос, дозапрос

**Files:**
- Create: `packages/knowledge/src/model-assistant.ts`, `apps/editor/src/modeling/assistant.ts` (поток)
- Test: `packages/knowledge/tests/model-assistant.test.ts`, `apps/editor/tests/model-assistant.test.ts` (записанные ответы)

**Interfaces — Produces:**
- `modelIndex(frags: ModelFragment[]): { index: Index; byId: Map<string, ModelFragment> }` — `Index` над псевдозаписями (`id`, `title`, `summary: text`, `aliases: [имя функции, номер раздела, id норматива]`).
- `findFragments(ix, question: string, o?: { limit?: number }): ModelFragment[]` — два хода, лимиты из Global Constraints.
- `byName(ix, names: string[]): ModelFragment[]` — по точному имени функции, номеру раздела, id норматива; до 4.
- `assistantMessages(question: string, frags: ModelFragment[], history: { q: string; a: string }[]): ChatMessage[]` — правила ответа из раздела 2 проекта, строка дозапроса `НУЖНО: …`.
- `parseNeed(text: string): string[] | null`.
- `askModel(question, llm, history, onStream: (v: { stage: 'search' | 'need' | 'model'; answer: string; thinking: string; need?: string[] }) => void, signal?): Promise<{ text: string; thinking: string; sources: ModelFragment[]; extra: ModelFragment[]; error?: string }>` в `apps/editor/src/modeling/assistant.ts`; выжимка загружается лениво (`import('…/model-index.json')`).

- [ ] **Step 1:** тесты: «как считается бой» → среди найденных раздел описания и функция из его `refs`; объём ≤ 24 000; `parseNeed('НУЖНО: resolveCombat, 22.3')`; `byName` по функции/разделу/нормативу; дозапрос: первый ответ с `НУЖНО`, второй — окончательный; неизвестное имя → окончательный ответ без зацикливания (Review Focus 3); сервер недоступен → `error` и `sources` не пусты (Review Focus 4).
- [ ] **Step 2:** FAIL → реализация → PASS; typecheck, test.
- [ ] **Step 3:** коммит «Ассистент модели: поиск в два хода, запрос и дозапрос».

### Task 3: Вкладка «Ассистент»

**Files:**
- Create: `apps/editor/src/modeling/AssistantTab.tsx`
- Modify: `apps/editor/src/modeling/ModelingView.tsx` (вкладка `['assistant', 'Ассистент', 'вопросы об устройстве модели']`), `apps/editor/src/styles.css`
- Test: `apps/editor/tests/assistant-history.test.ts`

**Interfaces — Produces:** `loadHistory(): Turn[]`, `saveHistory(t: Turn[]): void` (последние 20; ошибки и мусор → `[]`).

- [ ] **Step 1:** тест истории: сохранение 25 → остаётся 20; мусор в ключе → `[]`; `localStorage` бросает → `[]` (Review Focus 5).
- [ ] **Step 2:** вкладка по разделу 3 проекта: разговор, готовые вопросы, поток с ходом («ищу…», «дозапрос: …», «пишет ответ»), кликабельные [n], источники справа (раздел/норматив/код, пометка «дозапрос»), «найдено: …», «Новый разговор», «Стоп»; ошибка сервера — сообщение, источники видны.
- [ ] **Step 3:** typecheck, test; коммит «Ассистент модели: вкладка в «Моделировании»».

### Task 4: Описание, снимок, правило

**Files:** `docs/system.md` (часть I, раздел «Моделирование»), `docs/img/modeling-assistant.jpg`, `docs/system.pdf`, `docs/system.docx`, `CLAUDE.md` (правило 4: после правки кода модели или части II — `npm run model:index`; файл коммитится; тест сверяет).

- [ ] **Step 1:** прогон на подставном сервере моделей с записанными ответами (вопрос о бое с дозапросом) — снимок вкладки с ответом и источниками (Playwright, 1440×900, JPEG, подпись курсивом — ровно то, что видно, с пометкой, что ответ записанный).
- [ ] **Step 2:** описание; `npm run model:index` (часть II не менялась — выжимка та же); `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run docs:system`; typecheck, test.
- [ ] **Step 3:** коммит «Ассистент модели: описание и снимок».
