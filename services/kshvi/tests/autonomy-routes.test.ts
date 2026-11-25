import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { attemptsPerOperationalHour, createAutonomyProfile } from '@def-ops/kshvi-events';
import { emptyPreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { JsonValue } from '@def-ops/kshvi';
import { buildRouter } from '../src/app';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { InMemoryExerciseStore } from '../src/store/exercise-store';

function latest(card: { revision: number; revisions: readonly { revision: number; payload: any }[] }) {
  return card.revisions.find(item => item.revision === card.revision)!.payload.preparation;
}

it('сохраняет серверный профиль и воспроизводит репетицию без смены официальной редакции', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({ userId: 'editor', organizationId: 'org', username: 'editor', password: 'test-password',
    roles: [{ id: 'editor-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'TRUTH_READ'] }] });
  const store = new InMemoryExerciseStore();
  const created = await store.create({ userId: 'editor', organizationId: 'org' }, { title: 'События', purpose: 'research', scale: 'operational' });
  await store.savePreparation({ userId: 'editor', organizationId: 'org' }, created.id, {
    expectedRevision: 1, draft: emptyPreparationDraft('2026-11-25T06:00:00Z') as unknown as JsonValue,
  }, 'FULL');
  const service = createService({ name: 'autonomy-test', version: '0', port: 0, router: buildRouter({ sessions, exerciseStore: store }) });
  const port = await service.listen();
  try {
    const login = await sessions.login('editor', 'test-password');
    await sessions.selectRole(login.token, 'editor-role');
    const headers = { Authorization: `Bearer ${login.token}`, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' };
    const base = `http://127.0.0.1:${port}/kshvi/exercises/${created.id}/autonomy`;
    const catalog = await fetch(`${base}/catalog`, { headers });
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).items.length).toBeGreaterThan(0);

    const profile = createAutonomyProfile({ profileId: 'scenario-profile', level: 'CUSTOM', settings: {
      attemptsPerOperationalHour: 4, intervalMinutes: 15, maxEventsPerInterval: 4, maxEventsPerStage: 20,
      maxSeverityCost: 3, severityBudgetPerStage: 60, maxCascadeDepth: 2, maxCascadeEvents: 4, manualApprovalShare: 0,
    }, intensity: { categories: { logistics: 0 } } });
    const saved = await fetch(`${base}/profile`, { method: 'PUT', headers, body: JSON.stringify({ expectedRevision: 2, profile }) });
    expect(saved.status).toBe(200);
    const card = await saved.json();
    expect(card.revision).toBe(3);
    expect(attemptsPerOperationalHour(latest(card).autonomy, {
      category: 'logistics', stageId: 'preparation', sideId: 'blue', areaId: 'UNASSIGNED',
    })).toBe(0);

    const rehearse = () => fetch(`${base}/rehearsal`, { method: 'POST', headers,
      body: JSON.stringify({ seeds: ['seed-1'], fromSecond: 0, toSecond: 3600 }) });
    const first = await rehearse();
    expect(first.status).toBe(200);
    const firstReport = await first.json();
    const secondReport = await (await rehearse()).json();
    expect(secondReport.sha256).toBe(firstReport.sha256);
    expect((await store.get('org', created.id))?.revision).toBe(3);
  } finally { await service.close(); }
});
