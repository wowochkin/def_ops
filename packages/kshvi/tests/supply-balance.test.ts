import { expect, it } from 'vitest';
import { resourceBalance, resourceBalanceFromLedger } from '../src/logistics/balance';
import { appendResourceLedgerEntry, projectResourceLedger, type ResourceLedgerEntry } from '../src/logistics/ledger';

it('учитывает груз в пути без создания и потери ресурса', () => {
  const balance = resourceBalance({ initial: 100, received: 20, onHand: 70, inTransit: 30, consumed: 15, lost: 5 });
  expect(balance.expected).toBe(120);
  expect(balance.actual).toBe(120);
  expect(balance.balanced).toBe(true);
});

it('неизвестная номенклатура требует рассмотрения, а не нулевого баланса', () => {
  const balance = resourceBalance({ initial: 100, received: null, onHand: 70, inTransit: 30, consumed: 15, lost: 5 });
  expect(balance).toMatchObject({ status: 'REQUIRES_REVIEW', balanced: false, expected: null, actual: 120, unknown: ['received'] });
});

it('реплей проводок сохраняет баланс по номенклатуре и явно показывает дефицит', () => {
  const base = { resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at: '2030-01-01T06:00:00.000Z', actorId: 'logistics' };
  const input: ResourceLedgerEntry[] = [
    { ...base, id: 'initial', causeId: 'initial', operation: 'OPENING', quantity: 100 },
    { ...base, id: 'received', causeId: 'external-receipt', operation: 'RECEIPT', quantity: 20 },
    { ...base, id: 'reserve', causeId: 's1', supplyId: 's1', operation: 'RESERVE', quantity: 30 },
    { ...base, id: 'dispatch', causeId: 's1', supplyId: 's1', operation: 'DISPATCH', quantity: 30 },
    { ...base, id: 'consume', causeId: 'task-1', taskId: 'task-1', operation: 'CONSUME', quantity: 15, requestedQuantity: 20 },
    { ...base, id: 'loss', causeId: 'loss-1', supplyId: 's1', sourceBucket: 'IN_TRANSIT', operation: 'LOSS', quantity: 5 },
  ];
  let entries: readonly ResourceLedgerEntry[] = [];
  for (const item of input) entries = appendResourceLedgerEntry(entries, item).entries;
  const balance = resourceBalanceFromLedger(projectResourceLedger(entries), 'fuel');
  expect(balance).toMatchObject({ expected: 120, actual: 120, balanced: true, onHand: 75, inTransit: 25, consumed: 15, lost: 5, deficit: 5 });
});
