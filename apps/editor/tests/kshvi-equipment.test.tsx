// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportEquipmentTable,
  importEquipmentTable,
  previewEquipmentGroupChange,
  applyEquipmentGroupChange,
  validateEquipmentEditorRows,
  type EquipmentEditorRow,
} from '../../../packages/kshvi/src/forces/equipment-editor';
import { EquipmentStep, type EquipmentStepOperations } from '../src/modern/kshvi/preparation/EquipmentStep';

afterEach(cleanup);

const operations: EquipmentStepOperations = {
  importTable: importEquipmentTable,
  exportTable: exportEquipmentTable,
  previewGroupChange: previewEquipmentGroupChange,
  applyGroupChange: applyEquipmentGroupChange,
  validateRows: validateEquipmentEditorRows,
};

function counts(serviceable: number, degraded = 0) {
  return { SERVICEABLE: serviceable, DEGRADED: degraded, UNDER_REPAIR: 0, DAMAGED: 0, DESTROYED: 0, UNKNOWN: 0 };
}

function row(overrides: Partial<EquipmentEditorRow> = {}): EquipmentEditorRow {
  return {
    id: 'row-1', forceId: 'force-1', accounting: 'AGGREGATE',
    typeId: 'pontoon', typeRevision: 2, typeSha256: 'b'.repeat(64), typeTitle: 'Понтон учебный', movementClass: 'WHEELED',
    authorized: 2, actual: 2, stateCounts: counts(2), crewRequiredPerUnit: 2, crewAssigned: 4,
    massTonnes: 8, lengthM: 6, widthM: 3, heightM: 2, payloadTonnes: 2, personnelCapacity: 4,
    operatingResources: [{ resourceId: 'fuel', amountPerUnit: 0.1, unit: 'tonne' }],
    allowedTasks: ['CROSSING_BUILD', 'TRANSPORT'], environmentLimits: ['ROAD_WEIGHT_LIMIT'], distribution: [],
    sourceId: 'technical-catalogue', sourceRevision: 3, sourceSha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('шаг технической оснащённости', () => {
  it('показывает сверку штат/факт/исправно и необходимые характеристики', () => {
    render(<EquipmentStep initialRows={[row()]} operations={operations} />);
    expect(screen.getByRole('heading', { name: 'Техническая оснащённость' })).toBeTruthy();
    expect(screen.getByText('Штат: 2 шт.')).toBeTruthy();
    expect(screen.getByText('Факт: 2 шт.')).toBeTruthy();
    expect(screen.getByText('Исправно: 2 шт.')).toBeTruthy();
    expect(screen.getByText('Агрегированный учёт')).toBeTruthy();
    fireEvent.click(screen.getByText('Характеристики row-1'));
    expect(screen.getByText('Масса: 8 tonne')).toBeTruthy();
    expect(screen.getByText('Габариты: 6 × 3 × 2 m')).toBeTruthy();
    expect(screen.getByText('Ёмкость: 2 tonne; личный состав: 4 person')).toBeTruthy();
    expect(screen.getByText('Экипаж: 4 person; требуется на единицу: 2 person')).toBeTruthy();
    expect(screen.getByText('Ресурсы: fuel 0.1 tonne/ед.')).toBeTruthy();
    expect(screen.getByText('Задачи: CROSSING_BUILD, TRANSPORT')).toBeTruthy();
  });

  it('показывает групповой UNKNOWN до применения и затем обновляет строки', () => {
    const onChange = vi.fn();
    render(<EquipmentStep initialRows={[row(), row({ id: 'row-2', actual: null, stateCounts: counts(0), crewAssigned: null })]} operations={operations} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр группового изменения' }));
    expect(screen.getByRole('status').textContent).toContain('REQUIRES_REVIEW');
    expect(screen.getByText('row-1.massTonnes: 8 → UNKNOWN')).toBeTruthy();
    expect(screen.getByText('row-1.crewAssigned: 4 → UNKNOWN')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Применить групповое изменение' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Применить групповое изменение' }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'row-1', massTonnes: null, crewAssigned: null })]));
    expect(screen.getByText('row-1.massTonnes: 8 → UNKNOWN')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Применить групповое изменение' })).toBeNull();
  });

  it('импортирует и экспортирует таблицу с UNKNOWN без Node API', () => {
    const importedRow = row({ id: 'imported-row', actual: null, stateCounts: counts(0), massTonnes: null });
    const csv = exportEquipmentTable([importedRow]);
    render(<EquipmentStep initialRows={[]} operations={operations} />);
    fireEvent.change(screen.getByLabelText('Таблица оснащённости'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать таблицу' }));
    expect(screen.getByText('imported-row')).toBeTruthy();
    expect(screen.getByText('Факт: UNKNOWN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать таблицу' }));
    expect((screen.getByLabelText('Результат экспорта') as HTMLTextAreaElement).value).toContain('imported-row');
    expect((screen.getByLabelText('Результат экспорта') as HTMLTextAreaElement).value).toContain('UNKNOWN');
  });

  it('выводит ошибки контроля сумм и распределения', () => {
    render(<EquipmentStep initialRows={[row({ actual: 1, distribution: [{ targetId: 'child-a', quantity: 2 }] })]} operations={operations} />);
    expect(screen.getByText('Сумма состояний не равна фактическому количеству')).toBeTruthy();
    expect(screen.getByText('Распределение превышает фактическое количество')).toBeTruthy();
  });

  it('использует браузерный вход пакета и не импортирует Node API в компонент', () => {
    const source = readFileSync('apps/editor/src/modern/kshvi/preparation/EquipmentStep.tsx', 'utf8');
    expect(source).toContain("@def-ops/kshvi/browser");
    expect(source).not.toMatch(/from ['"]node:|require\(['"]node:/);
  });
});
