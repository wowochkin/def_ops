import { expect, it } from 'vitest';
import { MemoryModernImportStore } from '../src/http/force-routes';

it('сохраняет независимые сценарные копии через серверное хранилище', async () => {
  const store = new MemoryModernImportStore();
  const input = {
    source: { sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'a'.repeat(64), modelInputs: false, simulationValidated: false, characteristics: [] },
    sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [],
  } as const;
  const first = await store.import(input);
  const second = await store.import(input);
  expect(first.id).not.toBe(second.id);
  expect(await store.list('blue')).toHaveLength(2);
});


it('принимает импорт через HTTP и возвращает только сценарные копии', async () => {
  const { createService } = await import('@def-ops/service-kit');
  const { buildForceRouter } = await import('../src/http/force-routes');
  const store = new MemoryModernImportStore();
  const service = createService({ name: 'kshvi-test', port: 0, router: buildForceRouter(store) });
  const port = await service.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/forces/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'a'.repeat(64), modelInputs: false, simulationValidated: false, characteristics: [] }, sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [] }),
    });
    expect(response.status).toBe(200);
    const created = await response.json() as { id: string; sourceRecordId: string };
    expect(created.sourceRecordId).toBe('unit-1');
    const list = await fetch(`http://127.0.0.1:${port}/kshvi/forces/import?sideId=blue`);
    expect(await list.json()).toHaveLength(1);
  } finally {
    await service.close();
  }
});
