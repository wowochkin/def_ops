import { describe, expect, it } from 'vitest';
import { runIntermediaryCycle, type IntermediaryServerPort } from '../src/intermediary/cycle';
import { interceptAssignment, modifyAgentDecision, resumeAssignment } from '../src/intermediary/escalate';
import { assignmentFixture, projectionFixture, routineActionKinds, wakeFixture } from './fixtures';

function serverFixture(projection = projectionFixture()): IntermediaryServerPort {
  return {
    loadProjection: async () => projection,
    submit: async command => ({
      commandId: command.commandId,
      accepted: true,
      idempotent: false,
      effectApplied: true,
      status: 'APPLIED',
      eventId: `event-${command.commandId}`,
      serverRevision: command.expectedProjectionRevision + 1,
    }),
  };
}

describe('полный цикл электронного посредника', () => {
  it('исполняет разрешённый контур без человека и не применяет запрещённое действие', async () => {
    const projection = projectionFixture({
      requestedActions: [
        ...projectionFixture().requestedActions,
        { actionId: 'forbidden', kind: 'changeScenarioConcept', instanceId: 'higher', sectorId: 'north', payload: {} },
      ],
    });
    const submitted: string[] = [];
    const server = serverFixture(projection);
    const originalSubmit = server.submit;
    server.submit = async command => {
      submitted.push(command.kind);
      return originalSubmit(command);
    };

    const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server });

    expect(submitted).toEqual(expect.arrayContaining([...routineActionKinds]));
    expect(submitted).not.toContain('changeScenarioConcept');
    expect(result.commands.map(command => command.kind)).toContain('issueDocument');
    expect(result.proposedCommands.at(-1)?.kind).toBe('changeScenarioConcept');
    expect(result.escalation).toEqual(expect.objectContaining({ reason: 'OUTSIDE_DELEGATION', rollback: false, worldContinues: true }));
    expect(result.appliedForbiddenEffects).toEqual([]);
    expect(result.trace.actor.kind).toBe('system');
    expect(result.trace.actor.assignmentId).toBe('agent-1');
    expect(result.commands.every(command => command.actor.kind === 'system' && command.assignmentId === 'agent-1')).toBe(true);
    expect(new Set(result.commands.map(command => command.idempotencyKey)).size).toBe(result.commands.length);
    expect(result.classification.workingMap.entries.length).toBeGreaterThan(0);
    expect(result.decision.goals.length).toBeGreaterThan(0);
    expect(result.observationSheet.entries.length).toBeGreaterThan(0);
  });

  it('ADVISORY готовит те же команды, но не отправляет их', async () => {
    let submissions = 0;
    const server = serverFixture();
    server.submit = async command => {
      submissions += 1;
      return { commandId: command.commandId, accepted: true, idempotent: false, effectApplied: true, status: 'APPLIED' };
    };

    const result = await runIntermediaryCycle({ assignment: assignmentFixture({ mode: 'ADVISORY' }), wake: wakeFixture, server });

    expect(submissions).toBe(0);
    expect(result.commands).toEqual([]);
    expect(result.proposedCommands.length).toBe(projectionFixture().requestedActions.length);
    expect(result.status).toBe('AWAITING_HUMAN');
    expect(result.escalation?.reason).toBe('ADVISORY_APPROVAL_REQUIRED');
  });

  it('при истечении версионного тайм-бюджета эскалирует без команд', async () => {
    let tick = 0;
    const result = await runIntermediaryCycle({
      assignment: assignmentFixture({ schedule: { everyMs: 1_000, timeBudgetMs: 5 } }),
      wake: wakeFixture,
      server: serverFixture(),
      now: () => (tick += 10),
    });

    expect(result.status).toBe('ESCALATED');
    expect(result.escalation?.reason).toBe('TIME_BUDGET_EXCEEDED');
    expect(result.commands).toEqual([]);
    expect(result.trace.versions.timeBudget).toBe(1);
  });

  it.each([
    ['INSUFFICIENT_DATA', projectionFixture({ activeOrder: undefined })],
    ['UNRESOLVED_CONTRADICTION', projectionFixture({ contradictions: ['Донесения противоречат друг другу'] })],
    ['LEADER_REQUESTED', projectionFixture({ leaderRequested: true })],
  ] as const)('эскалирует условие %s', async (reason, projection) => {
    const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverFixture(projection) });
    expect(result.escalation?.reason).toBe(reason);
    expect(result.commands).toEqual([]);
    expect(result.appliedForbiddenEffects).toEqual([]);
  });

  it('отказ вычислительной модели эскалирует, а не выдумывает решение', async () => {
    const result = await runIntermediaryCycle({
      assignment: assignmentFixture(),
      wake: wakeFixture,
      server: serverFixture(),
      decisionModel: { createPlan: async () => { throw new Error('model unavailable'); } },
    });

    expect(result.escalation?.reason).toBe('MODEL_FAILURE');
    expect(result.commands).toEqual([]);
    expect(result.trace.options).toEqual([]);
  });

  it('перехват и изменение решения не откатывают мир и сохраняют человеческого автора', async () => {
    const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverFixture() });
    const interception = interceptAssignment(result.assignment, { kind: 'human', id: 'leader-1' }, 42);
    const override = modifyAgentDecision(result.trace, { kind: 'human', id: 'leader-1' }, {
      actionId: 'human-action', kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', payload: { reference: 'human-version' },
    });
    const resumed = resumeAssignment(interception.assignment, { kind: 'human', id: 'leader-1' });

    expect(interception.record).toEqual(expect.objectContaining({ worldSequence: 42, rollback: false, worldContinues: true }));
    expect(override.author).toEqual({ kind: 'human', id: 'leader-1' });
    expect(override.basedOnTraceId).toBe(result.trace.traceId);
    expect(resumed.status).toBe('ACTIVE');
    expect(resumed.version).toBe(interception.assignment.version + 1);
  });
});


it.each([
  ['CONFIRM', 'ACTIVE'],
  ['MODIFY', 'ACTIVE'],
  ['REJECT', 'ACTIVE'],
  ['PAUSE', 'PAUSED'],
] as const)('обрабатывает решение человека %s без отката мира', async (kind, status) => {
  const { resolveAgentIntervention } = await import('../src/intermediary/escalate');
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverFixture() });
  const intervention = kind === 'MODIFY'
    ? { kind, action: { actionId: 'human-action', kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', payload: {} } }
    : { kind };
  const resolved = resolveAgentIntervention({
    assignment: interceptAssignment(result.assignment, { kind: 'human', id: 'leader-1' }, 42).assignment,
    trace: result.trace,
    actor: { kind: 'human', id: 'leader-1' },
    worldSequence: 42,
    intervention,
  });

  expect(resolved.assignment.status).toBe(status);
  expect(resolved.record).toEqual(expect.objectContaining({
    kind,
    author: { kind: 'human', id: 'leader-1' },
    basedOnTraceId: result.trace.traceId,
    worldSequence: 42,
    rollback: false,
    worldContinues: true,
  }));
  if (kind === 'MODIFY') expect(resolved.record).toEqual(expect.objectContaining({ action: intervention.action }));
});
