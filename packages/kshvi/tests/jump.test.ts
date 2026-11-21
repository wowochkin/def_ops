import { expect, it } from 'vitest';
import { executeJump } from '../src/runtime/jump';
import { applyStopMode } from '../src/runtime/stop-modes';

it('выполняет семь шагов скачка один раз и сохраняет остатки', async () => {
  const world = { pathRemaining: 40, fuel: 10, messages: ['in-transit'], weatherSeed: 7 };
  const steps: string[] = [];
  const result = await executeJump({
    jumpId: 'jump-1', targetOperationalAt: '2030-01-02T00:00:00Z', world,
    calculate: async state => { steps.push('calculate'); return { ...state, pathRemaining: 20, fuel: 8 };
    },
    approve: async () => { steps.push('approve'); },
    snapshot: async state => { steps.push('snapshot'); return { state, hash: 'snapshot-hash' }; },
    report: async step => { steps.push(step); },
  });
  expect(result.hash).toBe('snapshot-hash');
  expect(result.world).toMatchObject({ pathRemaining: 20, fuel: 8, weatherSeed: 7 });
  expect(steps).toEqual(['boundary', 'stop', 'calculate', 'uncertainty', 'approve', 'snapshot', 'resume']);
  await expect(executeJump({ jumpId: 'jump-1', targetOperationalAt: '2030-01-02T00:00:00Z', world: result.world })).rejects.toThrow('уже применён');
});

it('запрещает обратное официальное время и различает отбой и ABORTED', async () => {
  expect(applyStopMode({ status: 'ACTIVE' }, { kind: 'PAUSE' })).toMatchObject({ status: 'PAUSED' });
  expect(applyStopMode({ status: 'PAUSED' }, { kind: 'ABORT', reason: 'Авария' })).toMatchObject({ status: 'ABORTED', reason: 'Авария' });
  expect(() => applyStopMode({ status: 'ABORTED' }, { kind: 'PAUSE' })).toThrow('ABORTED');
  await expect(executeJump({ jumpId: 'back', targetOperationalAt: '2030-01-01T00:00:00Z', currentOperationalAt: '2030-01-02T00:00:00Z', world: {} })).rejects.toThrow('назад');
});
