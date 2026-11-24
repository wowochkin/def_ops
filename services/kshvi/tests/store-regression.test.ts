import { expect, it } from 'vitest';
import { emptyWorld, reduceWorld, ReducerRegistry, type ChainEvent, type VersionRef, type WorldState } from '@def-ops/kshvi';
import { command, withKshviDatabase } from './helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
const environment: VersionRef = { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) };
const operationalAt = { normalizedAt: '2026-01-01T00:00:00.000Z', originalAt: '2026-01-01T03:00:00+03:00', zone: 'Europe/Moscow', offset: '+03:00' } as const;
const metadata = {
  schemaVersion: 1,
  wallClockAt: '2026-01-01T00:00:00.000Z',
  operationalAt,
  actor: { id: 'system-1', kind: 'SYSTEM' },
  causeIds: ['external-cause'],
  versions: { model: { id: 'model-1', revision: 1, sha256: 'b'.repeat(64) } },
  reducerVersion: 1,
} as const;

function worldWith(onHand: number): WorldState {
  const world = emptyWorld('scenario-1');
  world.resources.fuel = { onHand, consumed: 0, supplied: 0, deficit: 0 };
  return world;
}

async function snapshot(store: Parameters<Parameters<typeof withKshviDatabase>[0]>[0], organizationId: string, sequence: number, state: WorldState) {
  await store.saveSnapshot({ organizationId, instanceId: 'i1', branchId: 'b1', sequence, state, environment, reducerVersion: 1 });
}

integration('изолирует snapshots, events, outbox и revision по organizationId', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand({ ...command('org-1-command'), ...metadata });
    await store.appendCommand({ ...command('org-2-command'), organizationId: 'org2', ...metadata });
    await snapshot(store, 'org1', 1, worldWith(10));
    await snapshot(store, 'org2', 2, worldWith(90));

    const restored = await store.restoreWorld('org1', 'i1', 'b1');
    expect(restored.state.resources.fuel.onHand).toBe(10);
    expect(restored.sequence).toBe(1);
    expect(await store.eventCount('org1', 'i1')).toBe(1);
    expect(await store.outboxCount('org1', 'i1')).toBe(1);
    expect(await store.aggregateRevision('org1', 'i1', 'b1')).toBe(1);
    expect(await store.eventCount('org2', 'i1')).toBe(1);
  });
});

integration('хранит и доставляет полный DomainEvent с одинаковым хешем', async () => {
  await withKshviDatabase(async store => {
    const appended = await store.appendCommand({ ...command(), ...metadata });
    const row = await store.pool.query(`select * from ${store.schema}.events where event_id=$1`, [appended.eventId]);
    expect(row.rows[0]).toMatchObject({
      organization_id: 'org1', instance_id: 'i1', branch_id: 'b1', schema_version: 1,
      wall_clock_at: metadata.wallClockAt, reducer_version: 1, hash_version: 2,
    });
    expect(row.rows[0].operational_at).toEqual(metadata.operationalAt);
    expect(row.rows[0].actor).toEqual(metadata.actor);
    expect(row.rows[0].cause_ids).toEqual(metadata.causeIds);
    expect(row.rows[0].versions).toEqual(metadata.versions);

    let delivered: ChainEvent | undefined;
    await store.publishOutbox(async event => { delivered = event; });
    expect(delivered).toMatchObject({
      eventId: appended.eventId, organizationId: 'org1', instanceId: 'i1', branchId: 'b1',
      schemaVersion: 1, wallClockAt: metadata.wallClockAt, operationalAt: metadata.operationalAt,
      actor: metadata.actor, causeIds: metadata.causeIds, versions: metadata.versions, reducerVersion: 1, hashVersion: 2,
    });
  });
});

