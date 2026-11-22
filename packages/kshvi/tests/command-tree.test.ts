import { expect, it } from 'vitest';
import { requiredIntermediaries, validateCommandTree } from '../src/forces/command-tree';
import { capabilityFactors } from '../src/forces/capability';

it('находит цикл и незакрытый активный стык', () => {
  const issues = validateCommandTree({ nodes: [{ id: 'a', parentId: 'b', trained: true }, { id: 'b', parentId: 'a', trained: true }], edges: [{ from: 'a', to: 'b', active: true, playRole: null }] });
  expect(issues.map(x => x.code)).toEqual(expect.arrayContaining(['COMMAND_CYCLE', 'PLAY_ROLE_REQUIRED']));
});

it('различает человека, группу, системного агента и отложенное подключение', () => {
  const nodes = [{ id: 'a', parentId: null, trained: true }, { id: 'b', parentId: 'a', trained: true }];
  const edges = [
    {
      from: 'a', to: 'b', active: true, playRole: { kind: 'AGENT', assignmentId: 'agent-1' },
      kind: 'OPERATIONAL_COMMAND' as const, validFrom: '2025-01-01T00:00:00Z', validTo: null,
      authorities: ['ISSUE_ORDER'], allowedDocumentTypes: ['ORDER'], channelId: 'radio',
    },
    { from: 'b', to: 'a', active: false, playRole: null, activation: 'AFTER_SUPERIOR_TASK' as const },
  ] as const;
  expect(validateCommandTree({ nodes, edges })).toEqual([]);
  expect(requiredIntermediaries({ nodes, edges })).toEqual([]);
});

it('находит отсутствующего родителя и разрыв сроков планирования', () => {
  const issues = validateCommandTree({
    nodes: [{ id: 'a', parentId: 'missing', trained: true, planningHorizonHours: 1 }, { id: 'b', parentId: 'a', trained: true, planningHorizonHours: 72 }],
    edges: [{ from: 'a', to: 'b', active: true, playRole: { kind: 'HUMAN', assignmentId: 'p-1' }, deadlineHours: 2 }],
  });
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['PARENT_MISSING', 'PLANNING_GAP', 'DEADLINE_EXCEEDS_HORIZON']));
});

it('не сводит самостоятельные измерения в один коэффициент и не скрывает UNKNOWN', () => {
  const result = capabilityFactors({
    initialAssessment: { value: 0.8, source: 'scenario-1' },
    equipment: { actual: 7, authorized: 10 },
    personnel: null,
    supplies: { available: 60, required: 100 },
    fatigue: 0.2,
    morale: 0.7,
    readiness: 0.6,
    supply: 0.5,
    manualCorrection: { value: 0.1, reason: 'Сценарная поправка', author: 'leader-1' },
  });
  expect(result.status).toBe('REQUIRES_REVIEW');
  expect(result.unknown).toEqual(['personnel']);
  expect(result.factors.equipment).toBe(0.7);
  expect(result.factors.supplies).toBe(0.6);
  expect(result.initialAssessment.value).toBe(0.8);
  expect(result.manualCorrection?.value).toBe(0.1);
});
