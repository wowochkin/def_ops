# КШВИ: единая среда подготовки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Использовать в шаге «Среда» область, слои и погоду из «Карты и погоды», показать температуру растром и освободить рабочее место карты.

**Architecture:** Существующие `catalogRegions`, `loadRegion`, `loadWeatherScenario` и `weatherRasters` остаются единственными источниками группировки и модельных данных. `EnvironmentSelectionEditor` только адаптирует их к `EnvironmentSelection`; неизменяемые снимки и серверный контракт не меняются.

**Tech Stack:** React, TypeScript, MapLibre GL, Vitest, Testing Library.

## Global Constraints

- Не менять формат `EnvironmentSnapshot`, API создания/фиксации среды и редактор исходной обстановки.
- Не запускать полный `npm test` или голосовой прогон; только указанные точечные файлы и типизацию.
- Не трогать незакоммиченное исправление `kshvi/library.json` и файл `recovery-drill.json`.
- Не делегировать выполнение субагентам.

---

### Task 1: Области и предзаполнение из общего раздела

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/EnvironmentSelectionEditor.tsx`
- Test: `apps/editor/tests/kshvi-environment-selection.test.tsx`

**Interfaces:**
- Consumes: `catalogRegions(maps, jobs)`, `loadRegion()`, `loadWeatherScenario()`, `useAreaNames()`, `areaKey(bounds)`, `automaticAreaName(bounds)`.
- Produces: один пункт выпадающего списка на рамку; `EnvironmentSelection.region` содержит имя области, а не имя слоя.

- [x] **Step 1: Добавить failing-тест**

В `kshvi-environment-selection.test.tsx` использовать существующие `atlas`, `terrain`, `landcover` с одинаковыми `bounds`. Перед рендером сохранить общий сценарий с `start: '2032-03-04T05:06:00Z'`, зерном `73`, рамкой `atlas.bounds` и выбором всех трёх наборов:

```ts
localStorage.setItem('def_ops.modern.weather.region', JSON.stringify({ bounds: atlas.bounds, cols: 3, rows: 3 }));
localStorage.setItem('def_ops.modern.weather.scenario', JSON.stringify({
  version: 1, algorithmVersion: 2, seed: 73, start: '2032-03-04T05:06:00Z',
  temperatureMode: 'climate', manualFields: [], temperature: 15, humidity: 65,
  pressure: 1013, windSpeed: 4, windDirection: 270, cloud: 40,
  precipitation: 0, variability: 1, transitionHours: 3, durationHours: 24,
}));
localStorage.setItem('def_ops.modern.atlas.regionStates', JSON.stringify({
  [atlas.bounds.map(value => value.toFixed(6)).join(',')]: {
    selected: ['base', 'terrain', 'cover'], disabled: [], terrainId: 'terrain',
  },
}));
```

После открытия подготовки проверить:

```ts
const select = await screen.findByLabelText<HTMLSelectElement>('Подготовленная область');
expect(within(select).getAllByRole('option')).toHaveLength(1);
expect(screen.getByLabelText<HTMLInputElement>('Зерно погодного сценария').value).toBe('73');
expect(document.querySelector<HTMLInputElement>('#kshvi-weather-start + input')?.value)
  .toBe('2032-03-04T05:06');
expect(screen.queryByRole('button', { name: 'Выбрать подготовленную область' })).toBeNull();
```

Для даты использовать скрытое `input`-поле непосредственно после `#kshvi-weather-start`, а не системные часы.

- [x] **Step 2: Запустить тест и увидеть исходные три пункта и зерно 42**

Run: `npx vitest run apps/editor/tests/kshvi-environment-selection.test.tsx`
Expected: FAIL — три слоя представлены как три области; общий сценарий не прочитан; дублирующая кнопка присутствует.

- [x] **Step 3: Реализовать группировку и начальное состояние**

В `EnvironmentSelectionEditor`:

```ts
const { names } = useAreaNames();
const areas = useMemo(() => catalogRegions(atlases.map(atlas => ({
  ...atlas,
  bounds: [...atlas.bounds] as [number, number, number, number],
  layers: [...atlas.layers],
})), []).map(group => ({
  ...group,
  name: names[group.key] ?? automaticAreaName(group.bounds),
})), [atlases, names]);
const sharedRegion = useRef(loadRegion()).current;
const sharedScenario = useRef(loadWeatherScenario()).current;
const sharedArea = areas.find(area => area.key === areaKey(sharedRegion.bounds));
```

`areaId` хранит `group.key`; `saved` зарезервирован для существующего снимка. Начальная область — `sharedArea`, затем первая из каталога. Начальный сценарий — `sharedScenario`, начальный `operationalAt` — `utcInput(sharedScenario.start)`. При выборе области наборы берутся из `regionStates[group.key].selected`; если записи нет, единственный векторный набор выбирается по правилу `openAtlasRegion`.

Список слоёв ограничивается `area.maps`; смена области заменяет `selectedIds`, а не смешивает слои разных рамок. Кнопка и состояние `focusChoices` удаляются. Подробная погода помещается в закрытый по умолчанию `details` с видимой сводкой источника и времени.

- [x] **Step 4: Повторить только этот тест**

Run: `npx vitest run apps/editor/tests/kshvi-environment-selection.test.tsx`
Expected: PASS.

---

### Task 2: Сплошное температурное поле

