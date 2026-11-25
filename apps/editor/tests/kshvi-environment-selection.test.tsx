// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import { afterEach, expect, it } from 'vitest';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';
import { ExercisePreparation } from '../src/modern/kshvi/preparation/PreparationWorkspace';
import { emptyPreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { REGIONAL_CLIMATE_PROFILE } from '../../../packages/core/src/weather-climate-profile';

afterEach(() => { cleanup(); localStorage.clear(); });

const now = '2030-01-01T10:00:00Z';
const atlas = {
  id: 'base', name: 'Топооснова', format: 'pbf', kind: 'vector', minzoom: 4, maxzoom: 14, bounds: [1, 2, 3, 4],
  attribution: 'Источник карты', layers: [], bytes: 100,
};
const terrain = { ...atlas, id: 'terrain', name: 'Рельеф региона', kind: 'terrain', format: 'png' };
const landcover = { ...atlas, id: 'cover', name: 'Покров региона', kind: 'raster', format: 'png' };
const snapshotId = 'a'.repeat(64);
const artifact = { contentRef: null, sha256: null };
const snapshot = {
  schemaVersion: 1, id: snapshotId, manifestSha256: snapshotId, region: { name: atlas.name, bounds: atlas.bounds },
  atlases: [atlas, terrain, landcover].map(meta => ({ id: meta.id, meta, sha256: 'b'.repeat(64), attribution: meta.attribution,
    license: 'Учебная', exportRights: 'ALLOWED', style: artifact, export: artifact, elevations: artifact })),
  weather: { mode: 'scenario', sourceId: 'weather', attribution: 'Сценарная погода', license: 'Учебная', contentRef: null },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
  resources: [], autonomy: 'COMPLETE', limitations: [],
};
const initial: ExerciseCard = {
  id: 'exercise', title: 'Учение', revision: 1, state: 'DRAFT', validation: 'NOT_RUN', payloadAccess: 'FULL',
  purpose: 'planned', scale: 'operational', ownerId: 'author', startsAt: now, endsAt: null, readiness: 0,
  createdAt: now, updatedAt: now, archivedAt: null, lastSessionId: null, sessions: [],
  revisions: [{ id: 'r1', exerciseId: 'exercise', revision: 1, sha256: 'b'.repeat(64), supersedesId: null,
    state: 'DRAFT', createdBy: 'author', createdAt: now,
    payload: { intent: 'Сохраняемый замысел', preparation: JSON.parse(JSON.stringify(emptyPreparationDraft(now))) } }],
};

it('отправляет все отмеченные наборы и связывает снимок с вложенным черновиком', async () => {
  localStorage.setItem('def_ops.modern.weather.region', JSON.stringify({ bounds: atlas.bounds, cols: 3, rows: 3 }));
  localStorage.setItem('def_ops.modern.weather.scenario', JSON.stringify({
    version: 1, algorithmVersion: 2, climateProfileId: REGIONAL_CLIMATE_PROFILE.id, climateProfileSha256: REGIONAL_CLIMATE_PROFILE.sha256,
    seed: 73, start: '2032-03-04T05:06:00Z', temperatureMode: 'climate', manualFields: [], temperature: 15, humidity: 65,
    pressure: 1013, windSpeed: 4, windDirection: 270, cloud: 40, precipitation: 0, variability: 1, transitionHours: 3, durationHours: 24,
  }));
  localStorage.setItem('def_ops.modern.atlas.regionStates', JSON.stringify({
    [atlas.bounds.map(value => value.toFixed(6)).join(',')]: { selected: ['base', 'terrain', 'cover'], disabled: [], terrainId: 'terrain' },
  }));
  const calls: { path: string; body: unknown }[] = [];
  let current = initial;
  const client = new ExerciseClient({ fetch: async (input, init) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body ?? 'null'));
    calls.push({ path, body });
    if (path.endsWith('/environment/atlases')) return Response.json([atlas, terrain, landcover]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'symbols', status: 'DRAFT', symbols: [] } });
    if (path.endsWith('/environment/snapshots')) return Response.json(snapshot);
    if (path.endsWith('/environment/weather')) return Response.json([]);
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (path.endsWith('/exercise/preparation')) {
      current = { ...initial, revision: 2, revisions: [...initial.revisions,
        { ...initial.revisions[0]!, id: 'r2', revision: 2, payload: { intent: 'Сохраняемый замысел', preparation: body.draft } }] };
      return Response.json(current);
    }
    if (path.endsWith('/exercise')) return Response.json(current);
    if (path.endsWith(snapshotId)) return Response.json(snapshot);
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<ExercisePreparation client={client} card={initial} role="AUTHOR" initialStep="environment"
    canRevise canStart={false} onCard={() => {}} onAccessLost={() => {}} onStart={() => {}} />);
  const areaSelect = await screen.findByLabelText<HTMLSelectElement>('Подготовленная область');
  expect(within(areaSelect).getAllByRole('option')).toHaveLength(1);
  expect(screen.getByLabelText<HTMLInputElement>('Зерно погодного сценария').value).toBe('73');
  expect(document.querySelector<HTMLInputElement>('#kshvi-weather-start + input')?.value).toBe('2032-03-04T05:06');
  expect(screen.queryByRole('button', { name: 'Выбрать подготовленную область' })).toBeNull();
  const prepare = await screen.findByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  expect(prepare.compareDocumentPosition(areaSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);
  fireEvent.click(await screen.findByRole('button', { name: 'Зафиксировать среду' }));
  expect(await screen.findByText(/Снимок среды сохранён/)).toBeTruthy();
  expect(calls.find(call => call.path.endsWith('/environment/snapshots'))?.body).toMatchObject({
    atlases: [{ id: 'base' }, { id: 'terrain' }, { id: 'cover' }],
  });
  expect(calls.find(call => call.path.endsWith('/exercise/preparation'))?.body).toMatchObject({
    expectedRevision: 1, draft: { environmentSnapshotId: snapshotId },
  });
  expect(calls.some(call => call.path.endsWith('/revisions'))).toBe(false);
});

