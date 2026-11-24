import { expect, it } from 'vitest';
import { emptyWorld, reduceWorld } from '@def-ops/kshvi';
import { command, withKshviDatabase } from './helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('атомарно фиксирует событие, ревизию и outbox', async () => {
  await withKshviDatabase(async store => {
    const input = command();
    const first = await store.appendCommand(input);
    const second = await store.appendCommand(input);
    expect(second.eventId).toBe(first.eventId);
    expect(second.idempotent).toBe(true);
    expect(await store.eventCount('org1', 'i1')).toBe(1);
    expect(await store.outboxCount('org1', 'i1')).toBe(1);
    expect(await store.aggregateRevision('org1', 'i1', 'b1')).toBe(1);
  });
});

integration('отклоняет повтор ключа с другим содержимым', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand(command());
    await expect(store.appendCommand({ ...command(), payload: { resourceId: 'fuel', amount: 3 } })).rejects.toThrow('Идемпотентный ключ уже использован');
    expect(await store.eventCount('org1', 'i1')).toBe(1);
  });
});

integration('не принимает устаревшую ревизию агрегата', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand(command());
    await expect(store.appendCommand(command('cmd-2'))).rejects.toThrow('ревизия');
    expect(await store.eventCount('org1', 'i1')).toBe(1);
  });
});

integration('восстанавливает снимок с проверенным хвостом журнала', async () => {
  await withKshviDatabase(async store => {
    const first = await store.appendCommand(command());
    const world = reduceWorld(emptyWorld('scenario-1'), { eventId: first.eventId, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: [] }, { reducerVersion: 1 });
    await store.saveSnapshot({ organizationId: 'org1', instanceId: 'i1', branchId: 'b1', sequence: 1, state: world, environment: { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }, reducerVersion: 1 });
    const secondInput = { ...command('cmd-2'), aggregateRevision: 1, payload: { resourceId: 'fuel', amount: 3, supplied: 4 } };
    await store.appendCommand(secondInput);
    const restored = await store.restoreWorld('org1', 'i1', 'b1');
    expect(restored.sequence).toBe(2);
    expect(restored.state.resources.fuel.onHand).toBe(1);
    expect(restored.state.resources.fuel.consumed).toBe(3);
    expect(restored.state.resources.fuel.supplied).toBe(4);
  });
});

integration('не повторяет обработчик после зафиксированной at-least-once доставки', async () => {
  await withKshviDatabase(async store => {
    await store.appendCommand(command());
    let delivered = 0;
    const handler = async () => { delivered += 1; };
    expect(await store.publishOutbox(handler)).toBe(1);
    expect(await store.publishOutbox(handler)).toBe(0);
    expect(delivered).toBe(1);
  });
});

integration('создаёт задание идемпотентно и запрещает изменение журнала', async () => {
  await withKshviDatabase(async store => {
    const first = await store.submitJob({ organizationId: 'org1', kind: 'ARCHIVE', key: 'archive-1', payload: { instanceId: 'i1' } });
    const second = await store.submitJob({ organizationId: 'org1', kind: 'ARCHIVE', key: 'archive-1', payload: { instanceId: 'i1' } });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('queued');
    await store.appendCommand(command());
    await expect(store.pool.query(`update ${store.schema}.events set payload = $1 where instance_id = $2`, [{ resourceId: 'fuel', amount: 99 }, 'i1'])).rejects.toThrow('неизменяемы');
  });
});
