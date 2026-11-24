import { describe, expect, it } from 'vitest';
import {
  createEquipmentHolding,
  EQUIPMENT_CONDITIONS,
  type EquipmentHoldingInput,
  type EquipmentMeasure,
  type EquipmentType,
} from '../src/forces/equipment';
import {
  allocateEquipment,
  assignEquipmentTask,
  equipmentCapabilities,
  evaluateEquipmentTask,
  transferEquipment,
  transitionEquipment,
} from '../src/forces/equipment-state';
import {
  applyEquipmentGroupChange,
  createEquipmentRowsFromTemplate,
  equipmentHoldingFromRow,
  equipmentRowFromHolding,
  exportEquipmentTable,
  importEquipmentTable,
  previewEquipmentGroupChange,
  validateEquipmentEditorRows,
  type EquipmentEditorRow,
} from '../src/forces/equipment-editor';

const AT = '2026-11-22T09:00:00.000Z';
const LATER = '2026-11-22T10:00:00.000Z';
const source = { sourceId: 'technical-catalogue', revision: 3, sha256: 'a'.repeat(64), note: 'Учебный сценарный тип' } as const;

function measure(value: number | null, unit: string): EquipmentMeasure {
  return value === null
    ? { status: 'UNKNOWN', value: null, unit, reason: 'Нет утверждённого значения' }
    : { status: 'KNOWN', value, unit, source };
}

const pontoon: EquipmentType = {
  id: 'pontoon',
  revision: 2,
  sha256: 'b'.repeat(64),
  title: 'Понтон учебный',
  movementClass: 'WHEELED',
  massTonnes: measure(8, 'tonne'),
  dimensions: { lengthM: measure(6, 'm'), widthM: measure(3, 'm'), heightM: measure(2, 'm') },
  transportCapacity: { payloadTonnes: measure(2, 'tonne'), personnel: measure(4, 'person') },
  operatingResources: [{ resourceId: 'fuel', amountPerUnit: 0.1, unit: 'tonne', source }],
  allowedTasks: ['CROSSING_BUILD', 'TRANSPORT'],
  environmentLimits: ['ROAD_WEIGHT_LIMIT', 'CROSSING_CAPACITY'],
};

function counts(serviceable: number, degraded = 0, underRepair = 0, damaged = 0, destroyed = 0, unknown = 0) {
  return { SERVICEABLE: serviceable, DEGRADED: degraded, UNDER_REPAIR: underRepair, DAMAGED: damaged, DESTROYED: destroyed, UNKNOWN: unknown };
}

function aggregateInput(overrides: Partial<EquipmentHoldingInput> = {}): EquipmentHoldingInput {
  return {
    id: 'holding-1',
    forceId: 'force-1',
    accounting: 'AGGREGATE',
    equipmentType: pontoon,
    authorized: 2,
    actual: 2,
    stateCounts: counts(2),
    crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(4, 'person') },
    distribution: [],
    source,
    ...overrides,
  };
}

function editorRow(overrides: Partial<EquipmentEditorRow> = {}): EquipmentEditorRow {
  return {
    id: 'row-1', forceId: 'force-1', accounting: 'AGGREGATE',
    typeId: 'pontoon', typeRevision: 2, typeSha256: 'b'.repeat(64), typeTitle: 'Понтон учебный',
    movementClass: 'WHEELED', authorized: 2, actual: 2, stateCounts: counts(2),
    crewRequiredPerUnit: 2, crewAssigned: 4,
    massTonnes: 8, lengthM: 6, widthM: 3, heightM: 2,
    payloadTonnes: 2, personnelCapacity: 4,
    operatingResources: [{ resourceId: 'fuel', amountPerUnit: 0.1, unit: 'tonne' }],
    allowedTasks: ['CROSSING_BUILD', 'TRANSPORT'], environmentLimits: ['ROAD_WEIGHT_LIMIT'],
    distribution: [], sourceId: source.sourceId, sourceRevision: source.revision, sourceSha256: source.sha256,
    ...overrides,
  };
}

