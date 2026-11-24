# КШВИ: рабочие экраны, карта и региональная погода — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить нефункциональные макеты КШВИ на сохраняемый серверный рабочий контур и исправить общие области, растровые слои и географически обусловленную сценарную погоду.

**Architecture:** Растровая обрезка выносится в отдельный Node-пакет и используется каталогом и снимками КШВИ. Погода сохраняет старый алгоритм для старых редакций и добавляет версионный региональный алгоритм с климатическими нормами. Подготовка хранится в версионной серверной редакции учения; проведение использует только серверную проекцию.

**Tech Stack:** TypeScript, React, MapLibre GL, Node.js, PostgreSQL, SQLite/MBTiles, Sharp, Vitest, Testing Library, Playwright, Python/h5py/NumPy для подготовки климатических норм.

## Global Constraints

- Основание: `docs/superpowers/specs/2026-11-20-kshvi-modern-design.md` и `docs/superpowers/specs/2026-11-24-kshvi-workspace-redesign-design.md`.
- Язык интерфейса, документации и сообщений коммитов — русский.
- Не создавать новые демонстрационные силы, доклады, события, проекции или результаты расчёта в производственном UI.
- Не изменять содержимое и SHA-256 зафиксированных MBTiles, снимков среды, журналов и архивов.
- Не переносить права, активную роль или результат серверной проверки в клиентские параметры как источник полномочий.
- Не запускать полный комплект AC-01–AC-30 на каждой задаче. Повторно проверяются только затронутые существующие AC; полный формальный комплект выполняется один раз на финальном выпуске.
- Во время задачи запускается указанный точечный тест. Перед каждым коммитом по `AGENTS.md` выполняются `npm run typecheck 2>&1 | tail -3` и `TEST_DATABASE_URL=postgres://vladimirabramov@127.0.0.1:5432/postgres npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`.
- Тестовый файл `docs/release/kshvi/evidence/ac16/recovery-drill.json`, обновлённый как побочный эффект общего прогона, не включается в тематические коммиты.
- Изменение поведения требует в том же коммите обновления `docs/system.md`, затронутых JPEG 1440×900, `docs/system.pdf` и `docs/system.docx`. Для кода модели дополнительно выполняются `npm run kb:seed` и `npm run model:index`, если затронуты области, перечисленные в `AGENTS.md`.
- Временные серверы и Vite после браузерных проверок останавливаются. Постоянных фоновых процессов разработки не остаётся.

## Карта файлов

| Назначение | Файлы |
|---|---|
| Общая растровая обрезка | `packages/raster-tiles/`, `services/cartography/src/atlas.ts`, `services/cartography/src/coverage.ts`, `services/kshvi/src/environment/snapshot-tiles.ts` |
| Области и OSM | `apps/editor/src/modern/AtlasView.tsx`, `AtlasCatalog.tsx`, `atlas-region-state.ts`, `services/cartography/src/atlas-routes.ts`, `atlas-region-delete.ts` |
| Региональная погода | `packages/core/src/weather*.ts`, `packages/core/src/climate/regional-v2.json`, `scripts/weather-climate-*.py`, `apps/editor/src/modern/WeatherField.tsx`, `WeatherView.tsx` |
| Подготовка | `packages/kshvi/src/scenario/preparation-draft.ts`, `apps/editor/src/modern/kshvi/preparation/`, `services/kshvi/src/store/exercise-store.ts`, `services/kshvi/src/http/exercise-routes.ts` |
| Локальный вход | `services/kshvi/src/auth/local-login.ts`, `services/kshvi/src/http/auth-routes.ts`, `apps/editor/src/modern/kshvi/KshviView.tsx`, `kshvi-api.ts` |
| Проведение и архив | `apps/editor/src/modern/kshvi/conduct/`, `LibraryView.tsx`, `KshviView.tsx`, `services/kshvi/src/store/exercise-store.ts` |
| Проверки и описание | `apps/editor/tests/`, `services/cartography/tests/`, `services/kshvi/tests/`, `packages/core/tests/`, `scripts/kshvi-workspace-e2e.mjs`, `docs/system.md` |

---

## Пакет A. Растровая целостность и области

### Task 1: Единый серверный модуль растровой обрезки

**Files:**
- Create: `packages/raster-tiles/package.json`
- Create: `packages/raster-tiles/src/index.ts`
- Create: `packages/raster-tiles/src/clip-raster.ts`
- Create: `packages/raster-tiles/tests/clip-raster.test.ts`
- Create: `packages/raster-tiles/src/coverage.ts` — переносятся чистые функции из `services/cartography/src/coverage.ts`
- Modify: `services/cartography/src/coverage.ts`
- Modify: `services/cartography/src/atlas.ts`
- Modify: `services/cartography/package.json`
- Modify: `services/kshvi/package.json`
- Modify: `services/kshvi/src/environment/snapshot-tiles.ts`
- Test: `services/kshvi/tests/environment-snapshot.test.ts`

**Interfaces:**
- Consumes: существующие `tileBBox()`, `inverseMercator()`, `pointInRing()` из `@def-ops/core`; `sharp` для RGBA.
- Produces: `clipRasterTile(input: { bytes: Buffer; format: 'png'|'jpg'|'webp'; bounds: BBox; z: number; x: number; y: number }): Promise<{ bytes: Buffer; format: 'png'|'jpg'|'webp' } | null>`; существующие `maskTile()` и `tileRelation()` сохраняют экспорт через старый путь.

- [ ] **Step 1: Написать failing-тест общей функции и снимка**

```ts
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { clipRasterTile } from '../src';

it('оставляет внутренние пиксели и делает внешние прозрачными на каждом масштабе', async () => {
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  for (let z = 8; z <= 13; z++) {
    const result = await clipRasterTile({ bytes, format: 'png', bounds: [34.727193, 48.299639, 35.42196, 48.633668], z, x: 0, y: 0 });
    expect(result).toBeNull();
  }
});
```

В `environment-snapshot.test.ts` добавить реальный MBTiles с непрозрачным крайним тайлом и проверку `readSnapshotTile()`: пиксель за рамкой имеет `alpha=0`, внутренний — `255`, результат пересечения имеет `format='png'`.

- [ ] **Step 2: Доказать исходный сбой**

Run: `npx vitest run packages/raster-tiles/tests/clip-raster.test.ts services/kshvi/tests/environment-snapshot.test.ts`
Expected: FAIL — пакет отсутствует; текущий `readSnapshotTile()` возвращает непрозрачный внешний пиксель.

- [ ] **Step 3: Реализовать пакет и подключить оба пути**

`packages/raster-tiles/package.json`:

```json
{
  "name": "@def-ops/raster-tiles",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "types": "./src/index.ts",
  "dependencies": { "@def-ops/core": "*", "sharp": "^0.35.5" }
}
```

В `coverage.ts` перенести без изменений `Relation`, `coverageKey()`, `segmentsCross()`, `tileRelation()` и `maskTile()`. В `clip-raster.ts` реализовать единственную функцию обрезки:

```ts
import sharp from 'sharp';
import type { BBox, LngLat } from '@def-ops/core';
import { maskTile, tileRelation } from './coverage';

export async function clipRasterTile(input: {
  bytes: Buffer; format: 'png'|'jpg'|'webp'; bounds: BBox; z: number; x: number; y: number;
}): Promise<{ bytes: Buffer; format: 'png'|'jpg'|'webp' } | null> {
  const boxes: BBox[] = input.bounds[0] <= input.bounds[2]
    ? [input.bounds]
    : [[input.bounds[0], input.bounds[1], 180, input.bounds[3]], [-180, input.bounds[1], input.bounds[2], input.bounds[3]]];
  const rings = boxes.map(([w, s, e, n]): LngLat[] => [[w, s], [e, s], [e, n], [w, n]]);
  const relations = rings.map(ring => tileRelation(ring, input.z, input.x, input.y));
  if (relations.includes('inside')) return { bytes: input.bytes, format: input.format };
  if (!relations.includes('crossing')) return null;
  const decoded = await sharp(input.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = decoded.info.width === decoded.info.height ? decoded.info.width : 256;
  const raw = decoded.info.width === size && decoded.info.height === size
    ? decoded.data
    : await sharp(input.bytes).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const combined = Buffer.alloc(raw.length);
  for (const [index, relation] of relations.entries()) {
    if (relation !== 'crossing') continue;
    const masked = maskTile(Buffer.from(raw), rings[index]!, input.z, input.x, input.y, size);
    for (let offset = 0; offset < masked.length; offset += 4) if (masked[offset + 3]) masked.copy(combined, offset, offset, offset + 4);
  }
  return { bytes: await sharp(combined, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer(), format: 'png' };
}
```

`src/index.ts` экспортирует `clipRasterTile`, `maskTile`, `tileRelation`, `coverageKey`. Старый `services/cartography/src/coverage.ts` реэкспортирует их и оставляет только файловый `maskedTile()`. `AtlasStore.tile()` и `readSnapshotTile()` вызывают `clipRasterTile()` вместо собственных масок/прямого возврата. Добавить `@def-ops/raster-tiles` в зависимости обоих сервисов и обновить lockfile командой `npm install --package-lock-only --ignore-scripts`.

- [ ] **Step 4: Проверить точечно**

Run: `npx vitest run packages/raster-tiles/tests/clip-raster.test.ts services/cartography/tests/atlas.test.ts services/cartography/tests/units.test.ts services/kshvi/tests/environment-snapshot.test.ts`
Expected: PASS; внешний `alpha=0`, внутренний `alpha=255`, векторный PBF не декодируется как изображение.

- [ ] **Step 5: Зафиксировать пакет**

```bash
git add packages/raster-tiles services/cartography/src/atlas.ts services/cartography/src/coverage.ts services/cartography/package.json services/kshvi/src/environment/snapshot-tiles.ts services/kshvi/package.json services/kshvi/tests/environment-snapshot.test.ts package-lock.json
git commit -m "Единая обрезка растровых тайлов каталога и снимков КШВИ"
```

### Task 2: Рамка стиля снимка и мультимасштабная браузерная проверка

**Files:**
- Create: `services/kshvi/src/environment/snapshot-style.ts`
- Create: `services/kshvi/tests/snapshot-style.test.ts`
- Create: `scripts/kshvi-raster-coverage-e2e.mjs`
- Modify: `services/kshvi/src/environment/cartography-provider.ts`
- Modify: `services/kshvi/src/http/environment-routes.ts`
- Modify: `docs/system.md`
- Create: `docs/img/kshvi-raster-coverage.jpg`

**Interfaces:**
- Consumes: сохранённый style JSON и `atlas.meta.bounds` из манифеста.
- Produces: `styleWithBounds(style: unknown, bounds: BBox): StyleSpecification`; HTTP-стиль содержит рамку без перезаписи сохранённого файла.

- [ ] **Step 1: Написать failing-тест неизменяемого восстановления стиля**

```ts
it('добавляет рамку в ответ старого снимка, не меняя сохранённый style artifact', () => {
  const old = { version: 8, sources: { atlas: { type: 'raster-dem', tiles: ['/snapshot/{z}/{x}/{y}'] } }, layers: [] };
  const result = styleWithBounds(old, [34.7, 48.2, 35.4, 48.6]);
  expect(result.sources.atlas).toMatchObject({ bounds: [34.7, 48.2, 35.4, 48.6] });
  expect(old.sources.atlas).not.toHaveProperty('bounds');
});
```

- [ ] **Step 2: Запустить тест до реализации**

Run: `npx vitest run services/kshvi/tests/snapshot-style.test.ts`
Expected: FAIL — `snapshot-style.ts` отсутствует.

- [ ] **Step 3: Добавить преобразование ответа и E2E**

```ts
export function styleWithBounds(style: unknown, bounds: BBox): StyleSpecification {
  if (!style || typeof style !== 'object') throw new Error('Стиль снимка должен быть объектом');
  const copy = structuredClone(style) as StyleSpecification;
  const source = copy.sources.atlas;
  if (!source || !('tiles' in source)) throw new Error('В стиле снимка нет источника atlas');
  source.bounds = bounds;
  return copy;
}
```

