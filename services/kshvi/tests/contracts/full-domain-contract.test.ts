import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '@def-ops/service-kit';
import { expect, it } from 'vitest';
import matrix from '../../../../docs/release/kshvi/functional-contract-matrix.json';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const contractMatrix = matrix as unknown as {
  total: number;
  unimplemented: string[];
  missingTests: string[];
  missingEvidence: string[];
  unexpectedIds: string[];
  requirements: { id: string; implementation: string[]; tests: string[]; evidence: string[] }[];
};
const authorities = [
  'exercise:read', 'exercise:create', 'exercise:revise', 'exercise:conduct', 'exercise:archive',
  'TRUTH_READ', 'archive.export', 'kshvi:admin',
];

function existingPath(reference: string): string {
  const path = reference.split('#')[0];
  return resolve(root, path);
}

it('связывает каждое функциональное требование с реальным доказательством', () => {
  expect(contractMatrix.total).toBe(267);
  expect(contractMatrix.unimplemented).toEqual([]);
  expect(contractMatrix.missingTests).toEqual([]);
  expect(contractMatrix.missingEvidence).toEqual([]);
  expect(contractMatrix.unexpectedIds).toEqual([]);
  for (const requirement of contractMatrix.requirements) {
    for (const reference of [...requirement.implementation, ...requirement.tests, ...requirement.evidence]) {
      expect(existsSync(existingPath(reference)), `${requirement.id}: отсутствует ${reference}`).toBe(true);
    }
    for (const reference of requirement.evidence) {
      const [path, check] = reference.split('#');
      if (!check || !path.endsWith('.ts')) continue;
      expect(readFileSync(existingPath(reference), 'utf8'), `${requirement.id}: нет проверки ${check}`).toContain(check);
    }
  }
});

it('регистрирует единый серверный контур проведения, реплея, разбора, архива, администрирования и показа', () => {
  const router = buildRouter({ sessions: new SessionManager({ store: new InMemorySessionStore() }) });
  for (const [method, path] of [
    ['POST', '/kshvi/exercises/00000000-0000-4000-8000-000000000001/sessions/00000000-0000-4000-8000-000000000002/commands'],
    ['GET', '/kshvi/exercises/00000000-0000-4000-8000-000000000001/sessions/00000000-0000-4000-8000-000000000002/projection'],
    ['GET', '/kshvi/exercises/00000000-0000-4000-8000-000000000001/sessions/00000000-0000-4000-8000-000000000002/replay'],
    ['GET', '/kshvi/exercises/00000000-0000-4000-8000-000000000001/sessions/00000000-0000-4000-8000-000000000002/debrief'],
    ['POST', '/kshvi/archives'],
    ['GET', '/kshvi/admin/overview'],
    ['GET', '/kshvi/expositions/archive-1'],
  ] as const) expect(router.match(method, path), `${method} ${path}`).not.toBeNull();
});