describe('ведомость технической оснащённости', () => {
  it('хранит штат, факт, характеристики и источники без подмены UNKNOWN', () => {
    const unknownType = { ...pontoon, massTonnes: measure(null, 'tonne') };
    const holding = createEquipmentHolding(aggregateInput({ equipmentType: unknownType, authorized: null }));
    expect(holding.authorized).toBeNull();
    expect(holding.actual).toBe(2);
    expect(holding.equipmentType.massTonnes.status).toBe('UNKNOWN');
    expect(holding.equipmentType.dimensions).toEqual(pontoon.dimensions);
    expect(holding.equipmentType.transportCapacity.payloadTonnes).toMatchObject({ value: 2, unit: 'tonne', source });
    expect(holding.equipmentType.allowedTasks).toEqual(['CROSSING_BUILD', 'TRANSPORT']);
    expect(holding.equipmentType.operatingResources[0]).toMatchObject({ resourceId: 'fuel', source });
    expect(holding.crew).toEqual({ requiredPerUnit: measure(2, 'person'), assigned: measure(4, 'person') });
    expect(holding.initial.stateCounts).toEqual(counts(2));
    expect(EQUIPMENT_CONDITIONS).toEqual(['SERVICEABLE', 'DEGRADED', 'UNDER_REPAIR', 'DAMAGED', 'DESTROYED', 'UNKNOWN']);
  });

  it('выводит факт и состояния поштучного учёта из уникальных единиц', () => {
    const holding = createEquipmentHolding(aggregateInput({
      accounting: 'INDIVIDUAL',
      actual: null,
      stateCounts: counts(0),
      items: [
        { unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE' },
        { unitId: 'unit-2', serialNumber: 'П-002', state: 'DEGRADED' },
      ],
    }));
    expect(holding.actual).toBe(2);
    expect(holding.stateCounts).toEqual(counts(1, 1));
    expect(holding.items.map(item => item.unitId)).toEqual(['unit-1', 'unit-2']);
    expect(() => createEquipmentHolding(aggregateInput({
      accounting: 'INDIVIDUAL', items: [{ unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE' }, { unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE' }],
    }))).toThrow('уникаль');
  });

  it('распределяет агрегат как полный снимок без двойного учёта и контролирует остаток', () => {
    const initial = createEquipmentHolding(aggregateInput());
    const allocated = allocateEquipment(initial, [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }]);
    expect(allocated.distribution).toEqual([{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }]);
    expect(allocated.unallocated).toBe(0);
    const repeated = allocateEquipment(allocated, [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }]);
    expect(repeated.distribution).toHaveLength(2);
    expect(repeated.distribution.reduce((sum, item) => sum + item.quantity, 0)).toBe(2);
    expect(initial.distribution).toEqual([]);
    expect(() => allocateEquipment(initial, [{ targetId: 'child-a', quantity: 3 }])).toThrow('превышает фактическое');
    expect(() => allocateEquipment(initial, [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-a', quantity: 1 }])).toThrow('повторно');
  });

  it('не допускает двойного распределения одной поштучной записи', () => {
    const initial = createEquipmentHolding(aggregateInput({
      accounting: 'INDIVIDUAL', actual: null, stateCounts: counts(0),
      items: [{ unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE' }, { unitId: 'unit-2', serialNumber: 'П-002', state: 'SERVICEABLE' }],
    }));
    const allocated = allocateEquipment(initial, [{ targetId: 'child-a', unitIds: ['unit-1'] }, { targetId: 'child-b', unitIds: ['unit-2'] }]);
    expect(allocated.items.find(item => item.unitId === 'unit-1')?.assignedTo).toBe('child-a');
    expect(allocated.unallocated).toBe(0);
    expect(() => allocateEquipment(initial, [{ targetId: 'child-a', unitIds: ['unit-1'] }, { targetId: 'child-b', unitIds: ['unit-1'] }])).toThrow('дважды');
  });
});

describe('событийный автомат состояния техники', () => {
  it('поддерживает разрешённые переходы с причиной, ресурсами, событием и историей', () => {
    const transitioned = transitionEquipment({ state: 'SERVICEABLE' }, {
      to: 'UNDER_REPAIR', causeId: 'fault-1', eventId: 'event-1', at: AT, reason: 'Отказ механизма', resources: [],
    });
    expect(transitioned).toMatchObject({ state: 'UNDER_REPAIR', causeId: 'fault-1' });
    expect(transitioned.history).toHaveLength(1);
    expect(transitioned.history[0]).toMatchObject({ eventId: 'event-1', from: 'SERVICEABLE', to: 'UNDER_REPAIR', at: AT, resources: [] });
    expect(transitionEquipment(transitioned, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'event-2', at: LATER, reason: 'Ремонт завершён',
      resources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
    }).state).toBe('SERVICEABLE');
  });

  it('не проводит несовместимый переход и не списывает ресурсы повторно по eventId', () => {
    const repaired = transitionEquipment({ state: 'UNDER_REPAIR' }, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'repair-event', at: AT, reason: 'Заменён узел',
      resources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
    });
    const repeated = transitionEquipment(repaired, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'repair-event', at: AT, reason: 'Заменён узел',
      resources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
    });
    expect(repeated).toBe(repaired);
    expect(repeated.history).toHaveLength(1);
    expect(repeated.resourceBalances['spare-part']).toMatchObject({ amount: 0 });
    expect(() => transitionEquipment({ state: 'DESTROYED' }, {
      to: 'SERVICEABLE', causeId: 'repair-2', eventId: 'event-2', at: LATER, reason: 'Недопустимое восстановление', resources: [],
    })).toThrow('Несовместимый переход');
    expect(() => transitionEquipment({ state: 'UNDER_REPAIR' }, {
      to: 'SERVICEABLE', causeId: 'repair-3', eventId: 'event-3', at: LATER, reason: 'Нет запчасти',
      resources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }], availableResources: [],
    })).toThrow('Недостаточно ресурса');
  });

  it('меняет текущее состояние ведомости, не перезаписывая исходный снимок', () => {
    const initial = createEquipmentHolding(aggregateInput());
    const changed = transitionEquipment(initial, {
      from: 'SERVICEABLE', to: 'DEGRADED', quantity: 1, causeId: 'fault-1', eventId: 'event-1', at: AT, reason: 'Повреждение', resources: [],
    });
    expect(changed.stateCounts).toEqual(counts(1, 1));
    expect(changed.initial.stateCounts).toEqual(counts(2));
    expect(initial.stateCounts).toEqual(counts(2));
    expect(changed.history.map(event => event.eventId)).toEqual(['event-1']);
  });
});

