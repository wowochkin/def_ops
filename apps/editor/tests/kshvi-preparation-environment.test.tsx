// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { ExercisePreparation } from '../src/modern/kshvi/preparation/PreparationWorkspace';
import { useState } from 'react';
import type { ExerciseCard } from '../src/modern/kshvi/kshvi-api';

vi.mock('maplibre-gl', () => ({
  Map: class { on() {} addControl() {} remove() {} fitBounds() {} getSource() {} addSource() {} addLayer() {} },
  NavigationControl: class {},
}));

afterEach(cleanup);
const atlas = { id: 'a1', name: 'Район учения', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12, bounds: [36, 54, 38, 56], attribution: '© Источник', layers: [], bytes: 100 };
const snapshot = {
  schemaVersion: 1, id: 'a'.repeat(64), manifestSha256: 'a'.repeat(64), region: { name: atlas.name, bounds: atlas.bounds },
  atlases: [{ ...atlas, sha256: 'b'.repeat(64), license: 'Учебная', exportRights: 'ALLOWED', style: { contentRef: null, sha256: null }, export: { contentRef: null, sha256: null }, elevations: { contentRef: null, sha256: null }, meta: atlas }],
  resources: [], operationalTime: { operationalAt: '2030-01-01T10:00:00Z', timeZone: 'UTC' },
  weather: { mode: 'scenario', contentRef: null, sourceId: 'scenario:42', attribution: 'Сценарная погода', license: 'Учебная' },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 }, autonomy: 'INCOMPLETE', limitations: [],
};
const now = '2030-01-01T10:00:00Z';
const card: ExerciseCard = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Учение', revision: 1, payloadAccess: 'FULL', state: 'DRAFT', validation: 'NOT_RUN',
  ownerId: 'author', purpose: 'planned', scale: 'operational', readiness: 0, updatedAt: now, createdAt: now, archivedAt: null,
  lastSessionId: null, startsAt: now, endsAt: null,
  revisions: [{ id: 'r1', exerciseId: '11111111-1111-4111-8111-111111111111', revision: 1, payload: { intent: 'Проверка' },
    createdAt: now, createdBy: 'author', sha256: 'b'.repeat(64), state: 'DRAFT', supersedesId: null }], sessions: [],
};

it('подключает выбор среды к фактической подготовке и открывает исходную карту после серверной редакции', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/environment/atlases')) return Response.json([atlas]);
    if (url.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'ru-modern', version: 'v1', status: 'DRAFT', symbols: [], gaps: [] } });
    if (url.endsWith('/environment/snapshots')) return Response.json(snapshot, { status: 201 });
    if (url.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (url.endsWith(snapshot.id)) return Response.json(snapshot);
    if (url.endsWith(`/exercises/${card.id}/preparation`)) return Response.json({ ...card, revision: 2,
      revisions: [...card.revisions, { ...card.revisions[0]!, id: 'r2', revision: 2,
        payload: { intent: 'Проверка', preparation: JSON.parse(String(init?.body)).draft } }],
    }, { status: 201 });
    if (url.endsWith(`/exercises/${card.id}`)) return Response.json(card);
    throw new Error(`Неожиданный запрос ${init?.method ?? 'GET'} ${url}`);
  });
  const onRevision = vi.fn();
  const client = new ExerciseClient({ fetch: fetcher });
  function Workspace() {
    const [confirmed, confirm] = useState(card);
    return <ExercisePreparation client={client} card={confirmed} role="DIRECTOR" initialStep="environment" canRevise canStart={false}
      onCard={value => { onRevision(value); confirm(value); }} onAccessLost={() => {}} onStart={() => {}} />;
  }
  render(<Workspace />);
  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
  const prepare = await screen.findByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);
  fireEvent.click(await screen.findByRole('button', { name: 'Зафиксировать среду' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть исходную обстановку' }));

  expect(await screen.findByRole('heading', { name: 'Карта исходной обстановки' })).toBeTruthy();
  expect(screen.getAllByTitle(snapshot.id).length).toBeGreaterThan(0);
  expect(onRevision).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  const revisionRequest = requests.find(request => request.url.endsWith('/preparation'));
  expect(JSON.parse(String(revisionRequest?.init?.body))).toMatchObject({ expectedRevision: 1, draft: { environmentSnapshotId: snapshot.id } });
});
