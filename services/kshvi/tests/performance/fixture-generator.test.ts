import { describe, expect, it } from 'vitest';
import { createFixturePlan } from '../../src/performance/fixture-generator';

describe('эталонный набор нагрузочной приёмки', () => {
  it('содержит 100 инстансов, 1 000 сил и 10 000 событий без генерации результатов нагрузки', () => {
    const plan = createFixturePlan('acceptance');
    expect(plan.instances).toHaveLength(100);
    expect(plan.instances.reduce((sum, instance) => sum + instance.forces.length, 0)).toBe(1000);
    expect(plan.instances.reduce((sum, instance) => sum + instance.eventCount, 0)).toBe(10_000);
    expect(plan.instances[0]?.forces).toHaveLength(10);
    expect(plan.instances[0]?.eventCount).toBe(100);
    expect(plan).toEqual(createFixturePlan('acceptance'));
    expect(plan).not.toHaveProperty('deliveryP95Ms');
  });

  it('позволяет маленький реальный сетевой smoke-тест без подмены эталонного режима', () => {
    const plan = createFixturePlan('smoke', { instanceCount: 2, forcesPerInstance: 2, eventsPerInstance: 4 });
    expect(plan.instances.map(instance => instance.instanceId)).toEqual(['smoke-i-001', 'smoke-i-002']);
    expect(plan.instances.every(instance => instance.eventCount === 4 && instance.forces.length === 2)).toBe(true);
    expect(() => createFixturePlan('broken', { instanceCount: 1, forcesPerInstance: 0, eventsPerInstance: 1 })).toThrow('сил');
  });
});
