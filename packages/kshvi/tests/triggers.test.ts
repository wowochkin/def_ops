import { expect, it } from 'vitest';
import { evaluateTrigger, validateTriggerGraph } from '../src/runtime/triggers';
import { resolveConflict } from '../src/runtime/conflicts';

it('не считает неизвестное ложным и находит цикл', () => {
  expect(evaluateTrigger({ left: { status: 'UNKNOWN' }, operator: 'EQ', right: true })).toBe('UNRESOLVED');
  expect(validateTriggerGraph([{ id: 'a', emits: ['b'] }, { id: 'b', emits: ['a'] }])).toContainEqual(expect.objectContaining({ code: 'TRIGGER_CYCLE' }));
});

it('различает известное условие и останавливает каскад на рассмотрении', () => {
  expect(evaluateTrigger({ left: 3, operator: 'GE', right: 2 })).toBe('TRUE');
  expect(evaluateTrigger({ left: 1, operator: 'GE', right: 2 })).toBe('FALSE');
});

it('разрешает конфликт сроков и полномочий новым решением, не переписывая прошлое', () => {
  const result = resolveConflict({ kind: 'DEADLINE', existing: { deadline: 10, authority: 'node-1' }, requested: { deadline: 12, authority: 'node-2' } });
  expect(result.status).toBe('NEW_DECISION_REQUIRED');
  expect(result.preserveHistory).toBe(true);
});
