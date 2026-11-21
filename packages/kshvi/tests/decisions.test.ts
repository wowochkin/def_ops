import { describe, expect, it } from 'vitest';
import {
  DECISION_CYCLE_ELEMENTS,
  completeExercise,
  createDecision,
  createDecisionCycle,
  projectDecision,
  recordDecisionElement,
  reviseDecision,
  transitionDecision,
} from '../src/decisions/decision-cycle';
import { advanceOrder, cancelOrder, issueOrder } from '../src/decisions/order-execution';

const decisionInput = {
  id: 'decision-blue-1',
  sideId: 'blue',
  authorId: 'commander-blue',
  intent: 'Скрытый замысел синих',
  goals: [{ id: 'goal-1', rank: 1, title: 'Удержать рубеж' }],
  tasks: [{ id: 'task-1', assigneeId: 'node-1', title: 'Подготовить позицию' }],
  resources: [{ resourceId: 'fuel', amount: 20, unit: 'L' }],
  deadlines: [{ taskId: 'task-1', operationalAt: '2030-01-01T02:00:00Z' }],
  coordination: [{ withNodeId: 'node-2', subject: 'Стыки' }],
  reserves: [{ forceId: 'reserve-1', condition: 'По отдельному приказу' }],
  transitionConditions: [{ id: 'condition-1', expression: 'task-1.completed' }],
  assumptions: [{ id: 'assumption-1', text: 'Учебное допущение: связь устойчива' }],
} as const;

describe('цикл решения обучаемого', () => {
  it('поддерживает все девять элементов без навязанного порядка', () => {
    expect(DECISION_CYCLE_ELEMENTS).toHaveLength(9);
    let cycle = createDecisionCycle();
    cycle = recordDecisionElement(cycle, { element: 'DECISION_ADJUSTMENT', at: '2030-01-01T01:09:00Z', data: { basis: 'новое донесение' } });
    cycle = recordDecisionElement(cycle, { element: 'TASK_CLARIFICATION', at: '2030-01-01T01:01:00Z', data: { task: 'уточнена' } });
    cycle = recordDecisionElement(cycle, { element: 'EXECUTION_CONTROL', at: '2030-01-01T01:08:00Z', data: { received: true } });
    expect(cycle.entries.map(entry => entry.element)).toEqual(['DECISION_ADJUSTMENT', 'TASK_CLARIFICATION', 'EXECUTION_CONTROL']);
    expect(cycle.entries[0].data).toEqual({ basis: 'новое донесение' });
  });

  it('не смешивает статусы решения и сохраняет его содержание', () => {
    const draft = createDecision(decisionInput);
    expect(draft.status).toBe('DRAFT');
    expect(draft.goals[0].rank).toBe(1);
    expect(draft.resources[0]).toEqual({ resourceId: 'fuel', amount: 20, unit: 'L' });
    const accepted = transitionDecision(draft, 'ACCEPTED', '2030-01-01T01:10:00Z');
    const delivered = transitionDecision(accepted, 'DELIVERED', '2030-01-01T01:20:00Z');
    const executing = transitionDecision(delivered, 'EXECUTING', '2030-01-01T01:30:00Z');
    const completed = transitionDecision(executing, 'COMPLETED', '2030-01-01T02:00:00Z');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.statusHistory.map(item => item.status)).toEqual(['DRAFT', 'ACCEPTED', 'DELIVERED', 'EXECUTING', 'COMPLETED']);
    expect(() => transitionDecision(draft, 'COMPLETED', '2030-01-01T01:10:00Z')).toThrow('переход');
  });

  it('создаёт новую версию при корректировке без перезаписи прежней', () => {
    const original = createDecision(decisionInput);
    const revised = reviseDecision(original, { intent: 'Уточнённый замысел синих' }, '2030-01-01T01:15:00Z');
    expect(revised.id).not.toBe(original.id);
    expect(revised.revision).toBe(2);
    expect(revised.supersedes).toBe(original.id);
    expect(revised.status).toBe('DRAFT');
    expect(original.intent).toBe('Скрытый замысел синих');
    expect(original.revision).toBe(1);
  });

  it('не раскрывает замысел и служебные поля другой стороне', () => {
    const decision = createDecision(decisionInput);
    const own = projectDecision(decision, { sideId: 'blue', role: 'TRAINEE' });
    expect(own).toMatchObject({ intent: 'Скрытый замысел синих' });
    const other = projectDecision(decision, { sideId: 'red', role: 'TRAINEE' });
    expect(JSON.stringify(other)).not.toContain('Скрытый замысел синих');
    expect(JSON.stringify(other)).not.toContain('assumptions');
    expect(other).toEqual({ id: decision.id, sideId: 'blue', status: 'DRAFT', visibility: 'EXISTS_WITHOUT_CONTENT' });
    expect(() => projectDecision(decision, { sideId: 'red', role: 'INTERMEDIARY', assignedNodeIds: ['other'] })).toThrow('403');
  });

  it('завершает учение только решением руководителя и не объявляет победителя', () => {
    const result = completeExercise({
      leaderApproved: true,
      stageConditionsMet: true,
      snapshot: { revision: 8 },
      unfinishedEvents: [{ id: 'event-1', reason: 'Доставка не завершена' }],
      reviewMaterials: [{ id: 'review-1', title: 'Материалы разбора' }],
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.snapshot).toEqual({ revision: 8 });
    expect(result.unfinishedEvents).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('winner');
    expect(JSON.stringify(result)).not.toContain('score');
    expect(() => completeExercise({ leaderApproved: false, stageConditionsMet: true, snapshot: {}, unfinishedEvents: [], reviewMaterials: [] })).toThrow('руководителя');
  });
});