it('загружает снимок из вложенной ссылки при повторном открытии', async () => {
  const card: ExerciseCard = { ...initial, revisions: [{ ...initial.revisions[0]!,
    payload: { preparation: JSON.parse(JSON.stringify({ ...emptyPreparationDraft(now), environmentSnapshotId: snapshotId })) } }] };
  const client = new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith(snapshotId)) return Response.json(snapshot);
    if (path.endsWith('/environment/atlases')) return Response.json([atlas, terrain, landcover]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'symbols', status: 'DRAFT', symbols: [] } });
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<ExercisePreparation client={client} card={card} role="AUTHOR" initialStep="environment"
    canRevise canStart={false} onCard={() => {}} onAccessLost={() => {}} onStart={() => {}} />);
  expect(await screen.findByText(snapshotId)).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Наборы снимка' }).textContent).toContain('Покров региона');
});

it('сохраняет источники, source-layer, glyphs, sprite и ссылку terrain', async () => {
  const modules = import.meta.glob<{ mergeSnapshotStyles(styles: readonly StyleSpecification[]): StyleSpecification }>(
    '../src/modern/kshvi/preparation/snapshot-map-style.ts', { eager: true },
  );
  const mergeSnapshotStyles = Object.values(modules)[0]?.mergeSnapshotStyles;
  expect(mergeSnapshotStyles).toBeTypeOf('function');
  if (!mergeSnapshotStyles) return;
  const base: StyleSpecification = {
    version: 8, glyphs: '/fonts/{fontstack}/{range}.pbf', sprite: '/sprites/main',
    sources: { atlas: { type: 'vector', tiles: ['/base/{z}/{x}/{y}'] } },
    layers: [{ id: 'labels', type: 'symbol', source: 'atlas', 'source-layer': 'labels', layout: { 'icon-image': 'point' } }],
  };
  const elevation: StyleSpecification = {
    version: 8, sources: { atlas: { type: 'raster-dem', tiles: ['/dem/{z}/{x}/{y}'] } },
    terrain: { source: 'atlas', exaggeration: 1 },
    layers: [{ id: 'shade', type: 'hillshade', source: 'atlas' }],
  };
  const merged = mergeSnapshotStyles([base, elevation]);
  expect(merged.glyphs).toBe(base.glyphs);
  expect(merged.sprite).toBe(base.sprite);
  expect(merged.layers).toContainEqual({ ...base.layers[0], id: 'snapshot-0-labels', source: 'snapshot-0-atlas' });
  expect(merged.terrain).toEqual({ source: 'snapshot-1-atlas', exaggeration: 1 });
  expect(Object.keys(merged.sources)).toEqual(['snapshot-0-atlas', 'snapshot-1-atlas']);
  expect(base.layers[0]).toMatchObject({ id: 'labels', source: 'atlas' });
  expect(() => mergeSnapshotStyles([base, { ...base, glyphs: '/other/{fontstack}/{range}.pbf' }])).toThrow(/шрифт/i);
});

it('показывает последствия смены SEALED до фиксации и использует отдельную команду редакции', async () => {
  const sealed: ExerciseCard = {
    ...initial, state: 'SEALED', revisions: [{ ...initial.revisions[0]!, state: 'SEALED', payload: { environmentSnapshotId: snapshotId } }],
  };
  const nextId = 'c'.repeat(64);
  const calls: string[] = [];
  const client = new ExerciseClient({ fetch: async (input, init) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith('/environment/atlases')) return Response.json([atlas, terrain, landcover]);
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (path.endsWith(snapshotId)) return Response.json(snapshot);
    if (path.endsWith('/exercise')) return Response.json(sealed);
    if (path.endsWith('/environment-impact')) return Response.json({
      objects: [{ kind: 'Объект исходной карты', id: 'saved-object', outside: true }],
      confirmations: [{ id: 'confirmation-id', area: 'ENVIRONMENT_MAP' }],
      missingForceIds: [], missingInstanceIds: [],
    });
    if (path.endsWith('/environment/snapshots')) return Response.json({ ...snapshot, id: nextId, manifestSha256: nextId });
    if (path.endsWith('/environment-revisions')) {
      expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 1, snapshotId: nextId });
      return Response.json({ ...sealed, state: 'DRAFT', revision: 2 });
    }
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<ExercisePreparation client={client} card={sealed} role="DIRECTOR" initialStep="environment"
    canRevise canReadTruth canStart onCard={() => {}} onAccessLost={() => {}} onStart={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Сменить среду' }));
  fireEvent.change(screen.getByLabelText('Зерно погодного сценария'), { target: { value: 73 } });
  const prepare = screen.getByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);
  const fix = await screen.findByRole('button', { name: 'Зафиксировать среду' });
  expect(screen.getByText(/saved-object.*вне новой рамки/)).toBeTruthy();
  expect(screen.getByText(/Устареют подтверждения/)).toBeTruthy();
  expect(calls.some(path => path.endsWith('/environment-revisions'))).toBe(false);
  fireEvent.click(fix);
  expect(await screen.findByText(/Снимок среды сохранён/)).toBeTruthy();
  expect(calls.some(path => path.endsWith('/preparation'))).toBe(false);
});