describe('влияние техники на возможности и задачи', () => {
  it('не создаёт возможность наведения переправы из неисправной или номинальной записи', () => {
    expect(equipmentCapabilities({ type: 'pontoon', serviceable: 0, degraded: 1 })).not.toContain('CROSSING_BUILD');
    expect(equipmentCapabilities({ type: 'pontoon', serviceable: 1, degraded: 0 })).toContain('CROSSING_BUILD');
    const nominalOnly = createEquipmentHolding(aggregateInput({ actual: 0, stateCounts: counts(0) }));
    expect(equipmentCapabilities(nominalOnly)).toEqual([]);
  });

  it('в пороговом парном сценарии восстанавливает задачу только после ремонта', () => {
    const initial = createEquipmentHolding(aggregateInput({ authorized: 1, actual: 1, stateCounts: counts(1), crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(2, 'person') } }));
    const task = { kind: 'CROSSING_BUILD', requiredUnits: 1 } as const;
    expect(evaluateEquipmentTask({ holdings: [initial], task })).toMatchObject({ status: 'ALLOWED', allowed: true });

    const degraded = transitionEquipment(initial, { from: 'SERVICEABLE', to: 'DEGRADED', quantity: 1, causeId: 'fault-1', eventId: 'fault-event', at: AT, reason: 'Отказ', resources: [] });
    expect(evaluateEquipmentTask({ holdings: [degraded], task })).toMatchObject({ status: 'BLOCKED', allowed: false });
    expect(equipmentCapabilities(degraded)).not.toContain('CROSSING_BUILD');

    const repairing = transitionEquipment(degraded, { from: 'DEGRADED', to: 'UNDER_REPAIR', quantity: 1, causeId: 'repair-order', eventId: 'repair-start', at: AT, reason: 'Начат ремонт', resources: [] });
    const repaired = transitionEquipment(repairing, {
      from: 'UNDER_REPAIR', to: 'SERVICEABLE', quantity: 1, causeId: 'repair-complete', eventId: 'repair-finish', at: LATER, reason: 'Проверка после ремонта',
      resources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }], availableResources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
    });
    const repeatedTask = evaluateEquipmentTask({ holdings: [repaired], task });
    expect(repeatedTask).toMatchObject({ status: 'ALLOWED', allowed: true, serviceableUnits: 1 });
    expect(repaired.history.map(event => event.eventId)).toEqual(['fault-event', 'repair-start', 'repair-finish']);
    expect(repaired.initial.stateCounts).toEqual(counts(1));
  });

  it('учитывает экипаж, ёмкость, массу, габариты и ресурсы без нормализации UNKNOWN', () => {
    const holding = createEquipmentHolding(aggregateInput());
    expect(evaluateEquipmentTask({ holdings: [holding], task: { kind: 'TRANSPORT', requiredUnits: 1, requiredPayloadTonnes: 5 } })).toMatchObject({ allowed: false, reasons: expect.arrayContaining(['Недостаточная грузовая ёмкость']) });
    expect(evaluateEquipmentTask({ holdings: [holding], task: { kind: 'TRANSPORT', requiredUnits: 1, requiredPayloadTonnes: 4, requiredResources: [{ resourceId: 'fuel', amount: 0.2, unit: 'tonne' }], availableResources: [{ resourceId: 'fuel', amount: 0.1, unit: 'tonne' }] } })).toMatchObject({ allowed: false, reasons: expect.arrayContaining(['Недостаточно ресурса fuel']) });
    const unknownMass = createEquipmentHolding(aggregateInput({ equipmentType: { ...pontoon, massTonnes: measure(null, 'tonne') } }));
    expect(evaluateEquipmentTask({ holdings: [unknownMass], task: { kind: 'TRANSPORT', requiredUnits: 1, maxMassTonnes: 10 } })).toMatchObject({ status: 'REQUIRES_REVIEW', allowed: false, unknown: ['massTonnes'] });
    const noCrew = createEquipmentHolding(aggregateInput({ crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(1, 'person') } }));
    expect(evaluateEquipmentTask({ holdings: [noCrew], task: { kind: 'CROSSING_BUILD', requiredUnits: 1 } })).toMatchObject({ allowed: false, reasons: expect.arrayContaining(['Недостаточно экипажа']) });
  });

  it('резервирует запись для задачи один раз', () => {
    const initial = createEquipmentHolding(aggregateInput({ authorized: 1, actual: 1, stateCounts: counts(1), crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(2, 'person') } }));
    const assigned = assignEquipmentTask(initial, { assignmentId: 'assignment-1', kind: 'CROSSING_BUILD', quantity: 1, at: AT, causeId: 'order-1' });
    expect(assigned.assignments).toHaveLength(1);
    expect(assignEquipmentTask(assigned, { assignmentId: 'assignment-1', kind: 'CROSSING_BUILD', quantity: 1, at: AT, causeId: 'order-1' })).toBe(assigned);
    expect(() => assignEquipmentTask(assigned, { assignmentId: 'assignment-2', kind: 'CROSSING_BUILD', quantity: 1, at: LATER, causeId: 'order-2' })).toThrow('занята');
  });
});

