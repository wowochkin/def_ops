import { createPool, dropSchema } from '@def-ops/db';
import { buildLinkedScenarioKit, REQUIRED_SCENARIO_ITEMS, type JsonValue } from '@def-ops/kshvi';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { OfficialSessionService, type SessionActor } from '../../src/runtime/official-session-service';
import { PgExerciseStore } from '../../src/store/exercise-store';

const actor: SessionActor = { userId: 'leader-1', organizationId: 'org-1', activeRole: 'DIRECTOR', sideId: null, authorities: ['TRUTH_READ', 'exercise:conduct', 'scenario.seal'] };
const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;

databaseIntegration('после нового экземпляра сервиса повтор команды и реплей используют сохранённый журнал', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 2);
  const schema = `kshvi_recovery_test_${randomUUID().replaceAll('-', '')}`;
  const store = new PgExerciseStore({ pool, schema });
  try {
    await store.init();
    const kit = buildLinkedScenarioKit({
      documents: REQUIRED_SCENARIO_ITEMS.map((item, index) => ({ id: `doc-${index + 1}`, item, revision: 1, content: { item } })),
      usesLogistics: true,
    });
    const card = await store.create(actor, {
      title: 'Восстановление', purpose: 'planned', scale: 'operational',
      payload: { kit: kit as unknown as JsonValue },
    });
    await store.seal(actor, card.id, 1);
    const session = await store.createSession(actor, card.id, { revision: 1 });
    const first = new OfficialSessionService(store);
    const paused = await first.command(actor, card.id, session.id, { command: 'PAUSE', expectedRevision: 0, idempotencyKey: 'pause-1' });
    expect(paused).toMatchObject({ state: 'PAUSED', confirmedRevision: 1 });

    const restarted = new OfficialSessionService(store);
    const repeated = await restarted.command(actor, card.id, session.id, { command: 'PAUSE', expectedRevision: 0, idempotencyKey: 'pause-1' });
    expect(repeated).toEqual(paused);
    expect((await store.getSession(actor.organizationId, card.id, session.id))?.confirmedRevision).toBe(1);
    const replay = await restarted.replayFrame(actor, card.id, session.id, 1, 'TRUTH');
    expect(replay).toMatchObject({ sequence: 1, perspective: 'TRUTH' });
    expect(replay.events.map(event => event.eventId)).toEqual([`${session.id}-command-1`]);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