`CartographyEnvironmentProvider.snapshotArtifact()` для `kind==='style'` вызывает `styleWithBounds(document, atlas.meta.bounds)` и возвращает объект; экспорт и исходный content artifact не меняются. E2E открывает реальный снимок «Днепр · Рельеф и высоты», последовательно устанавливает zoom 8–13 и overzoom, сравнивает экранные проекции четырёх границ через `map.project()` и сохраняет один итоговый JPEG 1440×900. Тест завершается ошибкой при HTTP 204 для внутреннего контрольного тайла или непрозрачном пикселе снаружи.

- [ ] **Step 4: Проверить и обновить описание**

Run: `npx vitest run services/kshvi/tests/snapshot-style.test.ts services/kshvi/tests/environment-snapshot.test.ts`
Run: `node scripts/kshvi-raster-coverage-e2e.mjs`
Expected: PASS; граница остаётся в одних географических координатах на всех масштабах, файл MBTiles и manifest SHA-256 не изменились. Обновить `docs/system.md` и собрать документы по глобальным правилам.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/kshvi/src/environment services/kshvi/src/http/environment-routes.ts services/kshvi/tests/snapshot-style.test.ts scripts/kshvi-raster-coverage-e2e.mjs docs/system.md docs/system.pdf docs/system.docx docs/img/kshvi-raster-coverage.jpg
git commit -m "Сохранить рамку растрового снимка на всех масштабах"
```

### Task 3: Предсказуемое открытие области и ручная OSM

**Files:**
- Create: `apps/editor/src/modern/atlas-region-state.ts`
- Create: `apps/editor/tests/atlas-region-state.test.ts`
- Create: `apps/editor/tests/atlas-osm.test.tsx`
- Modify: `apps/editor/src/modern/AtlasView.tsx`
- Modify: `apps/editor/src/modern/AtlasCatalog.tsx`

**Interfaces:**
- Consumes: `AtlasMeta[]`, текущий `regionKey`, сохранённый `showOverview`.
- Produces: `openAtlasRegion(state, group): AtlasRegionState`; `resolveOverview({ requested, hasLocalBase })` не зависит от `viewBounds`.

- [ ] **Step 1: Написать failing-тесты**

```ts
it('открытие области включает её локальную основу и выключает OSM', () => {
  const next = openAtlasRegion(previous, kharkivGroup);
  expect(next.regionKey).toBe(kharkivGroup.key);
  expect(next.selected).toEqual([kharkivVector.id]);
  expect(next.showOverview).toBe(false);
});

it('без локальной основы OSM не включается автоматически', () => {
  expect(resolveOverview({ requested: null, hasLocalBase: false })).toBe(false);
});
```

Добавить UI-тест: «Открыть область» меняет рамку и наборы, `coversView()` не вызывается для вычисления флажка, последующий `onViewBounds` не меняет OSM.

- [ ] **Step 2: Доказать сбой**

Run: `npx vitest run apps/editor/tests/atlas-region-state.test.ts apps/editor/tests/atlas-osm.test.tsx`
Expected: FAIL — текущая `applyBounds()` не меняет наборы, а `overview` вычисляется через `coversView()`.

- [ ] **Step 3: Реализовать состояние области**

```ts
export type RegionGroup = Readonly<{ key: string; bounds: BBox; maps: readonly AtlasMeta[] }>;
export type AtlasRegionState = Readonly<{
  regionKey: string;
  selected: readonly string[];
  showOverview: boolean | null;
  byRegion: Readonly<Record<string, { selected: readonly string[] }>>;
}>;

export function resolveOverview(input: { requested: boolean | null; hasLocalBase: boolean }): boolean {
  if (input.requested !== null) return input.requested;
  return false;
}

export function openAtlasRegion(current: AtlasRegionState, group: RegionGroup): AtlasRegionState {
  const saved = current.byRegion[group.key];
  const fallback = group.maps.find(map => map.kind === 'vector' && map.defaultBase) ?? null;
  const selected = saved?.selected ?? (fallback ? [fallback.id] : []);
  return {
    ...current,
    regionKey: group.key,
    selected,
    showOverview: selected.some(id => group.maps.find(map => map.id === id)?.kind === 'vector') ? false : null,
    byRegion: { ...current.byRegion, [group.key]: { selected } },
  };
}
```

Поле `defaultBase?: boolean` добавляется в `AtlasMeta` только как пользовательская настройка области, не как свойство исходного MBTiles. При нескольких векторных наборах без выбранной основы UI показывает список выбора. `AtlasView` удаляет автоматический `showOverview??…coversView`, а `onViewBounds` используется только для предупреждения о покрытии.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/atlas-region-state.test.ts apps/editor/tests/atlas-osm.test.tsx apps/editor/tests/modern-nav-layout.test.ts`
Expected: PASS; при навигации нет автоматического переключения OSM.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/AtlasView.tsx apps/editor/src/modern/AtlasCatalog.tsx apps/editor/src/modern/atlas-region-state.ts apps/editor/tests/atlas-region-state.test.ts apps/editor/tests/atlas-osm.test.tsx services/cartography/src/atlas.ts
git commit -m "Сделать открытие области и обзорную OSM предсказуемыми"
```

### Task 4: Серверное удаление области со всеми наборами

**Files:**
- Create: `services/cartography/src/atlas-region-delete.ts`
- Create: `services/cartography/tests/atlas-region-delete.test.ts`
- Create: `apps/editor/tests/atlas-region-delete.test.tsx`
- Modify: `services/cartography/src/atlas-routes.ts`
- Modify: `apps/editor/src/modern/environment-api.ts`
- Modify: `apps/editor/src/modern/AtlasCatalog.tsx`
- Modify: `apps/editor/src/modern/AtlasView.tsx`

**Interfaces:**
- Consumes: `items: readonly { id: string; sha256: string }[]`, tenant, подтверждение пользователя.
- Produces: `deleteAtlasRegion(store, jobs, tenant, items): Promise<{ deleted: string[]; unchanged: { id: string; reason: string }[] }>`; идемпотентное повторение.

- [ ] **Step 1: Написать failing-тесты безопасности**

```ts
it('не удаляет набор с изменённым SHA-256 и безопасно повторяет операцию', async () => {
  const first = await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: 'wrong' }]);
  expect(first.deleted).toEqual([]);
  expect(first.unchanged[0].reason).toBe('Содержимое изменилось');
  await expect(store.get('tenant', map.id)).resolves.toBeTruthy();
  const second = await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: map.sha256! }]);
  expect(second.deleted).toEqual([map.id]);
  await expect(deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: map.sha256! }])).resolves.toEqual({ deleted: [], unchanged: [] });
});
```

UI-тест проверяет подтверждение с числом наборов, запрет при активной загрузке и обновление списка только после ответа сервера.

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/cartography/tests/atlas-region-delete.test.ts apps/editor/tests/atlas-region-delete.test.tsx`
Expected: FAIL — групповой операции нет.

- [ ] **Step 3: Реализовать операцию и UI**

```ts
export type DeleteAtlasItem = Readonly<{ id: string; sha256: string }>;

export async function deleteAtlasRegion(store: AtlasStore, jobs: AtlasJobs, tenant: string, items: readonly DeleteAtlasItem[]) {
  const deleted: string[] = [], unchanged: { id: string; reason: string }[] = [];
  for (const item of items) {
    const current = await store.get(tenant, item.id).catch(() => null);
    if (!current) continue;
    if (current.sha256 !== item.sha256) { unchanged.push({ id: item.id, reason: 'Содержимое изменилось' }); continue; }
    if (await jobs.hasRunningForMap(tenant, item.id)) { unchanged.push({ id: item.id, reason: 'Идёт подготовка набора' }); continue; }
    await jobs.removeTileCache(tenant, item.id);
    await store.remove(tenant, item.id);
    deleted.push(item.id);
  }
  return { deleted, unchanged };
}
```

Добавить `AtlasJobs.hasRunningForMap()` по `job.result?.id` и заданию, создающему этот результат. Маршрут `POST /cartography/atlas/regions/delete` принимает закрытое тело `{items}`, ограничивает список 256 наборами и использует текущий tenant. UI очищает `selected`, `disabled`, `terrainId` и имя только для подтверждённо удалённых ID; `unchanged` остаётся на экране с причинами и кнопкой повтора.

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/cartography/tests/atlas-region-delete.test.ts services/cartography/tests/atlas.test.ts apps/editor/tests/atlas-region-delete.test.tsx`
Expected: PASS; повтор не создаёт ошибку, чужой tenant не удаляется, снимок КШВИ сохраняет свой MBTiles.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/cartography/src/atlas-region-delete.ts services/cartography/src/atlas-routes.ts services/cartography/src/atlas-jobs.ts services/cartography/tests/atlas-region-delete.test.ts apps/editor/src/modern/AtlasCatalog.tsx apps/editor/src/modern/AtlasView.tsx apps/editor/src/modern/environment-api.ts apps/editor/tests/atlas-region-delete.test.tsx
git commit -m "Добавить безопасное удаление области карты"
```

---

## Пакет B. Региональная сценарная погода

### Task 5: Независимость модели погоды от камеры

**Files:**
- Create: `apps/editor/src/modern/weather-domain.ts`
- Create: `apps/editor/tests/weather-domain.test.ts`
- Modify: `apps/editor/src/modern/WeatherField.tsx`
- Modify: `apps/editor/src/modern/AtlasMap.tsx`
- Modify: `apps/editor/src/modern/weather-layer.ts`

**Interfaces:**
- Consumes: фиксированная `WeatherRegion`, `viewBounds` только как камера.
- Produces: `weatherRenderRegion(region, viewBounds)` возвращает модельную область и пересечение для отображения; растры за пределами региона не создаются.

- [ ] **Step 1: Написать failing-тест неизменной координаты**

```ts
it('не заменяет область модели видимым окном', () => {
  const region = { bounds: [35, 49, 37, 51] as [number, number, number, number], cols: 9, rows: 9 };
  expect(weatherRenderRegion(region, [-180, -85, 180, 85]).modelBounds).toEqual(region.bounds);
  expect(weatherRenderRegion(region, [-180, -85, 180, 85]).renderBounds).toEqual(region.bounds);
  expect(weatherRenderRegion(region, [36, 49.5, 36.5, 50]).renderBounds).toEqual([36, 49.5, 36.5, 50]);
});
```

Дополнительно сравнить `simulateWeatherRegion()` для одной точки при разных `viewBounds`: значения совпадают; координаты растров остаются в `region.bounds`.

- [ ] **Step 2: Доказать текущее расширение на весь мир**

Run: `npx vitest run apps/editor/tests/weather-domain.test.ts`
Expected: FAIL — текущий `WeatherField` присваивает `detail.bounds=viewBounds`.

- [ ] **Step 3: Разделить модель и отображение**

```ts
export function weatherRenderRegion(region: WeatherRegion, view: BBox | undefined) {
  if (!view) return { modelBounds: region.bounds, renderBounds: region.bounds };
  const west = Math.max(region.bounds[0], view[0]), south = Math.max(region.bounds[1], view[1]);
  const east = Math.min(region.bounds[2], view[2]), north = Math.min(region.bounds[3], view[3]);
  const intersects = west < east && south < north;
  return { modelBounds: region.bounds, renderBounds: intersects ? [west, south, east, north] as BBox : null };
}
```

`WeatherField` вычисляет модельные ячейки только для `region`, а `viewBounds` использует для ограничения растрового предпросмотра. `weatherRasters()` получает модельные значения и рамку пересечения; выборка выше/ниже сетки выполняется по модельным координатам, без интерполяции вне покрытия. `AtlasMap` не добавляет image source при отсутствии пересечения.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/weather-domain.test.ts packages/core/tests/weather-region.test.ts`
Expected: PASS; при отдалении нет глобального синтетического слоя, при приближении значения не меняются.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/WeatherField.tsx apps/editor/src/modern/AtlasMap.tsx apps/editor/src/modern/weather-layer.ts apps/editor/src/modern/weather-domain.ts apps/editor/tests/weather-domain.test.ts
git commit -m "Отделить область погодной модели от камеры"
```