describe('табличный редактор оснащённости', () => {
  it('импортирует и экспортирует характеристики, сохраняя неизвестные поля как UNKNOWN', () => {
    const imported = importEquipmentTable([
      'id;forceId;typeId;typeRevision;typeSha256;authorized;actual;SERVICEABLE;DEGRADED;UNDER_REPAIR;DAMAGED;DESTROYED;UNKNOWN;crewAssigned;massTonnes;sourceId',
      'row-1;force-1;pontoon;2;' + 'b'.repeat(64) + ';2;1;1;0;0;0;0;0;2;8;technical-catalogue',
      'row-2;force-1;pontoon;2;' + 'b'.repeat(64) + ';;;;;;;;;;;technical-catalogue',
    ].join('\n'));
    expect(imported.rows[0]).toMatchObject({ id: 'row-1', authorized: 2, actual: 1, massTonnes: 8 });
    expect(imported.rows[1]).toMatchObject({ authorized: null, actual: null, massTonnes: null });
    expect(imported.rows[1].stateCounts.UNKNOWN).toBeNull();
    expect(imported.unknown).toEqual(expect.arrayContaining(['row-2.authorized', 'row-2.actual', 'row-2.massTonnes', 'row-2.crewAssigned']));
    const exported = exportEquipmentTable(imported.rows);
    expect(exported).toContain('UNKNOWN');
    expect(importEquipmentTable(exported).rows[1]).toMatchObject({ authorized: null, actual: null, massTonnes: null });
  });

  it('конвертирует строку в доменную ведомость и обратно без потери ресурсов и задач', () => {
    const row = editorRow();
    const holding = equipmentHoldingFromRow(row);
    expect(holding.equipmentType.operatingResources[0]).toMatchObject({ resourceId: 'fuel', amountPerUnit: 0.1 });
    expect(equipmentRowFromHolding(holding)).toEqual(row);
  });

  it('показывает групповой предпросмотр UNKNOWN до применения и не превращает пробел в ноль', () => {
    const rows = [editorRow(), editorRow({ id: 'row-2', actual: null, crewAssigned: null, stateCounts: counts(0) })];
    const preview = previewEquipmentGroupChange(rows, ['row-1', 'row-2'], { massTonnes: null, crewAssigned: null });
    expect(preview.status).toBe('REQUIRES_REVIEW');
    expect(preview.unknown).toEqual(expect.arrayContaining(['row-1.massTonnes', 'row-1.crewAssigned', 'row-2.massTonnes', 'row-2.crewAssigned']));
    expect(preview.changes.find(change => change.rowId === 'row-1' && change.field === 'massTonnes')).toMatchObject({ from: 8, to: null, status: 'UNKNOWN' });
    expect(rows[0].massTonnes).toBe(8);
    const changed = applyEquipmentGroupChange(rows, preview);
    expect(changed[0]).toMatchObject({ massTonnes: null, crewAssigned: null });
    expect(changed[1].actual).toBeNull();
  });

  it('контролирует сумму состояний и распределения', () => {
    const issues = validateEquipmentEditorRows([editorRow({ actual: 1, distribution: [{ targetId: 'child-a', quantity: 2 }] })]);
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['STATE_SUM_MISMATCH', 'DISTRIBUTION_EXCEEDS_ACTUAL']));
  });

  it('заполняет факт и неизвестные характеристики по организационному шаблону без выдуманных значений', () => {
    const rows = createEquipmentRowsFromTemplate([{ id: 'template-row', forceId: 'force-1', typeId: 'pontoon', typeRevision: 2, typeSha256: 'b'.repeat(64), authorized: 4, allowedTasks: ['CROSSING_BUILD'], sourceId: 'org-template' }]);
    expect(rows[0]).toMatchObject({ id: 'template-row', authorized: 4, actual: null, massTonnes: null, crewAssigned: null, allowedTasks: ['CROSSING_BUILD'] });
    expect(validateEquipmentEditorRows(rows).some(issue => issue.code === 'STATE_SUM_MISMATCH')).toBe(false);
  });
});


