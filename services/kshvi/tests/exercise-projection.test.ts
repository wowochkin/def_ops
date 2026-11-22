import { createService, Router } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { registerExerciseRoutes } from '../src/http/exercise-routes';
import { InMemoryExerciseStore, type ExerciseCard } from '../src/store/exercise-store';
import { projectExerciseCard } from '../src/store/exercise-projection';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

it('проецирует карточку по роли и стороне и отклоняет клиентские состояния', async () => {
  const organizationId = 'org1';
  const store = new InMemoryExerciseStore();
  const exercise = await store.create(
    { organizationId, userId: 'director-1' },
    {
      title: 'Секретное учение', purpose: 'planned', scale: 'operational',
      payload: {
        concept: { generalSituation: 'Общая обстановка', fullIntent: 'ПОЛНЫЙ ЗАМЫСЕЛ', referenceData: 'СЛУЖЕБНАЯ СПРАВКА' },
        operationalAssignments: [
          { nodeId: 'blue-node', sideId: 'blue', generalSituation: 'Разрешено blue', privateSituation: 'Сведения blue', referenceData: 'Справка blue', task: 'Задача blue' },
          { nodeId: 'red-node', sideId: 'red', generalSituation: 'Разрешено red', privateSituation: 'Сведения red', referenceData: 'Справка red', task: 'Задача red' },
        ],
      },
    },
  );
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'director-1', username: 'director', password: 'secret123', organizationId,
    roles: [{ id: 'director-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'exercise:conduct', 'TRUTH_READ'] }],
  });
  await sessions.createAccount({
    userId: 'blue-1', username: 'blue', password: 'secret123', organizationId,
    roles: [{ id: 'blue-role', role: 'TRAINEE', sideId: 'blue', authorities: ['exercise:read'] }],
  });
  const director = await sessions.login('director', 'secret123');
  const blue = await sessions.login('blue', 'secret123');
  await sessions.selectRole(director.token, 'director-role');
  await sessions.selectRole(blue.token, 'blue-role');
  const router = new Router();
  registerExerciseRoutes(router, { store, sessions });
  const service = createService({ name: 'kshvi-exercise-projection-test', version: '0', port: 0, router });
  const port = await service.listen();
  closers.push(service.close);
  const base = `http://127.0.0.1:${port}/kshvi/exercises/${exercise.id}`;
  const get = async (path = '', token = blue) => {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token.token}` } });
    return { response, body: await response.json() };
  };

  const truth = await get('', director);
  expect(JSON.stringify(truth.body)).toContain('ПОЛНЫЙ ЗАМЫСЕЛ');
  const participant = await get();
  expect(participant.response.status).toBe(200);
  expect(JSON.stringify(participant.body)).toContain('Задача blue');
  expect(JSON.stringify(participant.body)).not.toContain('ПОЛНЫЙ ЗАМЫСЕЛ');
  expect(JSON.stringify(participant.body)).not.toContain('СЛУЖЕБНАЯ СПРАВКА');
  expect(JSON.stringify(participant.body)).not.toContain('Задача red');
  expect(JSON.stringify(participant.body)).not.toContain('referenceData');
  const revisions = await get('/revisions');
  expect(JSON.stringify(revisions.body)).toContain('Задача blue');
  expect(JSON.stringify(revisions.body)).not.toContain('Задача red');

  const forged = await fetch(`${base}/revisions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${director.token}`, 'X-CSRF-Token': director.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1, state: 'SEALED', readiness: 100, validation: 'OK' }),
  });
  expect(forged.status).toBe(422);
  expect((await forged.json()).error.code).toBe('server_assessment_required');
  const active = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${director.token}`, 'X-CSRF-Token': director.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 1, state: 'ACTIVE' }),
  });
  expect(active.status).toBe(409);
  expect((await active.json()).error.code).toBe('sealed_required');
});

it('не отдаёт участнику sealed artifact и полный сценарий редакции', async () => {
  const store = new InMemoryExerciseStore();
  const created = await store.create({ organizationId: 'org1', userId: 'author' }, {
    title: 'Скрытый artifact', purpose: 'planned', scale: 'operational', payload: { title: 'Учение' },
  });
  const card: ExerciseCard = {
    ...created,
    revisions: [{
      ...created.revisions[0],
      sealedArtifact: { scenario: { hiddenTruth: 'СЕКРЕТНЫЙ СЦЕНАРИЙ' } } as ExerciseCard['revisions'][number]['sealedArtifact'],
    }],
  };
  const projected = projectExerciseCard(card, {
    organizationId: 'org1', userId: 'trainee', activeRole: 'TRAINEE', sideId: 'blue', authorities: ['exercise:read'],
  });
  expect(JSON.stringify(projected)).not.toContain('СЕКРЕТНЫЙ СЦЕНАРИЙ');
  expect(JSON.stringify(projected)).not.toContain('sealedArtifact');
  const directorWithoutTruth = projectExerciseCard(card, {
    organizationId: 'org1', userId: 'director', activeRole: 'DIRECTOR', sideId: null, authorities: ['exercise:read'],
  });
  expect(JSON.stringify(directorWithoutTruth)).not.toContain('СЕКРЕТНЫЙ СЦЕНАРИЙ');
  expect(JSON.stringify(directorWithoutTruth)).not.toContain('sealedArtifact');
});
