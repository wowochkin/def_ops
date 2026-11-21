import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { CalculationJournal, buildCalculationRouter, type CalculationActor } from '../src/http/calculation-routes';
import type { CalculateOptions } from '../../../packages/kshvi/src/simulation/calculation';

const actor: CalculationActor = { userId: 'leader-1', organizationId: 'org-1', authorities: ['calculation:create', 'calculation:approve', 'calculation:apply', 'calculation:override'] };
const passport = {
  purpose: 'Ручной расчёт', limitations: ['Только учение'], source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение', applicability: 'G2' },
  knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1,
};
const input = {
  mode: 'MANUAL', reason: 'Методическое решение по эпизоду', createdAt: '2030-01-01T00:00:00Z', inputSnapshot: { revision: 4 },
  inputs: { note: 'Исход задан руководством' }, requiredInputs: [], units: { delay: 'min' }, modelVersion: 'manual-v1', profileVersions: { manual: 'v1' }, modelPassport: passport,
  manual: { author: 'leader-1', reason: 'Отдельное основание ручного исхода', result: { delay: 10 } },
} satisfies Omit<CalculateOptions, 'id'>;

async function withServer(run: (baseUrl: string, journal: CalculationJournal) => Promise<void>, currentActor: CalculationActor = actor) {
  const journal = new CalculationJournal({ idFactory: (() => { let n = 0; return () => `calc-${++n}`; })() });
  const service = createService({ name: 'calculation-test', port: 0, router: buildCalculationRouter(journal, () => currentActor) });
  const port = await service.listen();
  try { await run(`http://127.0.0.1:${port}`, journal); } finally { await service.close(); }
}

async function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

it('ведёт HTTP-журнал CALCULATED → APPROVED → APPLIED с идемпотентным созданием', async () => {
  await withServer(async (baseUrl, journal) => {
    const first = await post(baseUrl, '/kshvi/calculations', { ...input, idempotencyKey: 'cmd-calc-1', actor: { userId: 'attacker', authorities: ['calculation:approve'] } });
    expect(first.status).toBe(200);
    const created = await first.json() as { calculation: { id: string; state: string; createdBy: string }; idempotent: boolean };
    expect(created.calculation.state).toBe('CALCULATED');
    expect(created.calculation.createdBy).toBe('leader-1');
    expect(created.idempotent).toBe(false);
    const repeat = await post(baseUrl, '/kshvi/calculations', { ...input, idempotencyKey: 'cmd-calc-1' });
    const repeated = await repeat.json() as { calculation: { id: string; state: string; mode: string; result: unknown; createdBy: string }; idempotent: boolean };
    expect(repeated.idempotent).toBe(true);
    expect(repeated.calculation).toEqual(created.calculation);
    const approved = await post(baseUrl, `/kshvi/calculations/${created.calculation.id}/approve`, { reason: 'Проверено' });
    expect((await approved.json() as { state: string }).state).toBe('APPROVED');
    const applied = await post(baseUrl, `/kshvi/calculations/${created.calculation.id}/apply`, { appliedEventIds: ['event-1'] });
    expect((await applied.json() as { state: string; appliedEventIds: string[] })).toMatchObject({ state: 'APPLIED', appliedEventIds: ['event-1'] });
    expect(journal.size).toBe(1);
  });
});

it('ручная HTTP-замена сохраняет исходный результат и помечает его SUPERSEDED', async () => {
  await withServer(async (baseUrl, journal) => {
    await post(baseUrl, '/kshvi/calculations', { ...input, idempotencyKey: 'cmd-calc-original' });
    const overridden = await post(baseUrl, '/kshvi/calculations/calc-1/override', { reason: 'Новое методическое решение', result: { delay: 15 }, createdAt: '2030-01-01T01:00:00Z' });
    expect(overridden.status).toBe(200);
    expect(await overridden.json()).toMatchObject({ id: 'calc-2', mode: 'MANUAL', supersedes: 'calc-1', result: { delay: 15 }, originalResult: { delay: 10 } });
    expect(journal.get('calc-1', actor.organizationId)).toMatchObject({ state: 'SUPERSEDED', result: { delay: 10 } });
    expect(journal.get('calc-2', actor.organizationId)).toMatchObject({ state: 'CALCULATED', evaluationEffect: 'UNCHANGED' });
    expect(journal.history('calc-1', actor.organizationId)).toHaveLength(2);
  });
});

it('не принимает полномочие из тела и не раскрывает расчёт другой организации', async () => {
  await withServer(async baseUrl => {
    const denied = await post(baseUrl, '/kshvi/calculations', { ...input, idempotencyKey: 'denied' });
    expect(denied.status).toBe(403);
  }, { ...actor, authorities: [] });
  let currentActor = { ...actor };
  const journal = new CalculationJournal({ idFactory: () => 'calc-1' });
  const service = createService({ name: 'calculation-isolation-test', port: 0, router: buildCalculationRouter(journal, () => currentActor) });
  const port = await service.listen();
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await post(baseUrl, '/kshvi/calculations', { ...input, idempotencyKey: 'org-1-calc' });
    currentActor = { ...actor, organizationId: 'org-2' };
    const response = await fetch(`${baseUrl}/kshvi/calculations/calc-1`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('delay');
  } finally { await service.close(); }
});


it('не перезаписывает прежний расчёт при коллизии идентификатора', () => {
  const journal = new CalculationJournal({ idFactory: () => 'calc-collision' });
  journal.create(input, actor, 'create-first');
  expect(() => journal.create({ ...input, reason: 'Другой расчёт' }, actor, 'create-second')).toThrow('уже использован');
  expect(journal.get('calc-collision', actor.organizationId).reason).toBe(input.reason);
  expect(journal.history('calc-collision', actor.organizationId)).toHaveLength(1);
});

it('не затирает исходный расчёт при коллизии ID ручной замены', () => {
  const journal = new CalculationJournal({ idFactory: () => 'calc-collision' });
  journal.create(input, actor, 'create-original');
  expect(() => journal.override('calc-collision', actor, { reason: 'Замена', result: { delay: 15 }, createdAt: '2030-01-01T02:00:00Z' })).toThrow('уже использован');
  expect(journal.get('calc-collision', actor.organizationId)).toMatchObject({ state: 'CALCULATED', result: { delay: 10 } });
  expect(journal.history('calc-collision', actor.organizationId)).toHaveLength(1);
});
