import { describe, expect, it } from 'vitest';
import {
  advanceApprovalRoute,
  initialApprovalProgress,
  routeReminders,
  type ApprovalRoute,
} from '../src/documents/approval-router';
import { advanceApproval, resolveDualConflict } from '../src/documents/dual-chain';

const route: ApprovalRoute = {
  id: 'route-1', mode: 'SEQUENTIAL', finalApproverId: 'authority', escalationTo: 'authority',
  delegations: { chief: ['deputy'] }, substitutions: { service: ['service-deputy'] },
  steps: [
    { id: 'command-step', approverId: 'chief', kind: 'REQUIRED', dueAt: '2030-01-01T06:00:00Z', remindAt: '2030-01-01T05:30:00Z' },
    { id: 'service-step', approverId: 'service', kind: 'REQUIRED', dueAt: '2030-01-01T07:00:00Z', remindAt: '2030-01-01T06:30:00Z' },
    { id: 'advisory-step', approverId: 'adviser', kind: 'ADVISORY' },
    { id: 'final-step', approverId: 'authority', kind: 'FINAL', dueAt: '2030-01-01T08:00:00Z' },
  ],
};

describe('настраиваемый маршрут согласования', () => {
  it('поддерживает замещение, последовательность, совещательную подпись и финальное полномочие', () => {
    let progress = initialApprovalProgress(route);
    expect(() => advanceApprovalRoute(route, progress, {
      stepId: 'service-step', actorId: 'service', decision: 'APPROVED', at: '2030-01-01T05:00:00Z', comment: '',
    })).toThrow('последователь');
    progress = advanceApprovalRoute(route, progress, {
      stepId: 'command-step', actorId: 'deputy', decision: 'APPROVED', at: '2030-01-01T05:00:00Z', comment: '',
    });
    progress = advanceApprovalRoute(route, progress, {
      stepId: 'service-step', actorId: 'service-deputy', decision: 'APPROVED', at: '2030-01-01T05:10:00Z', comment: '',
    });
    expect(progress.state).toBe('IN_REVIEW');
    progress = advanceApprovalRoute(route, progress, {
      stepId: 'advisory-step', actorId: 'adviser', decision: 'CHANGES_REQUESTED', at: '2030-01-01T05:15:00Z', comment: 'Совещательное замечание',
    });
    expect(progress.state).toBe('IN_REVIEW');
    expect(() => advanceApprovalRoute(route, progress, {
      stepId: 'final-step', actorId: 'chief', decision: 'APPROVED', at: '2030-01-01T05:20:00Z', comment: '',
    })).toThrow('полномоч');
    progress = advanceApprovalRoute(route, progress, {
      stepId: 'final-step', actorId: 'authority', decision: 'APPROVED', at: '2030-01-01T05:20:00Z', comment: '',
    });
    expect(progress.state).toBe('APPROVED');
    expect(progress.decisions).toHaveLength(4);
  });

  it('возвращает с замечанием и эскалирует только незавершённые обязательные шаги', () => {
    let progress = initialApprovalProgress(route);
    expect(routeReminders(route, progress, '2030-01-01T05:40:00Z')).toEqual([
      { stepId: 'command-step', kind: 'REMINDER', recipientId: 'chief' },
    ]);
    expect(routeReminders(route, progress, '2030-01-01T06:01:00Z')).toEqual([
      { stepId: 'command-step', kind: 'ESCALATION', recipientId: 'authority' },
    ]);
    progress = advanceApprovalRoute(route, progress, {
      stepId: 'command-step', actorId: 'chief', decision: 'CHANGES_REQUESTED', at: '2030-01-01T05:40:00Z', comment: 'Уточнить срок',
    });
    expect(progress.state).toBe('CHANGES_REQUESTED');
    expect(routeReminders(route, progress, '2030-01-01T06:01:00Z')).toEqual([]);
  });

  it('в параллельном маршруте ветви не ждут друг друга', () => {
    const parallel = { ...route, mode: 'PARALLEL' as const };
    const progress = advanceApprovalRoute(parallel, initialApprovalProgress(parallel), {
      stepId: 'service-step', actorId: 'service', decision: 'APPROVED', at: '2030-01-01T05:00:00Z', comment: '',
    });
    expect(progress.decisions[0]).toMatchObject({ stepId: 'service-step', decision: 'APPROVED' });
  });
});

describe('двойная командная и функциональная вертикаль', () => {
  it('не заменяет общее согласование согласием одной ветви', () => {
    const result = advanceApproval(
      { command: 'APPROVED', service: 'CHANGES_REQUESTED' },
      { actor: 'commander', decision: 'APPROVED' },
    );
    expect(result.state).toBe('CONFLICT');
    expect(result.finalApprover).toBe('designatedAuthority');
    expect(result.command).toBe('APPROVED');
    expect(result.service).toBe('CHANGES_REQUESTED');
  });

  it('показывает обе позиции и разрешает конфликт только назначенной инстанцией', () => {
    let state = advanceApproval(
      { command: 'PENDING', service: 'PENDING' },
      { actor: 'commander', branch: 'command', decision: 'APPROVED', comment: 'Согласовано' },
    );
    expect(state.state).toBe('IN_REVIEW');
    state = advanceApproval(state, {
      actor: 'service', branch: 'service', decision: 'CHANGES_REQUESTED', comment: 'Несовместимый срок',
    });
    expect(state.state).toBe('CONFLICT');
    expect(state.positions).toEqual({ command: 'Согласовано', service: 'Несовместимый срок' });
    expect(() => resolveDualConflict(state, { actor: 'commander', decision: 'APPROVED', comment: 'Обход' })).toThrow('полномоч');
    const resolved = resolveDualConflict(state, { actor: 'designatedAuthority', decision: 'APPROVED', comment: 'Срок 06:00 обязателен' });
    expect(resolved.state).toBe('APPROVED');
    expect(resolved.command).toBe('APPROVED');
    expect(resolved.service).toBe('CHANGES_REQUESTED');
    expect(resolved.resolution).toEqual({ actor: 'designatedAuthority', decision: 'APPROVED', comment: 'Срок 06:00 обязателен' });
  });
});
