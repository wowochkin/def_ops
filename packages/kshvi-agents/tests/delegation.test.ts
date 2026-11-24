import { describe, expect, it } from 'vitest';
import { createElectronicIntermediaryAssignment } from '../src/model/assignment';
import { authorizeAgentAction } from '../src/model/agent-mode';

const base = {
  assignmentId: 'agent-1',
  exerciseId: 'exercise-1',
  bindings: [
    { instanceId: 'higher', sectorIds: ['north'] },
    { instanceId: 'neighbour', sectorIds: ['east'] },
    { instanceId: 'support', sectorIds: ['rear'] },
  ],
  roles: ['INTERMEDIARY' as const],
  projection: { projectionId: 'projection-agent-1', sideIds: ['blue'], sectorIds: ['north', 'east', 'rear'] },
  allowedActions: ['issueDocument', 'assignTask', 'requestCalculation'],
  modernProfile: {
    profileId: 'modern-intermediary',
    version: '1.0.0',
    era: 'modern' as const,
    source: { kind: 'ASSUMPTION' as const, reference: 'Учебный профиль КШВИ' },
    maxOptions: 3,
    riskLimit: 0.5,
    severityLimit: 3,
  },
  schedule: { everyMs: 1_000, timeBudgetMs: 250 },
  escalation: { recipients: ['leader-1'], requiredData: ['activeOrder'] },
};

describe('ElectronicIntermediaryAssignment', () => {
  it('создаёт самостоятельного системного участника с DELEGATED по умолчанию', () => {
    const assignment = createElectronicIntermediaryAssignment(base);

    expect(assignment.mode).toBe('DELEGATED');
    expect(assignment.actor).toEqual({
      kind: 'system',
      id: 'agent-1',
      assignmentId: 'agent-1',
    });
    expect(assignment.bindings.map(binding => binding.instanceId)).toEqual(['higher', 'neighbour', 'support']);
    expect(assignment.projection.projectionId).toBe('projection-agent-1');
    expect(assignment.modernProfile.era).toBe('modern');
    expect(assignment.schedule.timeBudgetMs).toBe(250);
    expect(assignment.escalation.recipients).toEqual(['leader-1']);
    expect(assignment.status).toBe('ACTIVE');
  });

  it.each(['ADVISORY', 'DELEGATED', 'AUTONOMOUS'] as const)('режим %s не расширяет делегированные права', mode => {
    const assignment = createElectronicIntermediaryAssignment({ ...base, mode });

    expect(authorizeAgentAction(assignment, { kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', risk: 0.2, severity: 2 })).toEqual({
      allowed: true,
      execution: mode === 'ADVISORY' ? 'PROPOSE_ONLY' : 'SUBMIT',
    });
    expect(authorizeAgentAction(assignment, { kind: 'changeScenarioConcept', instanceId: 'higher', sectorId: 'north', risk: 0, severity: 0 })).toEqual({
      allowed: false,
      reason: 'OUTSIDE_DELEGATION',
    });
  });

  it('проверяет участок, риск и тяжесть независимо от AUTONOMOUS', () => {
    const assignment = createElectronicIntermediaryAssignment({ ...base, mode: 'AUTONOMOUS' });

    expect(authorizeAgentAction(assignment, { kind: 'issueDocument', instanceId: 'foreign', sectorId: 'north' })).toEqual({ allowed: false, reason: 'OUTSIDE_DELEGATION' });
    expect(authorizeAgentAction(assignment, { kind: 'issueDocument', instanceId: 'higher', sectorId: 'foreign' })).toEqual({ allowed: false, reason: 'OUTSIDE_DELEGATION' });
    expect(authorizeAgentAction(assignment, { kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', risk: 0.9 })).toEqual({ allowed: false, reason: 'RISK_LIMIT_EXCEEDED' });
    expect(authorizeAgentAction(assignment, { kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', severity: 9 })).toEqual({ allowed: false, reason: 'SEVERITY_LIMIT_EXCEEDED' });
  });
});