it('проводит SEALED-сценарий через ACTIVE, PAUSED, COMPLETED, реплей, разбор, архив и экспозицию с ролевыми проекциями', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'leader-1', username: 'leader', password: 'secret123', organizationId: 'org-1',
    roles: [{ id: 'leader-role', role: 'LEADER', sideId: null, authorities }],
  });
  await sessions.createAccount({
    userId: 'trainee-1', username: 'trainee', password: 'secret123', organizationId: 'org-1',
    roles: [{ id: 'trainee-role', role: 'TRAINEE', sideId: 'blue', authorities: ['exercise:read'] }],
  });
  const service = createService({ name: 'kshvi-full-contract', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}/kshvi`;
  async function login(username: string, roleId: string) {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { csrfToken: string };
    const roleResponse = await fetch(`${base}/auth/role`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': body.csrfToken, Cookie: response.headers.get('set-cookie')!.split(';')[0] }, body: JSON.stringify({ roleId }) });
    expect(roleResponse.status).toBe(200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: body.csrfToken };
  }
  const leader = await login('leader', 'leader-role');
  const trainee = await login('trainee', 'trainee-role');
  async function api(auth: { cookie: string; csrf: string }, method: string, path: string, body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    const createdResponse = await api(leader, 'POST', '/exercises', { title: 'Сквозное учение', purpose: 'planned', scale: 'operational', payload: { intent: 'Замысел руководства', hiddenTruth: 'Скрытый эталон' } });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string };
    const sealedResponse = await api(leader, 'POST', `/exercises/${created.id}/revisions`, { expectedRevision: 1, state: 'SEALED', readiness: 100, validation: 'OK' });
    expect(sealedResponse.status).toBe(201);
    const sessionResponse = await api(leader, 'POST', `/exercises/${created.id}/sessions`, { revision: 2, optimisticWorld: { hiddenTruth: 'Подделка клиента' } });
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json() as { id: string; state: string; confirmedRevision: number };
    expect(session).toMatchObject({ state: 'ACTIVE', confirmedRevision: 0 });
    const commandBase = `/exercises/${created.id}/sessions/${session.id}`;
    for (const [command, expectedState, expectedRevision] of [['PAUSE', 'PAUSED', 1], ['RESUME', 'ACTIVE', 2], ['COMPLETE', 'COMPLETED', 3]] as const) {
      const response = await api(leader, 'POST', `${commandBase}/commands`, { command, expectedRevision: expectedRevision - 1, idempotencyKey: `command-${expectedRevision}` });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ state: expectedState, confirmedRevision: expectedRevision, authority: 'SERVER' });
    }
    const repeated = await api(leader, 'POST', `${commandBase}/commands`, { command: 'COMPLETE', expectedRevision: 2, idempotencyKey: 'command-3' });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ state: 'COMPLETED', confirmedRevision: 3 });

    const participantProjection = await api(trainee, 'GET', `${commandBase}/projection`);
    expect(participantProjection.status).toBe(200);
    const participantBody = await participantProjection.text();
    expect(participantBody).toContain('PARTICIPANT');
    expect(participantBody).not.toContain('Скрытый эталон');
    expect((await api(trainee, 'GET', `${commandBase}/projection?perspective=TRUTH`)).status).toBe(403);
    const truthProjection = await api(leader, 'GET', `${commandBase}/projection?perspective=TRUTH`);
    expect(truthProjection.status).toBe(200);
    expect(await truthProjection.json()).toMatchObject({ perspective: 'TRUTH', session: { state: 'COMPLETED' } });

    const replay = await api(trainee, 'GET', `${commandBase}/replay?cursor=3&perspective=PARTICIPANT`);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ sequence: 3, perspective: 'PARTICIPANT', source: 'RECORDED_PARTICIPANT_PROJECTION' });
    const debrief = await api(leader, 'GET', `${commandBase}/debrief?scope=GENERAL`);
    expect(debrief.status).toBe(200);
    expect(await debrief.json()).toMatchObject({ scope: 'GENERAL', referenceIntent: 'Замысел руководства' });
    const assessmentResponse = await api(leader, 'POST', `${commandBase}/debrief/assessment`, { finalAssessment: 'Зачёт с разбором', comment: 'Оценка подтверждена человеком', idempotencyKey: 'assessment-1' });
    expect(assessmentResponse.status).toBe(200);
    expect(await assessmentResponse.json()).toMatchObject({ status: 'APPROVED', finalAssessment: 'Зачёт с разбором', finalComment: 'Оценка подтверждена человеком', confirmation: { id: 'leader-1', role: 'LEADER' } });

    const archiveResponse = await api(leader, 'POST', '/archives', { exerciseId: created.id, sessionId: session.id });
    expect(archiveResponse.status).toBe(201);
    const archive = await archiveResponse.json() as { archiveId: string; manifestSha256: string; mode: string };
    expect(archive.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(['AUTONOMOUS', 'LIMITED_RESEARCH']).toContain(archive.mode);
    const exportedArchive = await api(leader, 'GET', `/archives/${archive.archiveId}/export`);
    expect(exportedArchive.status).toBe(200);
    expect(await exportedArchive.json()).toMatchObject({ manifest: { archiveId: archive.archiveId, manifestSha256: archive.manifestSha256 } });
    const exposition = await api(leader, 'GET', `/expositions/${archive.archiveId}`);
    expect(exposition.status).toBe(200);
    const expositionBody = await exposition.json() as { purpose: string; projection: { purpose: string }; session: { sourceArchive: { manifestHash: string } } };
    expect(expositionBody.purpose).toBe('EXPOSITION');
    expect(expositionBody.projection.purpose).toBe('EXPOSITION');
    expect(expositionBody.session.sourceArchive.manifestHash).toBe(archive.manifestSha256);
    expect((await api(leader, 'GET', '/admin/overview')).status).toBe(200);
  } finally {
    await service.close();
  }
});
