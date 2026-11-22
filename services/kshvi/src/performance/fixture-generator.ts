import type { KshviEventStore } from '../store/event-store';

export type FixtureInstance = Readonly<{
  instanceId: string;
  eventCount: number;
  forces: readonly Readonly<{
    forceId: string;
    side: 'blue' | 'red';
    name: string;
    position: readonly [number, number];
  }>[];
}>;

export type FixturePlan = Readonly<{
  schemaVersion: 1;
  organizationId: string;
  branchId: string;
  instances: readonly FixtureInstance[];
}>;

export type FixtureOptions = Readonly<{
  instanceCount?: number;
  forcesPerInstance?: number;
  eventsPerInstance?: number;
}>;

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Количество ${name} должно быть положительным целым`);
}

export function createFixturePlan(prefix = 'reference', options: FixtureOptions = {}): FixturePlan {
  const instanceCount = options.instanceCount ?? 100;
  const forcesPerInstance = options.forcesPerInstance ?? 10;
  const eventsPerInstance = options.eventsPerInstance ?? 100;
  positiveInteger(instanceCount, 'инстансов');
  positiveInteger(forcesPerInstance, 'сил');
  positiveInteger(eventsPerInstance, 'событий');
  if (!/^[a-zA-Z0-9-]+$/.test(prefix)) throw new Error('Префикс набора содержит недопустимые символы');
  return {
    schemaVersion: 1,
    organizationId: `${prefix}-org`,
    branchId: `${prefix}-branch`,
    instances: Array.from({ length: instanceCount }, (_, instanceIndex) => {
      const instanceNumber = String(instanceIndex + 1).padStart(3, '0');
      const instanceId = `${prefix}-i-${instanceNumber}`;
      return {
        instanceId,
        eventCount: eventsPerInstance,
        forces: Array.from({ length: forcesPerInstance }, (_, forceIndex) => ({
          forceId: `${instanceId}-f-${String(forceIndex + 1).padStart(3, '0')}`,
          side: forceIndex % 2 === 0 ? 'blue' as const : 'red' as const,
          name: `Учебный объект ${instanceNumber}.${forceIndex + 1}`,
          position: [instanceIndex, forceIndex] as const,
        })),
      };
    }),
  };
}

export async function materializeFixture(store: KshviEventStore, plan: FixturePlan): Promise<{ instances: number; forces: number; events: number }> {
  await Promise.all(plan.instances.map(async instance => {
    for (let sequence = 0; sequence < instance.eventCount; sequence += 1) {
      const initial = sequence === 0;
      await store.appendCommand({
        organizationId: plan.organizationId,
        instanceId: instance.instanceId,
        branchId: plan.branchId,
        aggregateRevision: sequence,
        idempotencyKey: `fixture-${sequence + 1}`,
        type: initial ? 'fixture.forces.v1' : 'fixture.map.v1',
        payload: initial
          ? { forces: instance.forces.map(force => ({ ...force, position: [force.position[0], force.position[1]] })) }
          : { fixtureSequence: sequence + 1, mapRevision: sequence },
      });
    }
  }));
  const result = await store.pool.query(
    `select count(*)::int as events,
            count(distinct instance_id)::int as instances,
            coalesce(sum(case when type = 'fixture.forces.v1' then jsonb_array_length(payload->'forces') else 0 end), 0)::int as forces
       from ${store.schema}.events where organization_id = $1`,
    [plan.organizationId],
  );
  const actual = result.rows[0] as { events: number; instances: number; forces: number };
  const expected = {
    events: plan.instances.reduce((sum, instance) => sum + instance.eventCount, 0),
    instances: plan.instances.length,
    forces: plan.instances.reduce((sum, instance) => sum + instance.forces.length, 0),
  };
  if (actual.events !== expected.events || actual.instances !== expected.instances || actual.forces !== expected.forces) {
    throw new Error(`Эталонный набор не совпал: ожидалось ${JSON.stringify(expected)}, записано ${JSON.stringify(actual)}`);
  }
  return actual;
}