describe('события передачи и потери', () => {
  it('фиксирует передачу с причиной и временем без двойного распределения и перезаписи исходной ведомости', () => {
    const initial = createEquipmentHolding(aggregateInput());
    const transferred = transferEquipment(initial, {
      eventId: 'transfer-1', at: AT, causeId: 'order-transfer', reason: 'Передача подчинённому', resources: [],
      allocations: [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }],
    });
    expect(transferred.distribution).toEqual([{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }]);
    expect(transferred.history[0]).toMatchObject({ eventId: 'transfer-1', kind: 'TRANSFER', at: AT, causeId: 'order-transfer' });
    expect(transferred.initial.distribution).toEqual([]);
    expect(initial.history).toEqual([]);
    expect(transferEquipment(transferred, {
      eventId: 'transfer-1', at: AT, causeId: 'order-transfer', reason: 'Передача подчинённому', resources: [],
      allocations: [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }],
    })).toBe(transferred);
  });

  it('отличает событие потери и реально исключает единицу из возможностей', () => {
    const initial = createEquipmentHolding(aggregateInput({ authorized: 1, actual: 1, stateCounts: counts(1), crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(2, 'person') } }));
    const lost = transitionEquipment(initial, {
      kind: 'LOSS', from: 'SERVICEABLE', to: 'DESTROYED', quantity: 1,
      causeId: 'loss-1', eventId: 'loss-event', at: AT, reason: 'Безвозвратная потеря', resources: [],
    });
    expect(lost.history[0]).toMatchObject({ kind: 'LOSS', causeId: 'loss-1', at: AT });
    expect(equipmentCapabilities(lost)).toEqual([]);
    expect(lost.initial.stateCounts).toEqual(counts(1));
  });
});

