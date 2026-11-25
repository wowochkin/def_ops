# Большие области OpenFreeMap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разрешить загрузку областей OpenFreeMap больше 3 000 тайлов и 50 МБ без потери потоковой записи и возобновления.

**Architecture:** Сохранить последовательную загрузку по одному тайлу и запись в MBTiles. Убрать только искусственные ограничения области, оставив дисковый лимит и проверки источника.

**Tech Stack:** TypeScript, Node.js worker_threads, better-sqlite3, Vitest.

## Global Constraints

- Не добавлять параллельные запросы и загрузку планеты.
- Не менять формат MBTiles, каталог и UI.
- Сохранить `ATLAS_MAX_DOWNLOAD_GB`, проверку диска и HTTP.
- Сохранить кэш и продолжение после остановки.

---

### Task 1: Допустить большую область с кэшем и корректным прогрессом

**Files:**
- Create: `services/cartography/tests/atlas-openfreemap-large.test.ts`
- Modify: `services/cartography/src/atlas-worker.ts:73-97`

**Interfaces:**
- Consumes: существующие `workerData.input.kind === 'openfreemap'`, `tileRange`, `AtlasStore.importFile`.
- Produces: завершение `{state: 'done', result: AtlasMeta}` для области с `done/total > 3000` и размером кэша больше 50 МБ.

- [ ] **Step 1: Написать failing-тест большого кэша**

Тест создаёт `source-tiles.mbtiles` со всеми адресами z6 кроме одного. Каждый из 4 095 тайлов содержит 16 КБ, поэтому кэш превышает 50 МБ. `source_tilejson` позволяет не запрашивать описание источника повторно. `http.fetch` вызывается только для последнего тайла.

```ts
expect(count).toBe(4096);
expect(bytes).toBeGreaterThan(50 * 1024 * 1024);
expect(messages.at(-1)).toMatchObject({ state: 'done' });
expect(fetchMock).toHaveBeenCalledTimes(1);
expect(progress).toEqual({ stage: 'Тайлы OpenFreeMap', done: 4096, total: 4096 });
```

- [ ] **Step 2: Запустить тест до изменения**

Run: `npx vitest run services/cartography/tests/atlas-openfreemap-large.test.ts`
Expected: FAIL — последнее сообщение имеет `state: 'error'` и текст `Достигнут предел OpenFreeMap 50 МБ`.

- [ ] **Step 3: Удалить только искусственные ограничения**

Удалить строку `if(total>3000)throw Error(...)` и проверку `bytes>50*1024*1024`, оставив накопление `bytes` только для диагностики. Не менять последовательный цикл, `cached`, `put`, `request`, `ATLAS_MAX_DOWNLOAD_GB` и `fs.statfs`.

- [ ] **Step 4: Запустить проверку**

Run: `npx vitest run services/cartography/tests/atlas-openfreemap-large.test.ts services/cartography/tests/atlas.test.ts`
Expected: PASS — область завершается, последний тайл запрошен один раз, прогресс равен 4 096/4 096.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/cartography/src/atlas-worker.ts services/cartography/tests/atlas-openfreemap-large.test.ts
git commit -m "Разрешить большие области OpenFreeMap"
```

### Task 2: Обновить описание и пройти полную проверку

**Files:**
- Modify: `docs/system.md`
- Modify: `docs/superpowers/specs/2026-11-25-openfreemap-large-regions-design.md` только при расхождении с реализацией

**Interfaces:**
- Consumes: результат Task 1.
- Produces: описание потоковой загрузки больших областей и актуальные PDF/DOCX.

- [ ] **Step 1: Уточнить текст**

Записать, что ограничение применяется к отдельному ответу и дисковому пространству, а не к размеру всей карты. Указать последовательную запись и возобновление кэша.

- [ ] **Step 2: Обновить производные**

Run: `npm run kb:seed && npm run model:index && npm run docs:system`
Expected: обновлены `packages/knowledge/data/seed.json`, `model-index.json`, `docs/system.pdf`, `docs/system.docx`.

- [ ] **Step 3: Выполнить проверки**

Run: `npm run typecheck && TEST_DATABASE_URL=postgres://vladimirabramov@127.0.0.1:5432/postgres npm test && npm run build`
Expected: все активные тесты проходят, сборка успешна.

- [ ] **Step 4: Зафиксировать**

```bash
git add docs/system.md docs/system.pdf docs/system.docx packages/knowledge/data/seed.json packages/knowledge/data/model-index.json
git commit -m "Описать загрузку больших областей OpenFreeMap"
```
