import { describe, expect, it } from 'vitest';
import { selectCandidate } from '../src/scheduler/candidate-selector';
import { scheduleInterval } from '../src/scheduler/interval-scheduler';
import { blueNorthTarget, makeProfile, makeScheduleInput, makeState, makeTemplate } from './fixtures/autonomy';

function selectionInput(templates = [makeTemplate()]) {
  return {
    templates,
    category: 'logistics' as const,
    profile: makeProfile(),
    state: makeState(),
    target: blueNorthTarget,
    interval: { index: 0, startSecond: 0, endSecond: 3600 },
    attemptOrdinal: 0,
    seed: 'trace-seed',
    branchId: 'branch-main',
    snapshotHash: 'snapshot-v1',
    templateSetVersion: 'catalog-v1',
  };
}

describe('Полный след кандидатов', () => {
  it('сохраняет сортировку, веса, параметры, ключи, отклонения, бюджет и события', () => {
    const eligible = makeTemplate({ templateId: 'a-eligible', baseWeight: 2 });
    const unknown = makeTemplate({
      templateId: 'b-unknown',
      baseWeight: 8,
      preconditions: [{ type: 'fact.comparison', fact: 'unknown.fact', operator: 'EQ', value: true, required: true, onUnknown: 'NOT_TRUE' }],
    });
    const result = selectCandidate(selectionInput([unknown, eligible]));
    expect(result.trace.candidates.map(candidate => candidate.templateId)).toEqual(['a-eligible', 'b-unknown']);
    expect(result.trace.candidates[0]).toEqual(expect.objectContaining({ effectiveWeight: 2, rejectionReasons: [] }));
    expect(result.trace.candidates[1].rejectionReasons).toContain('PRECONDITION_UNKNOWN');
    expect(result.trace.selectedTemplateId).toBe('a-eligible');
    expect(result.trace.selectionKey).toBeTruthy();
    expect(result.trace.targetKey).toBeTruthy();
    expect(result.trace.approvalKey).toBeTruthy();
    expect(result.trace.parameters.amount).toBeGreaterThanOrEqual(1);
    expect(result.trace.parameters.amount).toBeLessThanOrEqual(100);
    expect(result.trace.budgetBefore.eventsPerIntervalRemaining).toBeGreaterThan(0);
    expect(result.trace.budgetAfter.eventsPerIntervalRemaining).toBe(result.trace.budgetBefore.eventsPerIntervalRemaining - 1);
    expect(result.trace.createdEvents).toHaveLength(1);
    expect(result.trace.controlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('записывает пустую попытку и причины всех отклонённых кандидатов', () => {
    const empty = selectCandidate(selectionInput([]));
    expect(empty.trace.rejection).toBe('NO_CANDIDATES');
    expect(empty.trace.candidates).toEqual([]);
    expect(empty.trace.selectionKey).toBeTruthy();
    expect(empty.trace.createdEvents).toEqual([]);

    const failed = makeTemplate({
      preconditions: [{ type: 'fact.comparison', fact: 'resources.blue.fuel.status', operator: 'EQ', value: 'MISSING', required: true, onUnknown: 'NOT_TRUE' }],
    });
    const rejected = selectCandidate(selectionInput([failed]));
    expect(rejected.trace.rejection).toBe('NO_ELIGIBLE_CANDIDATES');
    expect(rejected.trace.candidates[0].rejectionReasons).toContain('PRECONDITION_FAILED');
    expect(rejected.event).toBeNull();
  });

  it('при replay не выполняет новый выбор даже с другим зерном и каталогом', () => {
    const input = makeScheduleInput();
    const first = scheduleInterval(input);
    const replay = scheduleInterval({
      ...input,
      seed: 'completely-different',
      snapshotHash: 'different-snapshot',
      templates: [],
      replay: first,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.createdEvents).toEqual(first.createdEvents);
    expect(replay.traces).toEqual(first.traces);
    expect(replay.trace.controlHash).toBe(first.trace.controlHash);
  });

  it('ручное утверждение не испускает доменные эффекты до решения', () => {
    const approved = selectCandidate({ ...selectionInput(), profile: makeProfile('CUSTOM', { manualApprovalShare: 0 }) });
    expect(approved.event?.operations.some(operation => operation.kind === 'applyWorldEffects')).toBe(true);

    const pending = selectCandidate({ ...selectionInput(), profile: makeProfile('CUSTOM', { manualApprovalShare: 1 }) });
    expect(pending.event?.status).toBe('PENDING_APPROVAL');
    expect(pending.event?.operations.map(operation => operation.kind)).toEqual(['createApprovalRequest']);
    expect(pending.event?.operations[0].payload.proposedOperations).toEqual(expect.any(Array));
    expect(pending.event?.operations[0].payload.proposedOperations).not.toEqual([]);
  });

  it('создаёт связанные, но разные скрытую и участническую вводные с полями RUN-05', () => {
    const result = selectCandidate(selectionInput());
    const inputs = result.event?.operations.filter(operation => operation.kind === 'createInput') ?? [];
    expect(inputs).toHaveLength(2);
    const hidden = inputs.find(operation => operation.payload.visibility === 'CONTROL');
    const visible = inputs.find(operation => operation.payload.visibility === 'PARTICIPANT');
    expect(hidden).toBeDefined();
    expect(visible).toBeDefined();
    expect(hidden?.operationId).not.toBe(visible?.operationId);
    expect(visible?.payload.sourceInputId).toBe(hidden?.payload.inputId);
    expect(visible?.payload).toEqual(expect.objectContaining({
      content: expect.any(String),
      sourceRole: 'SYSTEM_AUTONOMY',
      channelId: 'logistics-channel',
      occurredAtSecond: 0,
      plannedDeliverySecond: expect.any(Number),
      availableAtSecond: expect.any(Number),
      stageId: 'stage-main',
      basisTemplateId: 'logistics.fuel-shortage',
      cancellationRule: expect.any(String),
    }));
    expect(result.event?.operations.some(operation => operation.kind === 'createObservation')).toBe(true);
    expect(result.event?.operations.some(operation => operation.kind === 'createDocumentRevision')).toBe(true);
  });
});