### Task 6: Проверяемый пакет климатических норм

**Files:**
- Create: `scripts/weather-climate-fetch.sh`
- Create: `scripts/weather-climate-normalize.py`
- Create: `packages/core/src/climate/regional-v2.json`
- Create: `packages/core/src/weather-climate-profile.ts`
- Create: `packages/core/tests/weather-climate-profile.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: месячные NetCDF NOAA; существующая `monthly-air.json` с высотой и температурной нормой.
- Produces: `sampleRegionalClimate(lat: number, lon: number, time: string): RegionalClimateNormal`; значения содержат температуру, давление, компоненты/скорость и направление ветра, облачность, осадки, относительную влажность, температуру поверхности, влажность грунта и высоту.

- [ ] **Step 1: Написать failing-тесты профиля**

```ts
it('проверяет форму, происхождение и единицы каждого климатического поля', () => {
  expect(profile.schemaVersion).toBe(2);
  expect(profile.months).toHaveLength(12);
  for (const field of ['temperature','pressure','windU','windV','cloud','precipitation','specificHumidity','soilTemperature','soilMoisture'] as const) {
    expect(profile.fields[field].values).toHaveLength(12 * profile.lat.length * profile.longitudeCount);
    expect(profile.fields[field].source.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
});

it('возвращает разные нормы для разных климатических координат', () => {
  const cold = sampleRegionalClimate(52, 13, '2024-01-15T00:00:00Z');
  const hot = sampleRegionalClimate(0, 105, '2024-01-15T00:00:00Z');
  expect(cold.temperature).toBeLessThan(hot.temperature);
  expect(cold.precipitation).not.toBe(hot.precipitation);
});
```

- [ ] **Step 2: Доказать отсутствие профиля**

Run: `npx vitest run packages/core/tests/weather-climate-profile.test.ts`
Expected: FAIL — `regional-v2.json` и `sampleRegionalClimate()` отсутствуют.

- [ ] **Step 3: Скачать и нормализовать точные источники**

`scripts/weather-climate-fetch.sh` создаёт каталог из первого аргумента и скачивает файлы с проверкой ошибок:

```bash
#!/bin/sh
set -eu
out="$1"
mkdir -p "$out"
base='https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss'
for file in air.2m.mon.ltm.1991-2020.nc pres.sfc.mon.ltm.1991-2020.nc prate.sfc.mon.ltm.1991-2020.nc shum.2m.mon.ltm.1991-2020.nc uwnd.10m.mon.ltm.1991-2020.nc vwnd.10m.mon.ltm.1991-2020.nc skt.sfc.mon.ltm.1991-2020.nc soilw.0-10cm.mon.ltm.1991-2020.nc; do
  curl --fail --location --retry 3 --output "$out/$file" "$base/$file"
done
curl --fail --location --retry 3 --output "$out/tcdc.eatm.mon.1981-2010.ltm.nc" 'https://psl.noaa.gov/thredds/fileServer/Datasets/ncep.reanalysis/Monthlies/other_gauss/tcdc.eatm.mon.1981-2010.ltm.nc'
```

`weather-climate-normalize.py` использует `h5py` и `numpy`, применяет `scale_factor`, `add_offset`, удаляет `missing_value`/`_FillValue`, приводит сетку к имеющимся `normals.lat` и `longitudeStep=1.875`, вычисляет SHA-256 каждого исходника. Преобразования фиксируются в коде:

```python
def relative_humidity(q, pressure_pa, temperature_k):
    pressure_hpa = pressure_pa / 100.0
    temperature_c = temperature_k - 273.15
    vapour = q * pressure_hpa / (0.622 + 0.378 * q)
    saturation = 6.112 * np.exp(17.67 * temperature_c / (temperature_c + 243.5))
    return np.clip(100.0 * vapour / saturation, 0.0, 100.0)

def wind_speed(u, v):
    return np.hypot(u, v)

def wind_from_direction(u, v):
    return (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0
```

Давление делится на 100 в hPa, `prate` умножается на 3600 в mm/h, температуры переводятся из K в °C, `soilw` сохраняет долю объёмной влажности, `tcdc` сохраняет проценты и свой фактический период 1981–2010. В манифесте каждого поля записываются URL, SHA-256, период, исходная переменная, исходные и целевые единицы. Команда `npm run weather:climate` вызывает оба скрипта и записывает `regional-v2.json`.

- [ ] **Step 4: Проверить артефакт и интерполяцию**

Run: `npm run weather:climate -- .kimi-tmp/weather-climate`
Run: `npx vitest run packages/core/tests/weather-climate-profile.test.ts packages/core/tests/weather.test.ts`
Expected: PASS; все источники имеют HTTP 200, форма массивов согласована, пропуски остаются `null`, антимеридиан и стык месяцев непрерывны.

- [ ] **Step 5: Зафиксировать**

```bash
git add scripts/weather-climate-fetch.sh scripts/weather-climate-normalize.py packages/core/src/climate/regional-v2.json packages/core/src/weather-climate-profile.ts packages/core/tests/weather-climate-profile.test.ts package.json
git commit -m "Добавить версионные региональные климатические нормы"
```

### Task 7: Региональный алгоритм погоды версии 2

**Files:**
- Create: `packages/core/src/weather-regional-episodes.ts`
- Create: `packages/core/src/weather-regional.ts`
- Create: `packages/core/tests/weather-regional.test.ts`
- Modify: `packages/core/src/weather.ts`
- Modify: `packages/core/src/weather-climate-profile.ts`
- Modify: `apps/editor/src/modern/WeatherView.tsx`

**Interfaces:**
- Consumes: `sampleRegionalClimate()` из Task 6, существующие `WeatherScenario`, `WeatherState`, `showerIntensity()`.
- Produces: `regionalAtmosphere(scenario, lat, lon, time, context?): WeatherState` без поверхностной истории; `simulateRegionalWeather(scenario, lat, lon, time, context?): WeatherState` с полным состоянием; `regionalRainAt(scenario, lat, lon, time): RegionalRainSample`; поля `WeatherScenario.algorithmVersion?: 1|2`, `climateProfileId?: string`, `climateProfileSha256?: string`.

- [ ] **Step 1: Написать failing-тесты географии и воспроизводимости**

```ts
it('не назначает один эпизод осадков всему миру и повторяет локальный результат', () => {
  const scenario = regionalScenario();
  const berlin = simulateRegionalWeather(scenario, 52.52, 13.4, '2024-11-15T06:00:00Z');
  const jakarta = simulateRegionalWeather(scenario, -6.2, 106.8, '2024-11-15T06:00:00Z');
  expect(berlin).toEqual(simulateRegionalWeather(scenario, 52.52, 13.4, '2024-11-15T06:00:00Z'));
  expect(berlin.temperature).not.toBe(jakarta.temperature);
  expect(berlin.precipitationType).not.toBe(jakarta.precipitationType);
  expect(berlin.pressure).not.toBe(1013);
  expect(jakarta.pressure).not.toBe(1013);
});

it('не меняет старый сценарий без algorithmVersion=2', () => {
  const legacy = legacyScenario();
  expect(simulateWeather(legacy, 52, 13, legacy.start)).toEqual(legacyReference);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run packages/core/tests/weather-regional.test.ts`
Expected: FAIL — нового алгоритма и полей версии нет.

- [ ] **Step 3: Реализовать локальные эпизоды и диспетчер версий**

`regionalRainAt()` вычисляет независимый ключ из зерна и климатической ячейки, а не из глобального `rainEpisode()`:

```ts
export type RegionalRainEpisode = Readonly<{
  id: string; cellId: string; center: [number, number]; radiusKm: number;
  startHour: number; durationHours: number; intensity: number; driftKmPerHour: number; directionDeg: number;
}>;

export function regionalRainAt(s: WeatherScenario, lat: number, lon: number, time: string): RegionalRainSample {
  const hours = (weatherTime(time) - weatherTime(s.start)) / 3600000;
  const episode = episodeForCell(s, lat, lon);
  const age = hours - episode.startHour;
  const envelope = age <= 0 || age >= episode.durationHours ? 0 : Math.sin(Math.PI * age / episode.durationHours) ** 2;
  const distance = distanceKm([lon, lat], movedCenter(episode, hours));
  const spatial = Math.max(0, 1 - distance / episode.radiusKm);
  return { episode, intensity: episode.intensity * envelope * spatial };
}
```

`episodeForCell()` использует стабильный хеш `seed + cellId`, выбирает начало, длительность, радиус и дрейф в ограничениях версионного профиля. `simulateRegionalWeather()` берёт все базовые поля из `sampleRegionalClimate()`, добавляет существующие воспроизводимые пространственные отклонения только как малые вариации, применяет `regionalRainAt()` и вычисляет тип осадков по местной температуре. `simulateWeather()` и `precipitationFrame()` выбирают версию 2 только при `scenario.algorithmVersion===2`; отсутствие поля означает старый алгоритм. Новый сценарий в `WeatherView.defaults()` получает версию 2 и точные идентификатор/SHA-256 профиля.

- [ ] **Step 4: Проверить**

Run: `npx vitest run packages/core/tests/weather-regional.test.ts packages/core/tests/weather-region.test.ts packages/core/tests/weather.test.ts`
Expected: PASS; старый эталон совпадает побайтно, новый результат воспроизводим и географически различен.

- [ ] **Step 5: Зафиксировать**

```bash
git add packages/core/src/weather.ts packages/core/src/weather-regional.ts packages/core/src/weather-regional-episodes.ts packages/core/src/weather-climate-profile.ts packages/core/tests/weather-regional.test.ts apps/editor/src/modern/WeatherView.tsx
git commit -m "Добавить региональный алгоритм сценарной погоды"
```

### Task 8: Местная история снега, грунта и видимости

**Files:**
- Create: `packages/core/src/weather-regional-surface.ts`
- Create: `packages/core/tests/weather-regional-surface.test.ts`
- Modify: `packages/core/src/weather-regional.ts`
- Modify: `apps/editor/src/modern/scenario-surface.ts`
- Modify: `apps/editor/src/modern/WeatherField.tsx`

**Interfaces:**
- Consumes: `regionalAtmosphere()` без повторного вызова поверхностной истории; климатические `soilTemperature` и `soilMoisture`.
- Produces: `RegionalSurfaceState={ soilMoisture:number; snowDepth:number; soilTemperature:number; visibility:number }`; `regionalSurfaceState(scenario, lat, lon, time, context?): RegionalSurfaceState`; `historyHours=72` и коэффициенты версионного профиля.

- [ ] **Step 1: Написать failing-тест влияния истории**

```ts
it('одинаковый текущий дождь не стирает разную предшествующую историю', () => {
  const wet = scenarioWithPastRain(24);
  const dry = scenarioWithPastRain(0);
  const at = '2024-11-15T06:00:00Z';
  expect(regionalSurfaceState(wet, 52, 13, at).soilMoisture).toBeGreaterThan(regionalSurfaceState(dry, 52, 13, at).soilMoisture);
  expect(regionalSurfaceState(wet, 52, 13, at).snowDepth).toBeGreaterThanOrEqual(regionalSurfaceState(dry, 52, 13, at).snowDepth);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run packages/core/tests/weather-regional-surface.test.ts`
Expected: FAIL — текущая `surfacePreview()` использует только текущий/последний общий дождь.

- [ ] **Step 3: Реализовать ограниченный водный и тепловой баланс**

```ts
export function regionalSurfaceState(s: WeatherScenario, lat: number, lon: number, time: string): RegionalSurfaceState {
  const normal = sampleRegionalClimate(lat, lon, time);
  let moisture = normal.soilMoisture;
  let snow = 0;
  for (let hour = -72; hour <= 0; hour++) {
    const at = new Date(weatherTime(time) + hour * 3600000).toISOString();
    const weather = regionalAtmosphere(s, lat, lon, at);
    const rain = weather.precipitationType === 'rain' ? weather.precipitation ?? 0 : 0;
    const snowfall = weather.precipitationType === 'snow' ? weather.precipitation ?? 0 : 0;
    moisture = clamp(moisture + rain * 0.0008 - Math.max(0, weather.temperature ?? 0) * 0.00002, 0, 1);
    snow = Math.max(0, snow + snowfall * 0.001 - Math.max(0, weather.temperature ?? 0) * 0.0005);
  }
  const current = regionalAtmosphere(s, lat, lon, time);
  const visibility = clamp(26000 - 11000 * (current.humidity ?? normal.humidity) / 100 - 12500 * (current.precipitation ?? 0) / 12, 0, 1000000);
  return { soilMoisture: moisture, snowDepth: snow, soilTemperature: normal.soilTemperature, visibility };
}
```

Коэффициенты вынести в `REGIONAL_SURFACE_PROFILE_V2` с явной пометкой «учебное допущение», единицами и областью применимости. `surfacePreview()` применяется только к алгоритму 1; версия 2 получает поверхностные поля из этой истории. Явно введённые пользователем значения/keyframes остаются приоритетными и журналируются в сценарии.

- [ ] **Step 4: Проверить**

Run: `npx vitest run packages/core/tests/weather-regional-surface.test.ts packages/core/tests/weather-regional.test.ts apps/editor/tests/weather-domain.test.ts`
Expected: PASS; одинаковый зерно/вход даёт тот же результат, разная история меняет грунт/снег, ручные значения не перезаписываются.

- [ ] **Step 5: Зафиксировать**

```bash
git add packages/core/src/weather-regional-surface.ts packages/core/src/weather-regional.ts packages/core/tests/weather-regional-surface.test.ts apps/editor/src/modern/scenario-surface.ts apps/editor/src/modern/WeatherField.tsx
git commit -m "Учесть местную погодную историю поверхности"
```

### Task 9: Контекст высоты и покрова без скрытых допущений

**Files:**
- Create: `services/cartography/src/atlas-landcover.ts`
- Create: `services/cartography/tests/atlas-landcover.test.ts`
- Create: `packages/core/src/weather-regional-context.ts`
- Create: `packages/core/tests/weather-regional-context.test.ts`
- Modify: `services/cartography/src/atlas-routes.ts`
- Modify: `packages/core/src/weather-regional.ts`
- Modify: `packages/core/src/weather-regional-surface.ts`
- Modify: `apps/editor/src/modern/use-map-elevations.ts`
- Modify: `apps/editor/src/modern/WeatherField.tsx`

**Interfaces:**
- Consumes: существующий `atlasElevations()`, WorldCover RGBA и легенда классов.
- Produces: `atlasLandcover(store, tenant, id, points): Promise<{ values: { lon: number; lat: number; classCode: number|null }[] }>`; `RegionalSurfaceContext={ elevationM:number|null; landcoverClass:number|null; sourceIds:string[] }`.

- [ ] **Step 1: Написать failing-тесты пропусков и классов**

```ts
it('возвращает фактический класс покрова и null за покрытием', async () => {
  await expect(atlasLandcover(store, 't', map.id, [[13.4, 52.5]])).resolves.toEqual({ source: map.id, values: [{ lon: 13.4, lat: 52.5, classCode: 10 }] });
  await expect(atlasLandcover(store, 't', map.id, [[14.4, 53.5]])).resolves.toEqual({ source: map.id, values: [{ lon: 14.4, lat: 53.5, classCode: null }] });
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/cartography/tests/atlas-landcover.test.ts packages/core/tests/weather-regional-context.test.ts`
Expected: FAIL — чтения классов и контракта контекста нет.

- [ ] **Step 3: Реализовать чтение и передачу контекста**

Использовать адрес тайла и пиксель по образцу `atlasElevations()`: от максимального к минимальному zoom, TMS-строка `2**z-1-y`, прозрачный пиксель означает `null`. RGB сопоставляется с `landcover_legend` только по точному коду цвета; неизвестный цвет даёт `null`, а не ближайший класс.

```ts
export function regionalContext(input: { elevationM: number | null; landcoverClass: number | null; demId?: string; landcoverId?: string }): RegionalSurfaceContext {
  return {
    elevationM: input.elevationM,
    landcoverClass: input.landcoverClass,
    sourceIds: [input.demId, input.landcoverId].filter((id): id is string => Boolean(id)),
  };
}
```

`WeatherField` передаёт контекст в версию 2. При выбранном, но недоступном DEM/покрове отображается «Недостаточно данных о высоте/покрове»; при невыбранном наборе в паспорт сценария записывается ограниченный режим. Старый алгоритм сохраняет существующий `weatherWithElevation()` без изменения эталонов.

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/cartography/tests/atlas-landcover.test.ts services/cartography/tests/atlas.test.ts packages/core/tests/weather-regional-context.test.ts apps/editor/tests/weather-domain.test.ts`
Expected: PASS; прозрачность, внешняя точка и неизвестный RGB не становятся вымышленным классом.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/cartography/src/atlas-landcover.ts services/cartography/src/atlas-routes.ts services/cartography/tests/atlas-landcover.test.ts packages/core/src/weather-regional.ts packages/core/src/weather-regional-surface.ts packages/core/src/weather-regional-context.ts packages/core/tests/weather-regional-context.test.ts apps/editor/src/modern/use-map-elevations.ts apps/editor/src/modern/WeatherField.tsx
git commit -m "Передавать фактические высоту и покров в погоду"
```

### Task 10: Автоматический локальный вход с обычной серверной сессией

**Files:**
- Create: `services/kshvi/src/auth/local-login.ts`
- Create: `services/kshvi/src/http/local-auth-routes.ts`
- Create: `services/kshvi/tests/local-login.test.ts`
- Create: `apps/editor/tests/kshvi-local-login.test.tsx`
- Modify: `services/kshvi/src/auth/sessions.ts`
- Modify: `services/kshvi/src/app.ts`
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`
- Modify: `apps/editor/src/modern/kshvi/kshvi.css`

**Interfaces:**
- Consumes: `KSHVI_LOCAL_AUTOLOGIN=1`, `KSHVI_LOCAL_USER_ID`, `KSHVI_LOCAL_ROLE_ID`, loopback-запрос.
- Produces: `SessionManager.loginLocal(userId, roleId)` создаёт обычный токен/CSRF/cookie; `KshviClient.loginLocal(): Promise<LoginResult>`; UI показывает локального пользователя и роль без формы.

- [ ] **Step 1: Написать failing-тесты границы режима**

```ts
it('создаёт обычную сессию только для назначенной локальной роли', async () => {
  const result = await sessions.loginLocal('local-leader', 'local-director-role');
  expect(result.participant.userId).toBe('local-leader');
  expect(result.participant.activeRole).toBe('DIRECTOR');
  expect(result.cookie).toContain('HttpOnly');
  await expect(sessions.loginLocal('local-leader', 'foreign-role')).rejects.toThrow('403');
});

it('не включает маршрут в сетевом режиме', async () => {
  await expect(post('/kshvi/auth/local', {}, networkContext)).rejects.toMatchObject({ status: 404 });
});
```

UI-тест: при 401 от `me()` в подтверждённом локальном режиме вызывается `loginLocal()`, форма не появляется; при сетевом 404 форма остаётся обязательной.

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/kshvi/tests/local-login.test.ts apps/editor/tests/kshvi-local-login.test.tsx`
Expected: FAIL — метода и маршрута нет.

- [ ] **Step 3: Реализовать серверный вход и автоматический выбор**

В `SessionManager` вынести общий выпуск токена в приватный `issueSession()`, который вызывают обычный `login()` и новый `loginLocal()`. Локальный метод не принимает authorities из запроса:

```ts
async loginLocal(userId: string, roleId: string) {
  const account = await this.store.findAccountById(userId);
  if (!account || account.state !== 'ACTIVE') unauthorized();
  const issued = await this.issueSession(account);
  const participant = await this.selectRole(issued.token, roleId);
  return { ...issued, participant, roles: account.roles.map(({ id, role, sideId }) => ({ id, role, sideId })) };
}
```

`local-auth-routes.ts` регистрирует `POST /kshvi/auth/local` только при `KSHVI_LOCAL_AUTOLOGIN=1`, проверяет loopback и отсутствие `NODE_ENV=production` с сетевым режимом. `KSHVI_MODE=official` без явной одномашинной конфигурации отклоняет маршрут. Ответ использует существующие cookie и CSRF. `KshviView` сначала вызывает `me()`, после 401 один раз вызывает `loginLocal()`, затем повторно читает серверного участника. При неудаче показывает `LoginPanel`, не анонимный контур. Верхняя метка содержит «Локальный режим · {userId} · {русская роль}».

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/kshvi/tests/local-login.test.ts services/kshvi/tests/auth.test.ts apps/editor/tests/kshvi-local-login.test.tsx apps/editor/tests/kshvi-handover.test.tsx`
Expected: PASS; браузер не может выбрать чужую роль, сеть не получает автоматический вход, handover по-прежнему очищает сессию.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/kshvi/src/auth/local-login.ts services/kshvi/src/auth/sessions.ts services/kshvi/src/http/local-auth-routes.ts services/kshvi/src/app.ts services/kshvi/tests/local-login.test.ts apps/editor/src/modern/kshvi/kshvi-api.ts apps/editor/src/modern/kshvi/KshviView.tsx apps/editor/src/modern/kshvi/kshvi.css apps/editor/tests/kshvi-local-login.test.tsx
git commit -m "Добавить автоматический вход локального пользователя КШВИ"
```

---

## Пакет C. Серверная подготовка и рабочие редакторы

### Task 11: Версионный черновик подготовки

**Files:**
- Create: `packages/kshvi/src/scenario/preparation-draft.ts`
- Create: `packages/kshvi/tests/preparation-draft.test.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/usePreparationDraft.ts`
- Create: `apps/editor/tests/kshvi-preparation-draft.test.tsx`
- Modify: `packages/kshvi/src/index.ts`
- Modify: `packages/kshvi/package.json`
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `services/kshvi/src/store/exercise-store.ts`

**Interfaces:**
- Consumes: существующие `ExerciseRevision.payload`, `createRevision(expectedRevision)`, доменные типы сил, карты, МТО и готовности.
- Produces: `PreparationDraft`, `validatePreparationDraft(value): PreparationDraft`, `KshviClient.savePreparation(exerciseId, input): Promise<ExerciseCard>`; состояние `initialMapStatus: 'DRAFT'|'MAPPED'|'APPROVED'`.

- [ ] **Step 1: Написать failing-тесты схемы и восстановления**

```ts
it('сохраняет черновик подготовки в новой серверной редакции', async () => {
  const saved = await client.savePreparation('exercise-1', { expectedRevision: 3, draft });
  expect(saved.revision).toBe(4);
  expect(saved.revisions.at(-1)?.payload).toMatchObject({ preparation: { schemaVersion: 1, initialMapStatus: 'MAPPED' } });
});

it('не принимает неизвестную версию или неверный статус карты', () => {
  expect(() => validatePreparationDraft({ schemaVersion: 2 })).toThrow('версия');
  expect(() => validatePreparationDraft({ schemaVersion: 1, initialMapStatus: 'READY' })).toThrow('статус');
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run packages/kshvi/tests/preparation-draft.test.ts apps/editor/tests/kshvi-preparation-draft.test.tsx`
Expected: FAIL — отдельного серверного черновика нет.

- [ ] **Step 3: Реализовать схему и сохранение**

```ts
export type ScenarioForce = ForceDetails & Readonly<{ id: string }>;

export type PreparationDraft = Readonly<{
  schemaVersion: 1;
  environmentSnapshotId: string | null;
  initialMap: InitialSituationMap | null;
  initialMapStatus: 'DRAFT'|'MAPPED'|'APPROVED';
  forces: readonly ScenarioForce[];
  equipment: readonly EquipmentHolding[];
  formation: FormationPlan | null;
  logistics: SupplyPlan | null;
  autonomy: AutonomyProfile | null;
  readinessStage: ReadinessStage | null;
  readinessStates: readonly ReadinessState[];
  updatedAt: string;
}>;

export function emptyPreparationDraft(at: string): PreparationDraft {
  return { schemaVersion: 1, environmentSnapshotId: null, initialMap: null, initialMapStatus: 'DRAFT', forces: [], equipment: [], formation: null, logistics: null, autonomy: null, readinessStage: null, readinessStates: [], updatedAt: at };
}
```

`validatePreparationDraft()` проверяет закрытую версию, типы и ссылки на существующие силы/снимок/карту; неизвестные поля отклоняются. `savePreparation()` читает текущую карточку, объединяет `payload.preparation` и вызывает `createRevision()` с исходным `expectedRevision`. `ExerciseStore.createRevision()` вызывает доменный валидатор до записи; после `SEALED` обычное сохранение запрещено существующим правилом. `usePreparationDraft()` восстанавливает состояние из текущей редакции и после ответа сервера заменяет и черновик, и номер редакции.

- [ ] **Step 4: Проверить**

Run: `npx vitest run packages/kshvi/tests/preparation-draft.test.ts apps/editor/tests/kshvi-preparation-draft.test.tsx services/kshvi/tests/exercise-store.test.ts`
Expected: PASS; перезапуск восстанавливает данные, конфликт редакции не перезаписывает чужую работу.

- [ ] **Step 5: Зафиксировать**

```bash
git add packages/kshvi/src/scenario/preparation-draft.ts packages/kshvi/src/index.ts packages/kshvi/package.json packages/kshvi/tests/preparation-draft.test.ts apps/editor/src/modern/kshvi/preparation/usePreparationDraft.ts apps/editor/src/modern/kshvi/kshvi-api.ts apps/editor/tests/kshvi-preparation-draft.test.tsx services/kshvi/src/store/exercise-store.ts
git commit -m "Сохранять подготовку КШВИ в серверной редакции"
```

### Task 12: Общая оболочка подготовки и действия библиотеки

**Files:**
- Create: `apps/editor/src/modern/kshvi/library-actions.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/PreparationStatus.tsx`
- Create: `apps/editor/tests/kshvi-library-actions.test.ts`
- Create: `apps/editor/tests/kshvi-preparation-layout.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/LibraryView.tsx`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/preparation.css`

**Interfaces:**
- Consumes: `ExerciseSummary`, серверная валидация подготовки, активная роль.
- Produces: `libraryPrimaryAction(item): { id: 'PREPARE'|'REVIEW'|'START'|'CONDUCT'|'DEBRIEF'|'ARCHIVE'; label: string }`; общий русский `stateLabel()`.

- [ ] **Step 1: Написать failing-тесты действий и компоновки**

```ts
expect(libraryPrimaryAction({ state: 'DRAFT' } as ExerciseSummary)).toEqual({ id: 'PREPARE', label: 'Продолжить подготовку' });
expect(libraryPrimaryAction({ state: 'SEALED', lastSessionId: null } as ExerciseSummary)).toEqual({ id: 'START', label: 'Запустить учение' });
expect(libraryPrimaryAction({ state: 'ARCHIVED' } as ExerciseSummary)).toEqual({ id: 'ARCHIVE', label: 'Открыть архив' });
```

Layout-тест проверяет пять шагов, отсутствие текста «Требуется SEALED», связанные кнопки «Назад/Далее» и `getBoundingClientRect()` без пересечения панели действий с последним полем.

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-library-actions.test.ts apps/editor/tests/kshvi-preparation-layout.test.tsx`
Expected: FAIL — текущий основной переход называется «Рабочий цикл», а служебные коды видны.

- [ ] **Step 3: Реализовать единый маппинг и сетку**

```ts
export function libraryPrimaryAction(item: ExerciseSummary): LibraryPrimaryAction {
  if (item.state === 'ARCHIVED') return { id: 'ARCHIVE', label: 'Открыть архив' };
  if (item.state === 'SEALED' && !item.lastSessionId) return { id: 'START', label: 'Запустить учение' };
  if (item.state === 'APPROVED') return { id: 'REVIEW', label: 'Проверить и зафиксировать' };
  if (item.state === 'SEALED') return { id: 'CONDUCT', label: 'Открыть проведение' };
  return { id: 'PREPARE', label: 'Продолжить подготовку' };
}
```

`PreparationWorkspace` получает реальный `PreparationDraft` и `onSave`. Состояния шагов вычисляются из валидатора, а не из открытия вкладки. CSS использует `grid-template-rows:auto minmax(0,1fr) auto`, нижняя панель находится в потоке сетки, содержимое имеет `min-height:0` и собственную прокрутку. Все статусы учения и проверок проходят через один русский словарь.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-library-actions.test.ts apps/editor/tests/kshvi-preparation-layout.test.tsx apps/editor/tests/kshvi-library.test.tsx`
Expected: PASS; пустые состояния содержат следующее действие, кнопки не перекрывают поля.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/LibraryView.tsx apps/editor/src/modern/kshvi/KshviView.tsx apps/editor/src/modern/kshvi/library-actions.ts apps/editor/src/modern/kshvi/preparation apps/editor/tests/kshvi-library-actions.test.ts apps/editor/tests/kshvi-preparation-layout.test.tsx apps/editor/tests/kshvi-library.test.tsx
git commit -m "Связать библиотеку и этапы подготовки КШВИ"
```

### Task 13: Многослойный снимок среды и смена области новой редакцией

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/snapshot-map-style.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/EnvironmentSelectionEditor.tsx`
- Create: `apps/editor/tests/kshvi-environment-selection.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/EnvironmentMapPreparation.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx`
- Modify: `packages/kshvi/src/environment/provider.ts`

**Interfaces:**
- Consumes: `AtlasMeta[]`, `EnvironmentSelection`, текущая `PreparationDraft`.
- Produces: `mergeSnapshotStyles(styles: readonly StyleSpecification[]): StyleSpecification`; `EnvironmentSelection.atlases` включает все явно выбранные наборы; смена среды возвращает новый snapshot и новую редакцию.

- [ ] **Step 1: Написать failing-тесты**

```ts
it('сохраняет все выбранные атласы, а не только первый', async () => {
  await selectEnvironment([vectorBase, terrain, landcover]);
  expect(createEnvironmentSnapshot).toHaveBeenCalledWith(expect.objectContaining({ atlases: [
    expect.objectContaining({ id: vectorBase.id }), expect.objectContaining({ id: terrain.id }), expect.objectContaining({ id: landcover.id }),
  ] }));
});

it('смена области не мутирует прежний снимок', async () => {
  const result = await replaceEnvironment(previousSnapshot, newSelection);
  expect(result.snapshot.id).not.toBe(previousSnapshot.id);
  expect(result.card.revision).toBe(previousRevision + 1);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-environment-selection.test.tsx`
Expected: FAIL — текущий `freeze()` отправляет один атлас, а `InitialMapCanvas` читает `atlases[0]`.

- [ ] **Step 3: Реализовать объединение стилей и редактор выбора**

```ts
export function mergeSnapshotStyles(styles: readonly StyleSpecification[]): StyleSpecification {
  const result: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ede8d8' } }] };
  for (const [index, style] of styles.entries()) {
    const prefix = `snapshot-${index}-`;
    for (const [id, source] of Object.entries(style.sources)) result.sources[prefix + id] = source;
    if (style.glyphs) result.glyphs = style.glyphs;
    for (const layer of style.layers) {
      if (layer.type === 'background') continue;
      const copy = structuredClone(layer) as typeof layer & { source?: string };
      copy.id = prefix + layer.id;
      if ('source' in layer) copy.source = prefix + layer.source;
      result.layers.push(copy);
    }
  }
  return result;
}
```

`EnvironmentSelectionEditor` показывает область, покрытие, масштабы и независимые флажки наборов. `EnvironmentMapPreparation` загружает существующий снимок из `PreparationDraft`, сохраняет выбранные наборы и погоду, а смену оформляет новым снимком и `savePreparation()`. До сохранения показываются затронутые объекты вне новой рамки и устаревшие подтверждения; автоматического переноса координат нет.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-environment-selection.test.tsx apps/editor/tests/kshvi-initial-map.test.tsx`
Expected: PASS; все выбранные атласы видны, прежний snapshot SHA-256 не изменился, переход в общий раздел возвращает текущее учение.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/preparation/EnvironmentMapPreparation.tsx apps/editor/src/modern/kshvi/preparation/EnvironmentSelectionEditor.tsx apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx apps/editor/src/modern/kshvi/preparation/snapshot-map-style.ts apps/editor/tests/kshvi-environment-selection.test.tsx packages/kshvi/src/environment/provider.ts
git commit -m "Подготавливать многослойную среду КШВИ новой редакцией"
```

### Task 14: MapLibre-редактор исходной обстановки

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/InitialMapEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/InitialMapSymbolPalette.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/MapObjectInspector.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/initial-map-editor-controller.ts`
- Create: `apps/editor/tests/initial-map-editor-controller.test.ts`
- Create: `apps/editor/tests/kshvi-initial-map-editor.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/initial-map-audiences.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/preparation.css`

**Interfaces:**
- Consumes: `InitialSituationMap`, полный `ru-modern-v3`, участники/инстанции, `savePreparation()`, существующие `addInitialMapMarker()`, `updateInitialMapMarker()`, `validateInitialMap()`.
- Produces: `InitialMapEditorAction`, `applyInitialMapAction(map, action): InitialSituationMap`; история undo/redo; `initialMapAudiences(participants)` не читает маркеры.

- [ ] **Step 1: Написать failing-тесты геометрии, истории и проекций**

```ts
it('наносит линию, редактирует вершину и поддерживает undo/redo', () => {
  let history = createEditorHistory(emptyMap);
  history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', markerId: 'route-1', point: [35, 50] });
  history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', markerId: 'route-1', point: [35.1, 50.1] });
  history = applyInitialMapAction(history, { type: 'FINISH_LINE', markerId: 'route-1' });
  history = applyInitialMapAction(history, { type: 'MOVE_VERTEX', markerId: 'route-1', vertex: 1, point: [35.2, 50.2] });
  expect(lineCoordinates(history.present)[1]).toEqual([35.2, 50.2]);
  expect(undo(history).present.markers).not.toEqual(history.present.markers);
  expect(redo(undo(history)).present).toEqual(history.present);
});

it('пустая инстанция доступна до нанесения маркеров', () => {
  expect(initialMapAudiences([{ instanceId: 'hq-blue', sideId: 'blue', role: 'TRAINEE', label: 'Штаб синих' }])).toHaveLength(1);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/initial-map-editor-controller.test.ts apps/editor/tests/kshvi-initial-map-editor.test.tsx`
Expected: FAIL — геометрия доступна только как textarea, а проекции выводятся из маркеров.

- [ ] **Step 3: Реализовать контроллер и рабочую компоновку**

```ts
export function applyInitialMapAction(history: EditorHistory, action: InitialMapEditorAction): EditorHistory {
  const next = reduceInitialMapAction(history.present, action);
  if (next === history.present) return history;
  return { past: [...history.past, history.present], present: next, future: [] };
}

export function undo(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
```

`reduceInitialMapAction()` реализует `CREATE_POINT`, `APPEND_VERTEX`, `FINISH_LINE`, `FINISH_AREA`, `MOVE_OBJECT`, `MOVE_VERTEX`, `UPDATE_ATTRIBUTES`, `DELETE_MARKERS` через существующие доменные функции. `InitialMapEditor` содержит верхнюю панель среды/проекции, палитру слева, карту в центре и инспектор справа. MapLibre `click`, `dblclick`, `mousedown`, `mousemove`, `mouseup` переводятся в действия контроллера; Escape отменяет незавершённую геометрию. Точный ввод координат и GeoJSON остаются дополнительными панелями.

Палитра использует русские названия, поиск, изображения и тип геометрии. Инспектор редактирует связи, период, источник, видимость и надписи; изменение текста использует существующую замену глифа с сохранением Arial, жирности и курсивa. Сохранение вызывает `savePreparation()`, ставит `MAPPED` только после серверного ответа; `APPROVED` — только после `approveInitialMap()` и сверки SHA-256.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/initial-map-editor-controller.test.ts apps/editor/tests/kshvi-initial-map-editor.test.tsx apps/editor/tests/kshvi-initial-map.test.tsx packages/tactical-symbols/tests`
Expected: PASS; точка/линия/область создаются, undo/redo и восстановление работают, пустая проекция не показывает чужую истину.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/preparation apps/editor/tests/initial-map-editor-controller.test.ts apps/editor/tests/kshvi-initial-map-editor.test.tsx apps/editor/tests/kshvi-initial-map.test.tsx
git commit -m "Добавить рабочий редактор исходной обстановки КШВИ"
```

### Task 15: Редактор сил, МПС и импорт современной базы знаний

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/ForceTree.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/ForceEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/MoralePsychEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/KnowledgeImportDialog.tsx`
- Create: `apps/editor/tests/kshvi-force-editor.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `packages/kshvi/src/forces/force.ts`

**Interfaces:**
- Consumes: `ForceDetails`, `previewModernImport()`, `commitModernImport()`, `assertModernImportReady()`, геометрия исходной карты.
- Produces: `upsertForce(draft, force): PreparationDraft`, `removeForce(draft, forceId): PreparationDraft`; импорт создаёт новые сценарные ID и сохраняет `sourceRecordId/sourceRevision/sourceHash`.

- [ ] **Step 1: Написать failing-тесты**

```ts
it('создаёт силу и сохраняет её после повторного открытия', async () => {
  await createForce({ title: '1-я бригада', sideId: 'blue', nodeId: 'hq-blue' });
  await saveAndReload();
  expect(screen.getByText('1-я бригада')).toBeTruthy();
  expect(savedDraft.forces[0].identity.sideId).toBe('blue');
});

it('не превращает неизвестные характеристики базы в номинальные', async () => {
  const preview = previewModernImport(sourceWithUnknown, recordWithUnknown);
  expect(preview.unknown).toContain('massTonnes');
  expect(() => commitModernImport(preview, { sideId: 'blue', parentNodeId: 'hq', scenarioValues: [] })).not.toThrow();
  expect(assertModernImportReady(preview, ['massTonnes']).status).toBe('REQUIRES_REVIEW');
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-force-editor.test.tsx`
Expected: FAIL — текущий шаг показывает только оснащение и пустые планы.

- [ ] **Step 3: Реализовать редакторы и связи**

`ForceTree` строится из стороны, `nodeId` и `parentId`. `ForceEditor` содержит идентичность, состав, положение, состояние и источник; кнопка «Указать на карте» открывает тот же `InitialMapEditor` в режиме связывания, а не текстовый ID. Удаление показывает связанные технику, построение, МТО и карточки до команды.

`MoralePsychEditor` использует существующую шкалу `MoralePsychState`, показывает источник/допущение и механизмы влияния из активного профиля. `KnowledgeImportDialog` вызывает `previewModernImport()`, показывает дерево и `unknown`, затем `commitModernImport()` с новыми UUID. Все изменения проходят `upsertForce()` и серверное `savePreparation()`; справочная запись не изменяется.

Каждая сценарная сила получает устойчивый `id`; совпадение `nodeId` и типа не используется как уникальный ключ.

```ts
export function upsertForce(draft: PreparationDraft, force: ScenarioForce): PreparationDraft {
  const index = draft.forces.findIndex(item => item.id === force.id);
  const forces = index < 0 ? [...draft.forces, force] : draft.forces.map((item, i) => i === index ? force : item);
  return { ...draft, forces, initialMapStatus: draft.initialMap ? 'DRAFT' : draft.initialMapStatus };
}
```

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-force-editor.test.tsx packages/kshvi/tests/modern-import.test.ts packages/kshvi/tests/morale-state.test.ts`
Expected: PASS; данные сохраняются, МПС связано с профилем, неизвестные поля не становятся нулём/номиналом.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/preparation/ForceTree.tsx apps/editor/src/modern/kshvi/preparation/ForceEditor.tsx apps/editor/src/modern/kshvi/preparation/MoralePsychEditor.tsx apps/editor/src/modern/kshvi/preparation/KnowledgeImportDialog.tsx apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx apps/editor/tests/kshvi-force-editor.test.tsx packages/kshvi/src/forces/force.ts
git commit -m "Добавить редактор сил и импорт базы знаний в КШВИ"
```

### Task 16: Оснащение, оперативное построение и МТО как единая редакция

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/FormationEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/LogisticsEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/SupplyRequestEditor.tsx`
- Create: `apps/editor/tests/kshvi-equipment-formation-logistics.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/EquipmentStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/FormationStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/LogisticsStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`

**Interfaces:**
- Consumes: существующие `EquipmentEditorRow`, `FormationPlan`, `SupplyPlan`, `validateFormation()`, `validateSupplyPlan()`, карта и силы.
- Produces: `updateEquipment()`, `upsertFormationElement()`, `createSupplyRequest()` возвращают обновлённый `PreparationDraft`; вкладки «Силы», «Оснащение», «Построение», «Снабжение» работают с одной серверной редакцией.

- [ ] **Step 1: Написать failing-тест полного редактирования**

```ts
it('сохраняет технику, эшелон и заявку в одном сценарии', async () => {
  await editEquipment({ forceId: 'force-1', actual: 8, serviceable: 6 });
  await addEchelon({ forceIds: ['force-1'], areaId: 'area-1', readyAt: '2026-11-25T06:00:00Z' });
  await createSupplyRequest({ forceId: 'force-1', resourceId: 'fuel', quantity: 400, unit: 'L', routeId: 'route-1' });
  await saveAndReload();
  expect(savedDraft.equipment[0]).toMatchObject({ actual: 8 });
  expect(savedDraft.formation?.echelons[0].forceIds).toEqual(['force-1']);
  expect(savedDraft.logistics?.requests[0]).toMatchObject({ resourceId: 'fuel', quantity: 400 });
});
```

Отдельные проверки: сумма состояний техники не превышает факт; сила не входит в несовместимые эшелоны; отправка не увеличивает остаток получателя; неизвестный маршрут не считается открытым.

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-equipment-formation-logistics.test.tsx`
Expected: FAIL — текущие props содержат пустые локальные массивы и нет редакторов.

- [ ] **Step 3: Реализовать рабочие вкладки**

`EquipmentStep` получает `rows` и `onSave`, добавляет/изменяет строки через существующие операции и не инициализируется повторно пустым шаблоном после загрузки. Групповое изменение сначала показывает `previewGroupChange()`, затем сохраняет серверный результат.

`FormationEditor` создаёт элементы `FormationPlan` по существующим типам, выбирает силы и геометрию карты, проверяет сроки/зависимости/маршруты. `LogisticsEditor` и `SupplyRequestEditor` создают запасы, пункты, транспорт, маршруты, заявки и ремонтные записи с единицами и источниками. Для поставки показываются ёмкость, маршрут и дефицит до сохранения; состояния «планируется», «отправлена», «в пути», «частично поступила», «подтверждена» не смешиваются.

```ts
export function upsertFormationElement(draft: PreparationDraft, plan: FormationPlan): PreparationDraft {
  const { issues } = validateFormation(plan);
  if (issues.some(issue => issue.severity === 'ERROR')) throw new Error(issues.map(issue => issue.message).join('\n'));
  return { ...draft, formation: plan };
}
```

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-equipment-formation-logistics.test.tsx apps/editor/tests/kshvi-equipment.test.tsx packages/kshvi/tests/formation.test.ts packages/kshvi/tests/supply-request.test.ts packages/kshvi/tests/supply-movement.test.ts`
Expected: PASS; все данные сохраняются и валидируются, двойного списания/мгновенной доставки нет.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/preparation/EquipmentStep.tsx apps/editor/src/modern/kshvi/preparation/FormationStep.tsx apps/editor/src/modern/kshvi/preparation/FormationEditor.tsx apps/editor/src/modern/kshvi/preparation/LogisticsStep.tsx apps/editor/src/modern/kshvi/preparation/LogisticsEditor.tsx apps/editor/src/modern/kshvi/preparation/SupplyRequestEditor.tsx apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx apps/editor/tests/kshvi-equipment-formation-logistics.test.tsx
git commit -m "Связать оснащение, построение и МТО с редакцией КШВИ"
```

---

### Task 17: Реальный профиль автономии, каталог и репетиция

**Files:**
- Create: `services/kshvi/src/preparation/autonomy-service.ts`
- Create: `services/kshvi/src/http/autonomy-routes.ts`
- Create: `services/kshvi/tests/autonomy-routes.test.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/EventTemplateCard.tsx`
- Create: `apps/editor/tests/kshvi-autonomy-editor.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/AutonomyEditor.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/CatalogBrowser.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/RehearsalReport.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `services/kshvi/src/app.ts`

**Interfaces:**
- Consumes: `loadEventCatalog()`, `createAutonomyProfile()`, `updateAutonomyProfile()`, `intensityFor()`, `attemptsPerOperationalHour()`, `selectCandidate()`, `rehearseCatalog()`, файлы `packages/kshvi-events/data/catalog/`.
- Produces: `GET /kshvi/exercises/:id/autonomy/catalog`, `PUT /kshvi/exercises/:id/autonomy/profile`, `POST /kshvi/exercises/:id/autonomy/rehearsal`; UI использует `AutonomyProfile`, а не локальный числовой суррогат.

- [ ] **Step 1: Написать failing-тесты профиля, причин и репетиции**

```ts
it('меняет серверную интенсивность категории и вычисляет ожидаемые попытки доменной функцией', async () => {
  const result = await updateAutonomyProfile(current, { intensity: { categories: { logistics: 0 } } }, 'DRAFT');
  expect(intensityFor(result, scopeLogistics)).toBe(0);
  expect(attemptsPerOperationalHour(result, scopeLogistics)).toBe(0);
  await expect(saveProfile(result)).resolves.toMatchObject({ revision: currentRevision + 1 });
});

it('показывает реальный шаблон и причину его исключения', async () => {
  const response = await catalogFor(scenarioWithoutBridge);
  const event = response.items.find(item => item.templateId === 'engineering-crossing-damage');
  expect(event.title).toBeTruthy();
  expect(event.availability).toBe('UNAVAILABLE');
  expect(event.reasons).toContain('В выбранной области нет требуемой переправы');
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/kshvi/tests/autonomy-routes.test.ts apps/editor/tests/kshvi-autonomy-editor.test.tsx`
Expected: FAIL — текущие `AutonomyEditor` и `CatalogBrowser` не обращаются к серверу.

- [ ] **Step 3: Реализовать сервис и рабочий экран**

`AutonomyService` загружает каталог один раз на запуск, проверяет `issues`, отклоняет работу при ошибочном каталоге и возвращает фактические `templates` с русскими полями. Доступность вычисляется по предусловиям текущего сценария; обязательное неизвестное условие возвращает `UNKNOWN_DATA`, а не `AVAILABLE`.

```ts
export function expectedAttempts(profile: AutonomyProfile, scope: AutonomyScope): number {
  return attemptsPerOperationalHour(profile, scope);
}

export function categoryIntensity(profile: AutonomyProfile, category: EventCategory, value: number, state: 'DRAFT'|'IN_REVIEW'|'APPROVED'): AutonomyProfile {
  return updateAutonomyProfile(profile, { intensity: { categories: { [category]: value } } }, state);
}
```

`AutonomyEditor` получает `profile`, `onPreview` и `onSave`; общий уровень выбирается из пяти русских названий, ползунок категории имеет диапазон 0–4 и шаг 0,25, текст показывает множитель и ожидаемые попытки/оперативный час. При нуле явно указано сохранение плановых и реактивных событий. Дополнительные оси используют те же доменные функции.

`CatalogBrowser` получает реальные записи с поиском и фильтрами; `EventTemplateCard` показывает описание, предусловия, эффекты, источник, доступность и причины. Репетиция принимает зёрна/горизонт и вызывает серверный `rehearseCatalog()`; для `OFF` используется `scheduleOperationalRange()` с нулевым профилем, поскольку `rehearseCatalog()` требует положительный базовый профиль. Отчёт содержит фактические runs, частоты, пустые интервалы и отклонения; одинаковые входы/зерно воспроизводят одинаковый SHA-256 отчёта.

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/kshvi/tests/autonomy-routes.test.ts apps/editor/tests/kshvi-autonomy-editor.test.tsx packages/kshvi-events/tests`
Expected: PASS; ноль отключает только вероятностный контур, именованные профили не редактируют числа методического справочника, репетиция не пишет официальный журнал.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/kshvi/src/preparation/autonomy-service.ts services/kshvi/src/http/autonomy-routes.ts services/kshvi/src/app.ts services/kshvi/tests/autonomy-routes.test.ts apps/editor/src/modern/kshvi/preparation/AutonomyEditor.tsx apps/editor/src/modern/kshvi/preparation/CatalogBrowser.tsx apps/editor/src/modern/kshvi/preparation/EventTemplateCard.tsx apps/editor/src/modern/kshvi/preparation/RehearsalReport.tsx apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx apps/editor/src/modern/kshvi/kshvi-api.ts apps/editor/tests/kshvi-autonomy-editor.test.tsx
git commit -m "Подключить реальное вероятностное наращивание к подготовке КШВИ"
```

### Task 18: Редактор боевой готовности и серверное продвижение

**Files:**
- Create: `services/kshvi/src/preparation/readiness-service.ts`
- Create: `services/kshvi/src/http/readiness-routes.ts`
- Create: `services/kshvi/tests/readiness-routes.test.ts`
- Create: `apps/editor/src/modern/kshvi/preparation/ReadinessActivityEditor.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/readiness-labels.ts`
- Create: `apps/editor/tests/kshvi-readiness-editor.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/ReadinessStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `services/kshvi/src/app.ts`

**Interfaces:**
- Consumes: `ReadinessStage`, `ReadinessState`, `advanceReadiness()`, `authorizePartialReadiness()`, реальный канал сигнала и серверное оперативное время.
- Produces: `PUT /kshvi/exercises/:id/readiness/stage`, `POST /kshvi/exercises/:id/readiness/advance`, `POST /kshvi/exercises/:id/readiness/partial-authorization`; все ответы содержат новый серверный `ReadinessState` и редакцию.

- [ ] **Step 1: Написать failing-тесты фактического перехода**

```ts
it('не завершает мероприятие без сигнала, доклада и критерия', async () => {
  const result = await advance({ at, completions: [{ activityId: 'deploy', report: validReport }] });
  expect(result.state.status).not.toBe('READY');
  expect(result.state.limitations.map(item => item.code)).toContain('SIGNAL_NOT_RECEIVED');
});

it('применяет полный доклад через advanceReadiness и не дублирует его', async () => {
  const first = await advance(validCompletion);
  const second = await advance(validCompletion);
  expect(second.state).toEqual(first.state);
  expect(second.state.history).toHaveLength(first.state.history.length);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/kshvi/tests/readiness-routes.test.ts apps/editor/tests/kshvi-readiness-editor.test.tsx`
Expected: FAIL — текущий `ReadinessStep` получает пустой статичный этап и не имеет серверной команды.

- [ ] **Step 3: Реализовать редактирование и команды**

`ReadinessService` хранит этап и состояния в `PreparationDraft` через новую серверную редакцию. `advance` повторно читает текущую редакцию, вызывает `advanceReadiness(stage, previous, input)` и сохраняет результат атомарно; повторный `idempotencyKey` возвращает прежний результат. Канал сигнала и `receivedAt` берутся из фактической доставки, не из текстового названия.

`ReadinessActivityEditor` создаёт мероприятия всех существующих `ReadinessActivityKind`, зависимости, ресурсы, критерии и требование доклада. `ReadinessStep` показывает русские статусы, фактические сроки и ограничения из `readiness-labels.ts`, позволяет ввести доклад/сбой и вызвать `advance`. Кнопка без серверного обработчика не отображается. Частичная готовность использует `authorizePartialReadiness()` и требует решение, приказ, основание, обоснование и полный список ограничений.

```ts
export function advanceStage(stage: ReadinessStage, previous: ReadinessState, input: ReadinessAdvanceInput): ReadinessState {
  return advanceReadiness(stage, previous, input);
}
```

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/kshvi/tests/readiness-routes.test.ts apps/editor/tests/kshvi-readiness-editor.test.tsx packages/kshvi/tests/readiness-stage.test.ts`
Expected: PASS; доклады и зависимости влияют на итог, повтор идемпотентен, частичное разрешение не удаляет ограничения.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/kshvi/src/preparation/readiness-service.ts services/kshvi/src/http/readiness-routes.ts services/kshvi/src/app.ts services/kshvi/tests/readiness-routes.test.ts apps/editor/src/modern/kshvi/preparation/ReadinessStep.tsx apps/editor/src/modern/kshvi/preparation/ReadinessActivityEditor.tsx apps/editor/src/modern/kshvi/preparation/readiness-labels.ts apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx apps/editor/src/modern/kshvi/kshvi-api.ts apps/editor/tests/kshvi-readiness-editor.test.tsx
git commit -m "Сделать этап боевой готовности рабочим серверным процессом"
```

### Task 19: Понятная проверка, фиксация и запуск

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/LaunchChecklist.tsx`
- Create: `apps/editor/src/modern/kshvi/preparation/launch-labels.ts`
- Create: `apps/editor/tests/kshvi-launch-checklist.test.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/SealingStep.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`

**Interfaces:**
- Consumes: серверные `ExerciseState`, валидация, персональные подтверждения, репетиция, существующие `transitions`, `seal`, `createSession`.
- Produces: `launchActionFor(state)`; UI не показывает `SEALED_REQUIRED` как самостоятельный текст и не разблокирует запуск локальной проверкой.

- [ ] **Step 1: Написать failing-тесты серверного барьера**

```ts
expect(launchActionFor('DRAFT').label).toBe('Отправить на проверку');
expect(launchActionFor('APPROVED').label).toBe('Зафиксировать сценарий');
expect(launchActionFor('SEALED').label).toBe('Запустить учение');

it('не запускает сеанс после одной локальной проверки', async () => {
  await runLocalValidationOnly();
  expect(createSession).not.toHaveBeenCalled();
  expect(screen.getByText('Сценарий ещё не зафиксирован')).toBeTruthy();
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-launch-checklist.test.tsx`
Expected: FAIL — текущий экран содержит «Требуется SEALED» и английскую цепочку состояний.

- [ ] **Step 3: Реализовать чек-лист и команды**

`LaunchChecklist` получает области проверки из серверного отчёта, показывает ошибки/предупреждения/допущения и ссылки на конкретный шаг/объект. `SealingStep` работает с текущей серверной редакцией выбранного учения, а не с собственным изолированным `sealed`. Переходы выполняются последовательно через существующие серверные методы; после каждого ответа карточка загружается заново.

```ts
export function launchActionFor(state: ExerciseState): LaunchAction {
  if (state === 'APPROVED') return { command: 'SEAL', label: 'Зафиксировать сценарий' };
  if (state === 'SEALED') return { command: 'START', label: 'Запустить учение' };
  if (state === 'IN_REVIEW') return { command: 'APPROVE', label: 'Утвердить редакцию' };
  return { command: 'SUBMIT', label: 'Отправить на проверку' };
}
```

Ошибки сервера переводятся в русское действие без удаления технического кода из раздела подробностей. После успешного `createSession()` открывается проведение с реальным `sessionId`; при ошибке чек-лист остаётся на экране.

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-launch-checklist.test.tsx services/kshvi/tests/exercise-store.test.ts services/kshvi/tests/e2e/conduct-cycle.test.ts`
Expected: PASS; клиентская декларация не создаёт права запуска, затронутый существующий сетевой цикл сохранён.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/preparation/SealingStep.tsx apps/editor/src/modern/kshvi/preparation/LaunchChecklist.tsx apps/editor/src/modern/kshvi/preparation/launch-labels.ts apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx apps/editor/src/modern/kshvi/KshviView.tsx apps/editor/tests/kshvi-launch-checklist.test.tsx
git commit -m "Сделать фиксацию и запуск КШВИ понятными и серверными"
```

---

## Пакет D. Проведение, архив и визуальная приёмка

### Task 20: Честное пустое состояние и только серверная проекция проведения

**Files:**
- Create: `apps/editor/src/modern/kshvi/conduct/ConductEmptyState.tsx`
- Create: `apps/editor/src/modern/kshvi/conduct/ConductMap.tsx`
- Create: `apps/editor/src/modern/kshvi/conduct/conduct-client.ts`
- Create: `apps/editor/tests/kshvi-conduct-empty.test.tsx`
- Create: `apps/editor/tests/kshvi-conduct-production.test.ts`
- Modify: `apps/editor/src/modern/kshvi/conduct/ConductWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/conduct/LeaderWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`

**Interfaces:**
- Consumes: существующие `ConductClient.loadProjection()`, серверные сессии и зафиксированный снимок среды.
- Produces: без `client/context` рендерится только `ConductEmptyState`; производственный `ConductWorkspace` не импортирует `overviewProjection`, `overviewCommands` или демонстрационный `draftRevision`.

- [ ] **Step 1: Написать failing-тесты**

```ts
it('не показывает рабочие панели без активного сеанса', () => {
  render(<ConductWorkspace role="LEADER" />);
  expect(screen.getByText('Активный сеанс не выбран')).toBeTruthy();
  expect(screen.queryByText('Этап и обстановка')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Новый документ' })).toBeNull();
});

it('не содержит производственных ссылок на обзорную фикстуру', async () => {
  const source = await readFile('apps/editor/src/modern/kshvi/conduct/ConductWorkspace.tsx', 'utf8');
  expect(source).not.toContain('overviewProjection');
  expect(source).not.toContain('draftRevision');
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run apps/editor/tests/kshvi-conduct-empty.test.tsx apps/editor/tests/kshvi-conduct-production.test.ts`
Expected: FAIL — текущий безсессионный путь создаёт `overviewCommands` и `overviewProjection`.

- [ ] **Step 3: Удалить фиктивную ветку и подключить реальный клиент**

```tsx
export function ConductEmptyState({ onLibrary, hasActiveSession, onOpenActive }: {
  onLibrary(): void; hasActiveSession: boolean; onOpenActive(): void;
}) {
  return <main className="kshvi-conduct-workspace">
    <h1>Проведение КШВИ</h1>
    <p>Активный сеанс не выбран. Выберите зафиксированное учение в библиотеке.</p>
    <button type="button" onClick={onLibrary}>Перейти в библиотеку</button>
    {hasActiveSession && <button type="button" onClick={onOpenActive}>Открыть активный сеанс</button>}
  </main>;
}
```

`ConductWorkspace` без клиента/контекста возвращает это состояние до любых рабочих компонентов. При наличии сеанса загружается серверная проекция; `UNKNOWN`/неподдерживаемая роль получает ошибку конфигурации вместо `LegacyConductWorkspace`. `conduct-client.ts` реализует существующий `ConductClient` через серверные projection/command API; ответ применяется только после серверного подтверждения.

`ConductMap` объединяет стили снимка через `mergeSnapshotStyles()`, принимает GeoJSON только из разрешённой проекции и связывает выбор события с документом/расчётом. Просмотр прошлого имеет отдельную метку и не вызывает команду скачка. При потере соединения старая проекция получает статус «Устарело», а не остаётся «подключено».

- [ ] **Step 4: Проверить**

Run: `npx vitest run apps/editor/tests/kshvi-conduct-empty.test.tsx apps/editor/tests/kshvi-conduct-production.test.ts apps/editor/tests/kshvi-workspaces.test.tsx services/kshvi/tests/e2e/conduct-cycle.test.ts`
Expected: PASS; без сеанса нет рабочих панелей, серверные роли и команды сохранены, утечки истины нет.

- [ ] **Step 5: Зафиксировать**

```bash
git add apps/editor/src/modern/kshvi/conduct apps/editor/src/modern/kshvi/KshviView.tsx apps/editor/tests/kshvi-conduct-empty.test.tsx apps/editor/tests/kshvi-conduct-production.test.ts apps/editor/tests/kshvi-workspaces.test.tsx
git commit -m "Убрать фиктивное проведение КШВИ без серверного сеанса"
```

### Task 21: Рабочая копия и удаление из архива с аудитом

**Files:**
- Create: `services/kshvi/src/store/migrations/006-archive-visibility.sql`
- Create: `services/kshvi/tests/archive-visibility.test.ts`
- Create: `apps/editor/tests/kshvi-archive-actions.test.tsx`
- Modify: `services/kshvi/src/store/exercise-store.ts`
- Modify: `services/kshvi/src/http/exercise-routes.ts`
- Modify: `apps/editor/src/modern/kshvi/kshvi-api.ts`
- Modify: `apps/editor/src/modern/kshvi/LibraryView.tsx`
- Modify: `apps/editor/src/modern/kshvi/archive/ArchiveWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/KshviView.tsx`

**Interfaces:**
- Consumes: существующий `ExerciseStore.copy()` архивного источника, право `exercise:archive`, `expectedRevision`.
- Produces: `ExerciseStore.hideArchiveEntry(actor, id, { expectedRevision, title, reason })`; `DELETE /kshvi/exercises/:id/archive-entry`; `archiveHiddenAt/archiveHiddenBy/archiveHiddenReason` не входят в публичную проекцию без права администрирования.

- [ ] **Step 1: Написать failing-тесты**

```ts
it('восстанавливает архив как новый черновик, не меняя источник', async () => {
  const copy = await store.copy(actor, archived.id, 'Новая подготовка');
  expect(copy.id).not.toBe(archived.id);
  expect(copy.state).toBe('DRAFT');
  expect((await store.get(actor.organizationId, archived.id))?.state).toBe('ARCHIVED');
});

it('скрывает архивную запись с аудитом и не удаляет историю', async () => {
  await store.hideArchiveEntry(actor, archived.id, { expectedRevision: archived.revision, title: archived.title, reason: 'Ошибочная публикация' });
  expect(await store.list(actor.organizationId, { state: 'ARCHIVED' })).toEqual([]);
  const retained = await store.get(actor.organizationId, archived.id);
  expect(retained?.revisions.length).toBeGreaterThan(0);
  expect(retained?.archiveHiddenBy).toBe(actor.userId);
});
```

- [ ] **Step 2: Запустить до реализации**

Run: `npx vitest run services/kshvi/tests/archive-visibility.test.ts apps/editor/tests/kshvi-archive-actions.test.tsx`
Expected: FAIL — архивные карточки не имеют таких действий и полей.

- [ ] **Step 3: Реализовать мягкое удаление и действия UI**

Миграция добавляет `archive_hidden_at`, `archive_hidden_by`, `archive_hidden_reason`; запись допускается только при `state='ARCHIVED'`. `hideArchiveEntry()` проверяет ожидаемую редакцию и точное название, выполняется в транзакции и идемпотентно возвращает уже скрытую запись при совпадающем основании. Список архива исключает скрытые записи, прямое чтение по правилам аудита сохраняется.

```ts
export type HideArchiveEntryInput = Readonly<{
  expectedRevision: number;
  title: string;
  reason: string;
}>;
```

`LibraryView` в режиме архива показывает «Создать рабочую копию» и «Удалить из архива». Первое вызывает `client.copy()` и открывает новый черновик. Второе требует повторного ввода названия и основания, затем `client.hideArchiveEntry()`; карточка исчезает только после ответа. Физического удаления этот путь не выполняет. Существующий retention/admin контур остаётся отдельным.

- [ ] **Step 4: Проверить**

Run: `npx vitest run services/kshvi/tests/archive-visibility.test.ts services/kshvi/tests/exercise-store.test.ts apps/editor/tests/kshvi-archive-actions.test.tsx apps/editor/tests/kshvi-library.test.tsx`
Expected: PASS; источник неизменен, без права сервер даёт 403, конфликт редакции/названия не скрывает запись.

- [ ] **Step 5: Зафиксировать**

```bash
git add services/kshvi/src/store/migrations/006-archive-visibility.sql services/kshvi/src/store/exercise-store.ts services/kshvi/src/http/exercise-routes.ts services/kshvi/tests/archive-visibility.test.ts apps/editor/src/modern/kshvi/kshvi-api.ts apps/editor/src/modern/kshvi/LibraryView.tsx apps/editor/src/modern/kshvi/archive/ArchiveWorkspace.tsx apps/editor/src/modern/kshvi/KshviView.tsx apps/editor/tests/kshvi-archive-actions.test.tsx
git commit -m "Добавить восстановление и удаление архивной записи КШВИ"
```

### Task 22: Сквозная настольная проверка, шрифты и документация

**Files:**
- Create: `scripts/kshvi-workspace-e2e.mjs`
- Create: `scripts/historical-typography-e2e.mjs`
- Create: `docs/img/kshvi-preparation-environment.jpg`
- Create: `docs/img/kshvi-preparation-forces.jpg`
- Create: `docs/img/kshvi-preparation-events.jpg`
- Create: `docs/img/kshvi-preparation-readiness.jpg`
- Create: `docs/img/kshvi-conduct-workspace.jpg`
- Create: `docs/img/kshvi-archive-actions.jpg`
- Modify: `docs/system.md`
- Modify: `docs/system.pdf`
- Modify: `docs/system.docx`
- Modify: `docs/superpowers/plans/2026-11-21-kshvi-full-release.md`

**Interfaces:**
- Consumes: все предыдущие задачи, локальный автоматический вход, реальный каталог/атлас/PostgreSQL.
- Produces: повторяемый сквозной сценарий, JPEG 1440×900, итоги точечных UX-AC-01…20 и ссылка на коммит; финальный AC-01–AC-30 не дублируется на промежуточных задачах.

- [ ] **Step 1: Написать failing-проверки компоновки и исторической типографики**

```ts
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const actionBar = await page.getByRole('contentinfo', { name: 'Навигация по подготовке' }).boundingBox();
const lastField = await page.getByLabel('Окончание действия').boundingBox();
expect(actionBar && lastField ? overlaps(actionBar, lastField) : true).toBe(false);

const historicalText = await page.locator('.replay-feature-copy').evaluate(element => ({
  color: getComputedStyle(element).color,
  background: getComputedStyle(element).backgroundColor,
}));
expect(historicalText.color).toBe('rgb(31, 31, 31)');
```

Проверка типографики дополнительно обходит заголовки, абзацы, подписи и таблицы на светлых поверхностях и отклоняет непредусмотренное наследование светлых цветов современной темы. Специальные статусы и белый текст тёмных кнопок проверяются по их собственным селекторам, а не правилом «весь текст чёрный».

- [ ] **Step 2: Запустить сквозной сценарий против текущей сборки**

Run: `node scripts/kshvi-workspace-e2e.mjs`
Run: `node scripts/historical-typography-e2e.mjs`
Expected: FAIL до реализации хотя бы одного обязательного действия; нельзя принимать пропуск шага как успех.

- [ ] **Step 3: Выполнить полный пользовательский путь и снять реальные экраны**

`kshvi-workspace-e2e.mjs` запускает временные сервисы на свободных портах, использует новую локальную сессию и выполняет:

1. создаёт учение и открывает подготовку;
2. выбирает область и все необходимые атласы, фиксирует среду;
3. наносит точку, линию и область, меняет надпись, проверяет undo/redo и проекции;
4. создаёт силу, импортирует разрешённую запись, заполняет технику, построение и МТО;
5. меняет общую и областную интенсивность, открывает событие и запускает репетицию на повторном зерне;
6. создаёт этап готовности, передаёт сигнал/доклады и продвигает состояние;
7. проходит серверные проверки, утверждение, фиксацию и запуск;
8. открывает проведение с реальной проекцией, затем завершает и создаёт архив;
9. создаёт рабочую копию и отдельно скрывает архивную запись с аудитом;
10. после перезапуска проверяет серверное восстановление каждого этапа.

Каждый шаг имеет ожидаемый серверный ответ и DOM/карту; при сбое сохраняются снимок, журнал и сетевой ответ. Скрипт в `finally` останавливает все созданные процессы. `historical-typography-e2e.mjs` проверяет исторические карточки, документы, таблицы и переигровку в настольной сборке.

- [ ] **Step 4: Выполнить регрессию, обновить описание и документы**

Run: `npm run typecheck 2>&1 | tail -3`
Run: `TEST_DATABASE_URL=postgres://vladimirabramov@127.0.0.1:5432/postgres npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Run: `npm run build`
Run: `node scripts/kshvi-workspace-e2e.mjs`
Run: `node scripts/historical-typography-e2e.mjs`
Run: `PATH="$PWD/.kimi-tmp/pandoc/pandoc-3.14-arm64/bin:$PATH" npm run docs:system`
Run: `npm run kb:seed`
Run: `npm run model:index`
Expected: PASS; все новые UX-AC имеют фактические доказательства, снимки соответствуют подписям, никакие серверы не остаются запущенными.

Обновить `docs/system.md` только фактически работающими возможностями, переснять затронутые JPEG и исправить план полного релиза: новые требования включаются в матрицу покрытия без изменения старых доказательств на незатронутые области. Полный формальный `npm run test:kshvi:release` выполняется один раз после закрытия всех обязательных работ, а не на промежуточных коммитах.

- [ ] **Step 5: Зафиксировать проверенный результат**

```bash
git add scripts/kshvi-workspace-e2e.mjs scripts/historical-typography-e2e.mjs docs/system.md docs/system.pdf docs/system.docx docs/img/kshvi-preparation-environment.jpg docs/img/kshvi-preparation-forces.jpg docs/img/kshvi-preparation-events.jpg docs/img/kshvi-preparation-readiness.jpg docs/img/kshvi-conduct-workspace.jpg docs/img/kshvi-archive-actions.jpg docs/superpowers/plans/2026-11-21-kshvi-full-release.md packages/knowledge/data/seed.json packages/knowledge/data/model-index.json
git commit -m "Подтвердить рабочий контур КШВИ в настольной сборке"
```

---

## Матрица покрытия спецификации

| Раздел спецификации | Задачи |
|---|---|
| Общие русские состояния, отсутствие фикстур, компоновка | 11, 12, 19, 20, 22 |
| Локальный автоматический вход | 10 |
| Библиотека и переходы | 12 |
| Выбор среды, несколько атласов, новая редакция | 13 |
| Редактор исходной карты, знаки, проекции, MAPPED/APPROVED | 11, 14 |
| Единая растровая граница и неизменность источников | 1, 2 |
| Открытие области, OSM, удаление области | 3, 4 |
| Силы, МПС, современная база знаний | 15 |
| Оснащение, построение, МТО | 16 |
| Общая/областная интенсивность, каталог, репетиция | 17 |
| Боевая готовность и частичное разрешение | 18 |
| Проверка, фиксация и запуск | 19 |
| Проведение без фиктивных панелей | 20 |
| Архивная копия и удаление с аудитом | 21 |
| Независимость погоды от камеры | 5 |
| Климатические нормы и региональный алгоритм | 6, 7 |
| История поверхности, высота и покров | 8, 9 |
| Версии погоды и старые реплеи | 7, 22 |
| Шрифты исторического режима и настольная приёмка | 22 |

## Порядок выполнения

1. Сначала Tasks 1–5: они устраняют независимые географические дефекты и задают общие компоненты карты.
2. Tasks 6–9 выполняются последовательно, поскольку региональный алгоритм зависит от проверенного климатического пакета.
3. Task 10 не зависит от погоды, но предшествует настольной E2E-проверке.
4. Task 11 — обязательный серверный фундамент для Tasks 12–19.
5. Tasks 20–21 используют уже работающий серверный цикл; Task 22 выполняется последней.
6. Каждая задача заканчивается собственным зелёным тестом и коммитом. Открытая ошибка не переносится в следующую задачу как «известное успешное состояние».