**Files:**
- Create: `apps/editor/src/modern/kshvi/preparation/temperature-rasters.ts`
- Modify: `apps/editor/src/modern/kshvi/preparation/EnvironmentSelectionEditor.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/InitialMapCanvas.tsx`
- Test: `apps/editor/tests/kshvi-temperature-rasters.test.ts`

**Interfaces:**
- Consumes: `weatherRasters(region, cells, 'temperature')`.
- Produces: `temperatureRasters(points, bounds): WeatherRaster[]`; `EnvironmentMapPreview.weatherRasters?: readonly WeatherRaster[]`.

- [x] **Step 1: Добавить failing-тест генерации растра**

```ts
import { expect, it } from 'vitest';
import { temperatureRasters } from '../src/modern/kshvi/preparation/temperature-rasters';

it('строит сплошной температурный растр по сетке 3 × 3', () => {
  const bounds = [36, 55, 38, 57] as const;
  const points = [0, 1, 2].flatMap(row => [0, 1, 2].map(col => ({
    lon: 36 + col, lat: 55 + row, value: row + col,
  })));
  const result = temperatureRasters(points, bounds);
  expect(result).toHaveLength(1);
  expect(result[0]!.size).toBe(128);
  expect(result[0]!.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
});
```

- [x] **Step 2: Запустить тест до создания модуля**

Run: `npx vitest run apps/editor/tests/kshvi-temperature-rasters.test.ts`
Expected: FAIL — модуль `temperature-rasters` отсутствует.

- [x] **Step 3: Реализовать растр и удалить circle-слой погоды**

Новый модуль целиком:

```ts
import type { Bounds } from '../../../../../../packages/kshvi/src/environment/provider';
import { weatherRasters, type WeatherRaster } from '../../../weather-layer';
import type { WeatherMapPoint } from './InitialMapCanvas';

export function temperatureRasters(points: readonly WeatherMapPoint[], bounds: Bounds): WeatherRaster[] {
  const cells = points.map(({ lon, lat, value }) => ({ lon, lat, state: { temperature: value } }));
  return weatherRasters({ bounds: [...bounds], cols: 3, rows: 3 }, cells, 'temperature');
}
```

`EnvironmentSelectionEditor` передаёт `temperatureRasters(evaluated.points, area.bounds)` при включённой погоде и отсутствии `evaluated.error`.

`EnvironmentMapPreview` принимает `weatherRasters`, для каждого элемента создаёт `image`-источник и `raster`-слой с `raster-opacity: 0.68`, `raster-fade-duration: 0`. При обновлении используется `updateImage({ image: new ImageData(raster.pixels, raster.size, raster.size), coordinates })`; лишние слои и источники удаляются. Прежний `GeoJSONSource` и `circle` для `kshvi-weather` больше не используются. Тактические знаки остаются выше растра.

- [x] **Step 4: Повторить тест растра и тест формирования среды**

Run: `npx vitest run apps/editor/tests/kshvi-temperature-rasters.test.ts apps/editor/tests/kshvi-environment-selection.test.tsx`
Expected: PASS.

---

### Task 3: Компоновка, документация и визуальная проверка

**Files:**
- Modify: `apps/editor/src/modern/kshvi/preparation/PreparationWorkspace.tsx`
- Modify: `apps/editor/src/modern/kshvi/preparation/preparation.css`
- Modify: `docs/system.md`
- Modify: `docs/img/modern-kshvi-preparation.jpg`
- Generate: `docs/system.pdf`, `docs/system.docx`

**Interfaces:**
- Consumes: визуальное состояние Tasks 1–2.
- Produces: компактная рабочая область с картой не менее `52dvh` на широком экране.

- [x] **Step 1: Убрать повторный заголовок и увеличить рабочую карту**

В `PreparationWorkspace` блок `.preparation-step-heading` не рендерится для `environment`. В CSS:

```css
.kshvi-preparation-workspace { height: clamp(540px, calc(100dvh - 260px), 960px); }
.preparation-status { padding: 10px 20px; }
.kshvi-preparation-workspace .preparation-steps button { min-height: 44px; padding: 6px 10px; }
.kshvi-environment-map-canvas { height: clamp(360px, 52dvh, 640px); }
```

Нижняя навигация остаётся отдельной строкой grid; на узком экране сохраняется существующая адаптивная раскладка.

- [x] **Step 2: Проверить затронутые компоненты и типы**

Run: `npx vitest run apps/editor/tests/kshvi-environment-selection.test.tsx apps/editor/tests/kshvi-temperature-rasters.test.ts apps/editor/tests/kshvi-preparation-layout.test.tsx`
Run: `npm run typecheck 2>&1 | tail -3`
Expected: тесты PASS, TypeScript без ошибок.

- [x] **Step 3: Переснять только шаг «Среда»**

Playwright, `1440 × 900`, JPEG: одна область из трёх слоёв, предзаполненные общие погода и время, сплошной растр, отсутствие дублирующей кнопки и повторного заголовка. Временные серверы остановить после снимка.

- [x] **Step 4: Обновить описание и собранные документы**

В `docs/system.md` зафиксировать общую группировку областей, предзаполнение, растр и компактную компоновку. Выполнить `npm run docs:system`; проверить, что PDF и DOCX содержат новый текст, а снимок имеет размер `1440 × 900`.
