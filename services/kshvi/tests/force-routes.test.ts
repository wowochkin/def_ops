import { createHash } from 'node:crypto';
import { modernCorpus } from '@def-ops/knowledge';
import { createService } from '@def-ops/service-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { buildForceRouter, MemoryModernImportStore } from '../src/http/force-routes';
import { buildRouter } from '../src/app';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

function sourceFor(record: object & { id: string }, recordKind: 'REPRESENTATIVE' | 'UNIT' | 'HIERARCHY') {
  return {
    sourceRecordId: record.id,
    sourceRevision: 1,
    sourceHash: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
    recordKind,
    modelInputs: false as const,
    simulationValidated: false as const,
    characteristics: [],
  };
}

async function fixture() {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'director-1', username: 'director', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'director-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise'] }],
  });
  await sessions.createAccount({
    userId: 'red-1', username: 'red', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'red-role', role: 'TRAINEE', sideId: 'red', authorities: ['exercise:read'] }],
  });
  await sessions.createAccount({
    userId: 'outsider-1', username: 'outsider', password: 'secret123', organizationId: 'org2',
    roles: [{ id: 'outsider-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise'] }],
  });
  const director = await sessions.login('director', 'secret123');
  const red = await sessions.login('red', 'secret123');
  const outsider = await sessions.login('outsider', 'secret123');
  await sessions.selectRole(director.token, 'director-role');
  await sessions.selectRole(red.token, 'red-role');
  await sessions.selectRole(outsider.token, 'outsider-role');
  const hierarchy = modernCorpus.hierarchyTemplates.find(item => item.levels.length > 0)!;
  const unit = {
    id: 'unit-test', country: hierarchy.country, title: 'Учебное формирование', hierarchyTemplate: hierarchy.id,
    level: hierarchy.levels[0].id, classifications: [], sources: [...hierarchy.sources],
  };
  const store = new MemoryModernImportStore({ ...modernCorpus, units: [unit] });
  const service = createService({ name: 'kshvi-force-test', port: 0, router: buildForceRouter(store, sessions) });
  const port = await service.listen();
  closers.push(service.close);
  const base = `http://127.0.0.1:${port}/kshvi/forces/import`;
  const call = async (init: RequestInit = {}, token = director) => fetch(base + (init.method ? '' : '?sideId=blue'), {
    ...init,
    headers: {
      Authorization: `Bearer ${token.token}`,
      'X-CSRF-Token': token.csrfToken,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const input = (record: object & { id: string }, kind: 'REPRESENTATIVE' | 'UNIT' | 'HIERARCHY' = 'REPRESENTATIVE') => ({
    source: sourceFor(record, kind), sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [],
  });
  return { call, input, director, red, outsider, unit };
}

describe('серверный импорт сил', () => {
  it('не принимает импорт без аутентифицированной сессии', async () => {
    const { input } = await fixture();
    const store = new MemoryModernImportStore();
    const service = createService({ name: 'kshvi-force-anonymous-test', port: 0, router: buildForceRouter(store) });
    const port = await service.listen();
    closers.push(service.close);
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/forces/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input(modernCorpus.representatives[0])),
    });
    expect(response.status).toBe(401);
  });

  it('сверяет SHA-256 с серверным корпусом и сохраняет предпросмотр независимой копии', async () => {
    const { call, input } = await fixture();
    const record = modernCorpus.representatives[0];
    const forged = input(record);
    forged.source.sourceHash = '0'.repeat(64);
    const rejected = await call({ method: 'POST', body: JSON.stringify(forged) });
    expect(rejected.status).toBe(422);

    const response = await call({ method: 'POST', body: JSON.stringify(input(record)) });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      sourceRecordId: record.id,
      recordKind: 'REPRESENTATIVE',
      sideId: 'blue',
      sourceRecord: { id: record.id },
      status: 'IMPORTED',
      modelInputs: false,
      simulationValidated: false,
    });
    expect(created.preview.sources.length).toBeGreaterThan(0);
    expect(created.preview.equipment.length).toBeGreaterThan(0);
  });

  it('поддерживает ModernUnit и HierarchyTemplate с деревом и источниками', async () => {
    const { call, input, unit } = await fixture();
    for (const [record, recordKind] of [
      [unit, 'UNIT'],
      [modernCorpus.hierarchyTemplates[0], 'HIERARCHY'],
    ] as const) {
      const response = await call({ method: 'POST', body: JSON.stringify(input(record, recordKind)) });
      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.recordKind).toBe(recordKind);
      expect(created.preview.tree.length).toBeGreaterThan(0);
      expect(created.preview.sources.length).toBeGreaterThan(0);
    }
  });

  it('изолирует сохранённые копии по организации и не принимает сторону из query', async () => {
    const { call, input, red, outsider } = await fixture();
    const created = await call({ method: 'POST', body: JSON.stringify(input(modernCorpus.representatives[0])) });
    expect(created.status).toBe(201);

    const foreign = await call({}, outsider);
    expect(await foreign.json()).toEqual([]);
    const otherSide = await call({}, red);
    expect(await otherSide.json()).toEqual([]);
  });
});


it('основной роутер пропускает авторизованный импорт сил', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'main-director', username: 'main-director', password: 'secret123', organizationId: 'org-main',
    roles: [{ id: 'main-director-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise'] }],
  });
  const director = await sessions.login('main-director', 'secret123');
  await sessions.selectRole(director.token, 'main-director-role');
  const service = createService({ name: 'kshvi-main-force-test', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  closers.push(service.close);
  const response = await fetch(`http://127.0.0.1:${port}/kshvi/forces/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${director.token}`, 'X-CSRF-Token': director.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: sourceFor(modernCorpus.representatives[0], 'REPRESENTATIVE'), sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [] }),
  });
  expect(response.status, await response.text()).toBe(201);
});
