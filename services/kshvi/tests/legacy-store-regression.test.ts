import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPool, dropSchema, migrate } from '@def-ops/db';
import { emptyWorld, eventHash } from '@def-ops/kshvi';
import { KshviEventStore } from '../src/store/event-store';
import { KSHVI_MIGRATIONS } from '../src/store/migrations';
import { stateHash } from '../src/store/snapshot-store';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('миграция сохраняет чтение legacy hashVersion=1 и пополняет outbox без перезаписи события', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL, 2);
  const schema = `kshvi_legacy_${randomUUID().replaceAll('-', '')}`;
  const eventId = randomUUID();
  try {
    await migrate(pool, schema, KSHVI_MIGRATIONS.filter(migration => migration.id === 1));
    const payload = { resourceId: 'fuel', amount: 2 };
    const hash = eventHash({ eventId, sequence: 1, type: 'resource.consumed.v1', payload, hashVersion: 1 } as never, null);
    await pool.query(
      `insert into ${schema}.events (organization_id,instance_id,branch_id,sequence,event_id,type,payload,prev_hash,hash)
       values ('org1','i1','b1',1,$1,'resource.consumed.v1',$2,null,$3)`,
      [eventId, payload, hash],
    );
    await pool.query(`insert into ${schema}.aggregates values ('org1','i1','b1',1)`);
    await pool.query(
      `insert into ${schema}.outbox (id,organization_id,instance_id,event_id,payload,status)
       values ($1,'org1','i1',$2,$3,'pending')`,
      [randomUUID(), eventId, { eventId, sequence: 1, type: 'resource.consumed.v1', payload, prevHash: null, hash }],
    );
    const world = emptyWorld('scenario-1');
    const legacyState = { ...world, resources: world.resources };
    await pool.query(
      `insert into ${schema}.snapshots (organization_id,instance_id,branch_id,sequence,state,state_hash,environment,reducer_version)
       values ('org1','i1','b1',0,$1,$2,$3,1)`,
      [legacyState, stateHash(legacyState), { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }],
    );

    const store = new KshviEventStore({ pool, schema });
    await store.init();
    const restored = await store.restoreWorld('org1', 'i1', 'b1');
    expect(restored.state.resources.fuel.deficit).toBe(2);
    const raw = await pool.query(`select payload,hash,hash_version from ${schema}.events where event_id=$1`, [eventId]);
    expect(raw.rows[0]).toMatchObject({ payload, hash, hash_version: 1 });
    let delivered: unknown;
    await store.publishOutbox(async event => { delivered = event; });
    expect(delivered).toMatchObject({ eventId, organizationId: 'org1', causeIds: [], reducerVersion: 1, hashVersion: 1, hash });
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