describe('исполнение приказа', () => {
  const input = {
    id: 'order-1', decisionId: 'decision-blue-1', issuerNodeId: 'node-command', executorNodeId: 'node-1', sideId: 'blue',
    issuedAt: '2030-01-01T01:00:00Z', taskId: 'task-1', plannedResources: { fuel: 5 },
  } as const;

  it('проходит доставку, обработку, подготовку, исполнение и доклад без мгновенного исхода', () => {
    const issued = issueOrder(input);
    expect(issued.status).toBe('AWAITING_DELIVERY');
    expect(issued.position).toBeNull();
    expect(issued.actualCosts).toEqual({ timeMinutes: 0, resources: {} });
    const delivered = advanceOrder(issued, { type: 'DELIVER', at: '2030-01-01T01:05:00Z' });
    const processing = advanceOrder(delivered, { type: 'PROCESS', at: '2030-01-01T01:06:00Z' });
    const preparing = advanceOrder(processing, { type: 'PREPARE', at: '2030-01-01T01:07:00Z' });
    const executing = advanceOrder(preparing, { type: 'START_EXECUTION', at: '2030-01-01T01:10:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } });
    expect(executing.status).toBe('EXECUTING');
    expect(executing.position?.remainingMeters).toBe(5000);
    const reported = advanceOrder(executing, { type: 'REPORT', at: '2030-01-01T01:40:00Z', outcome: 'PARTIALLY_COMPLETED', reason: 'Дефицит ГСМ', position: { remainingMeters: 1800, travelledMeters: 3200 } });
    expect(reported.status).toBe('REPORTED');
    expect(reported.outcome).toBe('PARTIALLY_COMPLETED');
    expect(reported.position?.travelledMeters).toBe(3200);
    expect(() => advanceOrder(issued, { type: 'START_EXECUTION', at: '2030-01-01T01:10:00Z' })).toThrow('последовательность');
  });

  it('отменяет приказ до получения без затрат и ресурсных эффектов', () => {
    const issued = issueOrder(input);
    const cancelled = cancelOrder(issued, { at: '2030-01-01T01:03:00Z', reason: 'Изменена задача' });
    expect(cancelled.status).toBe('CANCELLED_BEFORE_RECEIPT');
    expect(cancelled.receivedAt).toBeNull();
    expect(cancelled.actualCosts).toEqual({ timeMinutes: 0, resources: {} });
  });

  it('отмена после получения и начала исполнения сохраняет затраты и пройденный путь', () => {
    let order = issueOrder(input);
    order = advanceOrder(order, { type: 'DELIVER', at: '2030-01-01T01:05:00Z' });
    order = advanceOrder(order, { type: 'PROCESS', at: '2030-01-01T01:06:00Z' });
    order = advanceOrder(order, { type: 'PREPARE', at: '2030-01-01T01:07:00Z' });
    order = advanceOrder(order, { type: 'START_EXECUTION', at: '2030-01-01T01:10:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } });
    order = advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:20:00Z', timeMinutes: 10, resources: { fuel: 2 }, position: { remainingMeters: 4000, travelledMeters: 1000 } });
    const cancelled = cancelOrder(order, { at: '2030-01-01T01:21:00Z', reason: 'Прекратить выполнение' });
    expect(cancelled.status).toBe('CANCELLED_AFTER_RECEIPT');
    expect(cancelled.actualCosts).toEqual({ timeMinutes: 10, resources: { fuel: 2 } });
    expect(cancelled.position).toEqual({ remainingMeters: 4000, travelledMeters: 1000 });
    expect(order.actualCosts).toEqual({ timeMinutes: 10, resources: { fuel: 2 } });
  });

  it('фиксирует отклонение и невыполнение с самостоятельной причиной', () => {
    const issued = issueOrder(input);
    const rejected = advanceOrder(issued, { type: 'REJECT', at: '2030-01-01T01:04:00Z', reason: 'Приказ не получен: канал недоступен' });
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.reason).toContain('канал');
    expect(rejected.status).toBe('REPORTED');
  });
});
