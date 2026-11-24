import { expect, it } from 'vitest';
import { assertModernImportReady, commitModernImport, previewModernImport } from '../src/forces/modern-import';

const source = { sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'a'.repeat(64), modelInputs: false, simulationValidated: false, characteristics: [{ field: 'speed', value: null }] } as const;

it('сохраняет справочные ограничения и неизвестные поля', () => {
  const result = previewModernImport(source);
  expect(result.status).toBe('IMPORTED');
  expect(result.unknown).toEqual(['speed']);
  expect(result.modelInputs).toBe(false);
  expect(result.simulationValidated).toBe(false);
});

it('создаёт отдельные UUID при повторном импорте и не меняет источник', () => {
  const preview = previewModernImport(source);
  const before = JSON.stringify(source);
  const first = commitModernImport(preview, { sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [], idFactory: () => 'copy-1' });
  const second = commitModernImport(preview, { sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [], idFactory: () => 'copy-2' });
  expect(first.id).toBe('copy-1');
  expect(second.id).toBe('copy-2');
  expect(first.sourceRecordId).toBe('unit-1');
  expect(JSON.stringify(source)).toBe(before);
});

it('требует источник сценарного значения и блокирует расчёт по обязательному пробелу', () => {
  const preview = previewModernImport(source);
  expect(() => commitModernImport(preview, { sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [{ field: 'speed', value: 60 }] })).toThrow('источник или учебное допущение');
  expect(assertModernImportReady(preview, ['speed'])).toEqual(expect.objectContaining({ status: 'REQUIRES_REVIEW', unknown: ['speed'] }));
});
