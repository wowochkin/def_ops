import { createService, Router } from '@def-ops/service-kit';
import { READINESS_AREAS, type InitialSituationMapModel, type JsonValue } from '@def-ops/kshvi';
import { expect, it } from 'vitest';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { registerExerciseRoutes } from '../src/http/exercise-routes';
import { InMemoryExerciseEvidenceService } from '../src/store/exercise-evidence-service';
import { InMemoryExerciseStore, type ExerciseSealActor } from '../src/store/exercise-store';
import { linkedExercisePayload, SEAL_HASH_A, SEAL_HASH_B, validExerciseSealInput } from './helpers/full-seal';
import { rehearsalProfile } from './helpers/rehearsal-profile';
import type { EnvironmentSnapshot } from '../../../packages/kshvi/src/environment/provider';

const director: ExerciseSealActor = { organizationId: 'org-routes', userId: 'director', activeRole: 'DIRECTOR', authorities: ['scenario.seal'] };
const environment = {
  schemaVersion: 1, id: SEAL_HASH_A, manifestSha256: SEAL_HASH_A, region: { name: 'Область', bounds: [0, 0, 1, 1] },
  atlases: [{
    meta: { id: 'atlas', bounds: [0, 0, 1, 1], attribution: 'Атлас' }, id: 'atlas', sha256: SEAL_HASH_B,
    attribution: 'Атлас', license: 'Учебная', exportRights: 'ALLOWED',
    style: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    export: { contentRef: { path: `content/${SEAL_HASH_B}.mbtiles`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    elevations: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
  }], resources: [],
  weather: { mode: 'scenario', contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sourceId: 'scenario', attribution: 'Погода', license: 'Учебная' },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 }, autonomy: 'COMPLETE', limitations: [],
} as unknown as EnvironmentSnapshot;

it('HTTP выполняет утверждение карты и персональные подтверждения перед seal', async () => {
  const evidence = new InMemoryExerciseEvidenceService({ environment: { load: async () => environment } });
  const store = new InMemoryExerciseStore({ evidence });
  const created = await store.create(director, { title: 'HTTP evidence', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  const { sha256: _hash, ...mapContent } = validExerciseSealInput(created).initialMap!;
  const rawMap = { ...mapContent, environment: { ...mapContent.environment, snapshotId: SEAL_HASH_A }, state: 'DRAFT' } as InitialSituationMapModel;
  const card = await store.createRevision(director, created.id, {
    expectedRevision: 1, payload: linkedExercisePayload({ initialMap: rawMap as unknown as JsonValue, environmentSnapshotId: SEAL_HASH_A, rehearsalProfile: rehearsalProfile() as unknown as JsonValue }),
  });

  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  const confirmations = READINESS_AREAS.flatMap(area => ['readiness.confirm', `readiness.confirm:${area}`]);
  await sessions.createAccount({
    userId: director.userId, username: 'director', password: 'secret123', organizationId: director.organizationId,
    roles: [
      { id: 'author', role: 'AUTHOR', sideId: null, authorities: ['exercise:revise'] },
      { id: 'approver', role: 'APPROVER', sideId: null, authorities: ['exercise:revise', 'initialMap.approve'] },
      { id: 'responsible', role: 'RESPONSIBLE', sideId: null, authorities: confirmations },
      { id: 'director-role', role: 'DIRECTOR', sideId: null, authorities: ['scenario.seal'] },
    ],
  });
  const login = await sessions.login('director', 'secret123');
  const router = new Router();
  registerExerciseRoutes(router, { store, sessions, evidence });
  const service = createService({ name: 'kshvi-evidence-routes-test', version: '0', port: 0, router });
  const port = await service.listen();
  try {
    const call = async (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}/kshvi/exercises/${created.id}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'X-CSRF-Token': login.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await sessions.selectRole(login.token, 'author');
    expect((await call('/transitions', { expectedRevision: 2, command: 'SUBMIT' })).status).toBe(200);
    await sessions.selectRole(login.token, 'approver');
    expect((await call('/transitions', { expectedRevision: 2, command: 'APPROVE' })).status).toBe(200);
    expect((await call('/map-approval', { expectedRevision: 2, map: rawMap })).status).toBe(200);
    await sessions.selectRole(login.token, 'responsible');
    for (const area of READINESS_AREAS) expect((await call('/confirmations', { expectedRevision: 2, area })).status).toBe(200);
    await sessions.selectRole(login.token, 'director-role');
    const sealed = await call('/seal', { expectedRevision: 2 });
    expect(sealed.status).toBe(200);
    const sealedBody = await sealed.json();
    expect(sealedBody).toMatchObject({ id: card.id, revision: 2, state: 'SEALED' });
    expect(sealedBody.revisions[1]).not.toHaveProperty('sealedArtifact');
    expect(JSON.stringify(sealedBody)).not.toContain('ENVIRONMENT_MAP');
  } finally {
    await service.close();
  }
});
