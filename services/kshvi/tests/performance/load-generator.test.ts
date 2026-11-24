import { randomUUID } from 'node:crypto';
import { createPool, dropSchema } from '@def-ops/db';
import { expect, it } from 'vitest';
import { createFixturePlan, materializeFixture } from '../../src/performance/fixture-generator';
import { runLoadTest } from '../../src/performance/load-generator';
import { KshviEventStore } from '../../src/store/event-store';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('передаёт команды по HTTP и доставляет их в реальные SSE-соединения без потерь и дублей', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Нужен TEST_DATABASE_URL');
  const pool = createPool(url, 8);
  const schema = `kshvi_load_${randomUUID().replaceAll('-', '')}`;
  const store = new KshviEventStore({ pool, schema });
  try {
    await store.init();
    const plan = createFixturePlan('smoke', { instanceCount: 2, forcesPerInstance: 2, eventsPerInstance: 4 });
    await materializeFixture(store, plan);
    const report = await runLoadTest(store, plan, {
      connections: 2,
      activeParticipants: 2,
      sustainedRate: 5,
      sustainedSeconds: 1,
      burstRate: 20,
      burstSeconds: 1,
      heavyJobKinds: ['EXPORT', 'ARCHIVE', 'MASS_CALCULATION', 'REPLAY'],
      continuousHeavyJobs: true,
    });
    expect(report.transport).toBe('HTTP+SSE+PostgreSQL');
    expect(report.connections).toBe(2);
    expect(report.activeParticipants).toBe(2);
    expect(report.commands.confirmed).toBe(25);
    expect(report.sustained.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(report.burst.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(report.delivery.samples).toBe(25);
    expect(report.map.samples).toBe(25);
    expect(report.confirmedLost).toBe(0);
    expect(report.duplicateEffects).toBe(0);
    expect(report.deliveryMissing).toBe(0);
    expect(report.orderingErrors).toBe(0);
    expect(report.heavyJobs.completed).toBeGreaterThanOrEqual(4);
    expect(report.heavyJobs.results.length).toBeLessThanOrEqual(8);
    expect(report.heavyJobs.resultsTruncated).toBe(report.heavyJobs.completed - report.heavyJobs.results.length);
    expect(report.time.clientClockIndependent).toBe(true);
    expect(report.delivery.rawMs).toHaveLength(25);
    expect(report.map.rawMs).toHaveLength(25);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
}, 30_000);
