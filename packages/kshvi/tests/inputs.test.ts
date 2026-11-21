import { expect, it } from 'vitest';
import { applyDelegation, proposeInput } from '../src/runtime/input';

it('применяет разрешённую адаптацию и отправляет внеплановую заявку', () => {
  const input = { id: 'input-1', kind: 'ADAPTIVE' as const, severity: 2, areaId: 'area-1', stageId: 'stage-1', effects: [{ type: 'resource.adjust' as const, amount: 2 }] };
  expect(applyDelegation({ allowedSeverities: [1, 2], allowedAreas: ['area-1'], allowedStages: ['stage-1'], allowEffects: true }, input)).toMatchObject({ status: 'APPLIED' });
  expect(applyDelegation({ allowedSeverities: [1], allowedAreas: ['area-1'], allowedStages: ['stage-1'], allowEffects: true }, input)).toMatchObject({ status: 'APPROVAL_REQUIRED', request: { kind: 'INPUT', reason: 'OUTSIDE_DELEGATION' } });
});

it('фиксирует досрочную выдачу, источник, адресатов и отмену без стирания затрат', () => {
  const proposed = proposeInput({ kind: 'PLANNED', sourceRole: 'leader', recipients: ['node-1'], scheduledAt: '2030-01-02T00:00:00Z', actualAt: '2030-01-01T00:00:00Z', channelId: 'channel-1' });
  expect(proposed.deviation).toBe('EARLY');
  expect(proposed.approval.status).toBe('REVIEW_REQUIRED');
});