integration('при восстановлении проверяет цепочку, сохраняет causeIds и выбирает reducer каждого события', async () => {
  await withKshviDatabase(async store => {
    const registry = new ReducerRegistry();
    registry.register(1, reduceWorld);
    registry.register(2, (world, event, profile) => reduceWorld(world, {
      ...event,
      payload: { ...(event.payload as { resourceId: string; amount: number }), amount: (event.payload as { amount: number }).amount * 2 },
    }, { ...profile, reducerVersion: 1 }));
    const versioned = new (store.constructor as unknown as new (options: object) => typeof store)({ pool: store.pool, schema: store.schema, registry });
    const first = await versioned.appendCommand({ ...command(), ...metadata });
    const initial = reduceWorld(worldWith(10), { eventId: first.eventId, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: metadata.causeIds }, { reducerVersion: 1 });
    await snapshot(versioned, 'org1', 1, initial);
    const second = await versioned.appendCommand({
      ...command('cmd-2'), aggregateRevision: 1, ...metadata,
      causeIds: [first.eventId], reducerVersion: 2, payload: { resourceId: 'fuel', amount: 3 },
    });
    const restored = await versioned.restoreWorld('org1', 'i1', 'b1');
    expect(restored.state.resources.fuel.consumed).toBe(8);
    expect(restored.state.eventCauses[first.eventId]).toEqual(['external-cause']);
    expect(restored.state.eventCauses[second.eventId]).toEqual([first.eventId]);

    await versioned.pool.query('set session_replication_role=replica');
    await versioned.pool.query(`update ${versioned.schema}.events set payload=$1 where event_id=$2`, [{ resourceId: 'fuel', amount: 99 }, second.eventId]);
    await versioned.pool.query('set session_replication_role=default');
    await expect(versioned.restoreWorld('org1', 'i1', 'b1')).rejects.toThrow(/цепоч/i);
  });
});

integration('пропускает повреждённый свежий снимок и использует предыдущий целый', async () => {
  await withKshviDatabase(async store => {
    const first = await store.appendCommand(command());
    const initial = reduceWorld(worldWith(10), { eventId: first.eventId, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: [] }, { reducerVersion: 1 });
    await snapshot(store, 'org1', 1, initial);
    await store.appendCommand({ ...command('cmd-2'), aggregateRevision: 1, payload: { resourceId: 'fuel', amount: 3 } });
    await store.pool.query(
      `insert into ${store.schema}.snapshots (organization_id,instance_id,branch_id,sequence,state,state_hash,environment,reducer_version)
       values ('org1','i1','b1',2,$1,$2,$3,1)`,
      [worldWith(999), '0'.repeat(64), environment],
    );
    const restored = await store.restoreWorld('org1', 'i1', 'b1');
    expect(restored.sequence).toBe(2);
    expect(restored.state.resources.fuel.onHand).toBe(5);
    expect(restored.state.resources.fuel.consumed).toBe(5);
  });
});

integration('запрещает TRUNCATE events и UPDATE/DELETE snapshots/commands', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand(command());
    await snapshot(store, 'org1', 1, worldWith(10));
    await expect(store.pool.query(`truncate ${store.schema}.events cascade`)).rejects.toThrow('неизменяемы');
    await expect(store.pool.query(`update ${store.schema}.snapshots set state=$1`, [worldWith(0)])).rejects.toThrow('неизменяемы');
    await expect(store.pool.query(`delete from ${store.schema}.commands`)).rejects.toThrow('неизменяемы');
  });
});

integration('конкурентный submitJob возвращает исходный результат всем повторам', async () => {
  await withKshviDatabase(async store => {
    const input = { organizationId: 'org1', kind: 'ARCHIVE', key: 'same-key', payload: { instanceId: 'i1' } };
    await store.pool.query(`
      create function ${store.schema}.pause_job_insert() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.15); return new; end;
      $$;
      create trigger pause_job_insert before insert on ${store.schema}.jobs
      for each row execute function ${store.schema}.pause_job_insert();
    `);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.submitJob(input)));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(results.every(result => result.status === 'queued')).toBe(true);
    expect(await store.pool.query(`select count(*)::int as count from ${store.schema}.jobs`)).toMatchObject({ rows: [{ count: 1 }] });
  });
});

integration('outbox повторяет внешнюю доставку после потери фиксации и сохраняет delivery records', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand(command());
    await store.pool.query(`
      create function ${store.schema}.fail_outbox_commit() returns trigger language plpgsql as $$
      begin raise exception 'потеряна фиксация после внешней публикации'; end;
      $$;
      create trigger fail_outbox_commit before update on ${store.schema}.outbox
      for each row execute function ${store.schema}.fail_outbox_commit();
    `);
    let deliveries = 0;
    const keys = new Set<string>();
    await expect(store.publishOutbox(async (_event, delivery) => {
      deliveries += 1;
      keys.add(delivery.idempotencyKey);
    })).rejects.toThrow('фиксация');
    await store.pool.query(`drop trigger fail_outbox_commit on ${store.schema}.outbox`);
    expect(await store.publishOutbox(async (_event, delivery) => {
      deliveries += 1;
      keys.add(delivery.idempotencyKey);
    })).toBe(1);
    expect(deliveries).toBe(2);
    expect(keys.size).toBe(1);
    const records = await store.pool.query(`select status, attempt from ${store.schema}.outbox_deliveries order by attempt`);
    expect(records.rows).toHaveLength(2);
    expect(records.rows.map(row => row.status).sort()).toEqual(['failed', 'published']);
  });
});
