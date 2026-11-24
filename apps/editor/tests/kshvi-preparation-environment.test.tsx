// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { PreparationWorkspace } from '../src/modern/kshvi/preparation/PreparationWorkspace';

vi.mock('maplibre-gl', () => ({
  Map: class { on() {} addControl() {} remove() {} fitBounds() {} getSource() {} addSource() {} addLayer() {} },
  NavigationControl: class {},
}));

afterEach(cleanup);
const atlas = { id: 'a1', name: 'Район учения', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12, bounds: [36, 54, 38, 56], attribution: '© Источник', layers: [], bytes: 100 };
const snapshot = {
  schemaVersion: 1, id: 'a'.repeat(64), manifestSha256: 'a'.repeat(64), region: { name: atlas.name, bounds: atlas.bounds },
  atlases: [{ ...atlas, sha256: 'b'.repeat(64), license: 'Учебная', exportRights: 'ALLOWED', style: { contentRef: null, sha256: null }, export: { contentRef: null, sha256: null }, elevations: { contentRef: null, sha256: null }, meta: atlas }],
  resources: [], weather: { mode: 'scenario', contentRef: null, sourceId: 'scenario:42', attribution: 'Сценарная погода', license: 'Учебная' },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 }, autonomy: 'INCOMPLETE', limitations: [],
};
const card = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Учение', revision: 1, state: 'DRAFT', validation: 'NOT_RUN',
  revisions: [{ id: 'r1', revision: 1, payload: { intent: 'Проверка' } }], sessions: [],
};

it('подключает выбор среды к фактической подготовке и открывает исходную карту после серверной редакции', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/environment/atlases')) return Response.json([atlas]);
    if (url.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'ru-modern', version: 'v1', status: 'DRAFT', symbols: [], gaps: [] } });
    if (url.endsWith('/environment/snapshots')) return Response.json(snapshot, { status: 201 });
    if (url.endsWith(`/exercises/${card.id}/revisions`)) return Response.json({ ...card, revision: 2 }, { status: 201 });
    if (url.endsWith(`/exercises/${card.id}`)) return Response.json(card);
    throw new Error(`Неожиданный запрос ${init?.method ?? 'GET'} ${url}`);
  });
  const onRevision = vi.fn();
  render(<PreparationWorkspace client={new ExerciseClient({ fetch: fetcher })} exerciseId={card.id} revision={1} authorId="local-leader" truthRole="DIRECTOR" onRevision={onRevision} />);
  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Зафиксировать среду и открыть карту' }));

  expect(await screen.findByRole('heading', { name: 'Карта исходной обстановки' })).toBeTruthy();
  expect(screen.getAllByTitle(snapshot.id).length).toBeGreaterThan(0);
  expect(onRevision).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  const revisionRequest = requests.find(request => request.url.endsWith('/revisions'));
  expect(JSON.parse(String(revisionRequest?.init?.body))).toMatchObject({ expectedRevision: 1, payload: { intent: 'Проверка', environmentSnapshotId: snapshot.id } });
});
