import { describe, expect, it } from 'vitest';
import { topForces } from '../src/sim/review-forces';

describe('силы для разбора игры', () => {
  it('сначала своя сторона, у неё армии раньше корпусов — корпуса не вытесняют армии', () => {
    const corps = Array.from({ length: 60 }, (_, i) => ({ side: 'own' as const, echelon: 'corps', start: 30000 + i, name: `к${i}` }));
    const armies = [{ side: 'own' as const, echelon: 'army', start: 9000, name: 'а1' }, { side: 'own' as const, echelon: 'army', start: 8000, name: 'а2' }];
    const enemy = [{ side: 'enemy' as const, echelon: 'army', start: 50000, name: 'п1' }];
    const r = topForces([...corps, ...enemy, ...armies], 48);
    expect(r.length).toBe(48);
    expect(r.slice(0, 2).map((x) => x.name)).toEqual(['а1', 'а2']);
    expect(r[2].name).toBe('к59');
  });
});
