import { expect, it } from 'vitest';
import { decisionTraceForReplay, hashProjection } from '../src/model/decision-trace';
import { runIntermediaryCycle, type IntermediaryServerPort } from '../src/intermediary/cycle';
import { assignmentFixture, projectionFixture, wakeFixture } from './fixtures';

function serverWithProjection(projection: unknown): IntermediaryServerPort {
  return {
    loadProjection: async () => projection,
    submit: async command => ({
      commandId: command.commandId,
      accepted: true,
      idempotent: false,
      effectApplied: true,
      status: 'APPLIED',
      eventId: `event-${command.commandId}`,
    }),
  };
}

it('сохраняет полный объяснимый след с изолированными проигрышами и версиями', async () => {
  const projection = projectionFixture({
    observations: [{ ...projectionFixture().observations[0], stale: true }],
  });
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithProjection(projection) });
  const trace = result.trace;

  expect(trace.projectionHash).toBe(hashProjection(trace.projection));
  expect(trace.activeOrder?.orderId).toBe('order-1');
  expect(trace.options.length).toBeGreaterThanOrEqual(2);
  expect(trace.selectedOptionId).not.toBeNull();
  expect(trace.constraints).toContainEqual(expect.objectContaining({ code: 'STALE_OBSERVATION' }));
  expect(trace.versions).toEqual({
    profile: 'modern-intermediary@1.0.0',
    algorithm: 'intermediary-cycle@1.0.0',
    projectionSchema: 'kshvi-agent-projection@1',
    timeBudget: 1,
  });
  expect(trace.rngKeys[0]).toEqual(expect.objectContaining({ stream: 'intermediary-option-order', cursor: 0 }));
  expect(trace.options.every(option => option.replay.isolated && !option.replay.writeAccess && !option.replay.officialWorldChanged)).toBe(true);
  expect(trace.options.every(option => option.replay.officialProjectionHash === trace.projectionHash)).toBe(true);
  expect(trace.commands.length).toBeGreaterThan(0);
  expect(trace.responses).toHaveLength(trace.commands.length);
  expect(trace.explanation.selected).toContain('Выбран вариант');
  expect(trace.explanation.alternativesRejected.join(' ')).toContain('отклонён');
  expect(trace.explanation.unknownData).toContain('Актуальные сведения observation-1');
});

it('не переносит чужую истину, будущие вводные и скрытые поля наблюдения в след', async () => {
  const raw = {
    ...projectionFixture(),
    observations: [{ ...projectionFixture().observations[0], trueForceId: 'secret-force', actualErrorMeters: 0 }],
    foreignProjection: { secret: 'foreign-plan' },
    futureInputs: [{ id: 'future-input' }],
    referenceSolution: 'service-reference',
  };
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithProjection(raw) });
  const serialized = JSON.stringify(result.trace);

  expect(serialized).not.toContain('secret-force');
  expect(serialized).not.toContain('actualErrorMeters');
  expect(serialized).not.toContain('foreign-plan');
  expect(serialized).not.toContain('future-input');
  expect(serialized).not.toContain('service-reference');
});

it('даёт одинаковый след при одинаковых разрешённых входах и зерне', async () => {
  const first = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithProjection(projectionFixture()), rngSeed: 'fixed-seed' });
  const second = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithProjection(projectionFixture()), rngSeed: 'fixed-seed' });

  expect(second.trace).toEqual(first.trace);
  expect(second.trace.rngKeys).toEqual(first.trace.rngKeys);
});

it('отделяет копию следа для реплея от рабочего объекта', async () => {
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithProjection(projectionFixture()) });
  const replay = decisionTraceForReplay(result.trace);

  expect(replay).toEqual(result.trace);
  expect(replay).not.toBe(result.trace);
  expect(replay.projection).not.toBe(result.trace.projection);
});