describe('поштучный табличный обмен', () => {
  it('сохраняет идентификаторы, серийные номера и состояния единиц при round-trip', () => {
    const initial = createEquipmentHolding(aggregateInput({
      accounting: 'INDIVIDUAL', actual: null, stateCounts: counts(0),
      items: [{ unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE' }, { unitId: 'unit-2', serialNumber: 'П-002', state: 'DEGRADED' }],
    }));
    const restoredRows = importEquipmentTable(exportEquipmentTable([equipmentRowFromHolding(initial)])).rows;
    expect(restoredRows[0].items).toEqual([
      { unitId: 'unit-1', serialNumber: 'П-001', state: 'SERVICEABLE', causeId: null, assignedTo: null },
      { unitId: 'unit-2', serialNumber: 'П-002', state: 'DEGRADED', causeId: null, assignedTo: null },
    ]);
    const restored = equipmentHoldingFromRow(restoredRows[0]);
    expect(restored.actual).toBe(2);
    expect(restored.stateCounts).toEqual(counts(1, 1));
  });
});


describe('контрпримеры независимой ревизии оснащённости', () => {
  it('сохраняет UNKNOWN состояния и typeRevision вместо нуля и первой версии', () => {
    const result = importEquipmentTable([
      'id;forceId;typeId;typeRevision;typeSha256;actual;SERVICEABLE;DEGRADED;UNDER_REPAIR;DAMAGED;DESTROYED;UNKNOWN;sourceId;sourceRevision;sourceSha256',
      `row-unknown;force-1;pontoon;;${'b'.repeat(64)};1;UNKNOWN;0;0;0;1;0;technical-catalogue;1;${'a'.repeat(64)}`,
    ].join('\n'));
    expect(result.rows[0].stateCounts.SERVICEABLE).toBeNull();
    expect(result.rows[0].typeRevision).toBeNull();
    expect(result.unknown).toEqual(expect.arrayContaining(['row-unknown.SERVICEABLE', 'row-unknown.typeRevision']));
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['STATE_UNKNOWN', 'TYPE_REVISION_UNKNOWN']));
    expect(() => equipmentHoldingFromRow(result.rows[0])).toThrow('UNKNOWN');
  });

  it('обнаруживает конфликт payload при повторном eventId', () => {
    const repaired = transitionEquipment({ state: 'UNDER_REPAIR' }, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'repair-event', at: AT, reason: 'Заменён узел',
      resources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
    });
    expect(() => transitionEquipment(repaired, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'repair-event', at: AT, reason: 'Другая команда с тем же eventId',
      resources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
    })).toThrow('Конфликт идемпотентности');
    expect(() => transitionEquipment(repaired, {
      to: 'SERVICEABLE', causeId: 'repair-1', eventId: 'repair-event', at: AT, reason: 'Заменён узел',
      resources: [{ resourceId: 'spare-part', amount: 2, unit: 'pcs' }],
      availableResources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
    })).toThrow('Конфликт идемпотентности');
  });

  it('обнаруживает конфликт ресурсов и распределения при повторной передаче', () => {
    const initial = createEquipmentHolding(aggregateInput());
    const transferred = transferEquipment(initial, {
      eventId: 'transfer-conflict', at: AT, causeId: 'order-transfer', reason: 'Передача', resources: [],
      availableResources: [{ resourceId: 'fuel', amount: 2, unit: 'tonne' }],
      allocations: [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }],
    });
    expect(() => transferEquipment(transferred, {
      eventId: 'transfer-conflict', at: AT, causeId: 'order-transfer', reason: 'Передача', resources: [],
      availableResources: [{ resourceId: 'fuel', amount: 1, unit: 'tonne' }],
      allocations: [{ targetId: 'child-a', quantity: 1 }, { targetId: 'child-b', quantity: 1 }],
    })).toThrow('Конфликт идемпотентности');
    expect(() => transferEquipment(transferred, {
      eventId: 'transfer-conflict', at: AT, causeId: 'order-transfer', reason: 'Передача', resources: [],
      availableResources: [{ resourceId: 'fuel', amount: 2, unit: 'tonne' }],
      allocations: [{ targetId: 'child-a', quantity: 2 }],
    })).toThrow('Конфликт идемпотентности');
  });
});
