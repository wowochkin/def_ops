// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyPreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { RouteGraph } from '../../../packages/kshvi/src/terrain/route-graph';
import type { TerrainState } from '../../../packages/kshvi/src/terrain/types';
import {
  applyEquipmentGroupChange, exportEquipmentTable, importEquipmentTable,
  previewEquipmentGroupChange, validateEquipmentEditorRows, type EquipmentEditorRow,
} from '../../../packages/kshvi/src/forces/equipment-editor';
import { createScenarioForce } from '../src/modern/kshvi/preparation/force-operations';
import { EquipmentStep, type EquipmentStepOperations } from '../src/modern/kshvi/preparation/EquipmentStep';
import { FormationStep } from '../src/modern/kshvi/preparation/FormationStep';
import { LogisticsStep } from '../src/modern/kshvi/preparation/LogisticsStep';

afterEach(cleanup);
const at = '2026-11-25T06:00:00Z';
const operations: EquipmentStepOperations = {
  importTable: importEquipmentTable, exportTable: exportEquipmentTable,
  previewGroupChange: previewEquipmentGroupChange, applyGroupChange: applyEquipmentGroupChange, validateRows: validateEquipmentEditorRows,
};

function equipmentRow(): EquipmentEditorRow {
  return {
    id: 'equipment-1', forceId: 'force-1', accounting: 'AGGREGATE', typeId: 'truck', typeRevision: 1, typeSha256: 'a'.repeat(64),
    typeTitle: 'Автомобиль', movementClass: 'WHEELED', authorized: 8, actual: 8,
    stateCounts: { SERVICEABLE: 8, DEGRADED: 0, UNDER_REPAIR: 0, DAMAGED: 0, DESTROYED: 0, UNKNOWN: 0 },
    crewRequiredPerUnit: null, crewAssigned: null, massTonnes: null, lengthM: null, widthM: null, heightM: null,
    payloadTonnes: null, personnelCapacity: null, operatingResources: [], allowedTasks: [], environmentLimits: [], distribution: [],
    sourceId: 'manual', sourceRevision: 1, sourceSha256: 'b'.repeat(64),
  };
}

function baseDraft(): PreparationDraft {
  return { ...emptyPreparationDraft(at), forces: [{ ...createScenarioForce(at, 'force-1'), identity: { ...createScenarioForce(at, 'force-1').identity, nodeId: 'hq-blue', sideId: 'blue', type: '1-я бригада' } }] };
}

it('редактирует факт и исправность без нарушения суммы состояний', () => {
  const onChange = vi.fn();
  render(<EquipmentStep initialRows={[equipmentRow()]} operations={operations} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Факт equipment-1'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Исправно equipment-1'), { target: { value: '6' } });
  const rows = onChange.mock.calls.at(-1)?.[0] as readonly EquipmentEditorRow[];
  expect(rows[0]).toMatchObject({ actual: 8, stateCounts: { SERVICEABLE: 6 } });
});

it('назначает реальную силу в эшелон и сохраняет общий FormationPlan', () => {
  const draft = baseDraft();
  let current = draft;
  const onChange = vi.fn((next: PreparationDraft) => { current = next; });
  render(<FormationStep draft={draft} onChange={onChange}
    plan={{ id: 'legacy', orderVersion: 1, echelons: [], reserves: [], columns: [], areas: [], controlPosts: [] }}
    issues={[]} execution={{ status: 'NOT_STARTED', positions: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Добавить эшелон' }));
  fireEvent.change(screen.getByLabelText('Сила эшелона'), { target: { value: 'force-1' } });
  fireEvent.change(screen.getByLabelText('Район эшелона'), { target: { value: 'area-1' } });
  fireEvent.change(screen.getByLabelText('Готовность эшелона'), { target: { value: '2026-11-25T07:00:00Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Применить эшелон' }));
  expect(current.formation?.echelons[0]).toMatchObject({ forceIds: ['force-1'], areaId: 'area-1', readyAt: '2026-11-25T07:00:00Z' });
});

it('рассчитывает доставку по реальному дорожному графу, транспорту и дефициту без мгновенного поступления', () => {
  const draft = baseDraft();
  let current = draft;
  const onChange = vi.fn((next: PreparationDraft) => { current = next; });
  const graph: RouteGraph = { nodes: ['depot', 'hq-blue'], edges: [{ id: 'route-1', from: 'depot', to: 'hq-blue', distanceMeters: 12000, terrainObjectId: 'road-1', baseSpeedKph: 30 }] };
  const state = {
    schemaVersion: 1, operationalAt: at, revision: 0, status: 'READY', unknown: [], history: [], queues: {},
    objects: { 'road-1': { id: 'road-1', kind: 'ROAD', geometry: { type: 'LineString', coordinates: [] }, status: 'OPEN', dataAt: at, source: 'map', uncertainty: '', crossingMinutes: 0 } },
    initialObjects: {}, algorithmVersions: { H_v: 1, G_v: 1 }, profileId: 'terrain', profileVersion: 1, weatherEffectProfileVersion: 1,
  } as unknown as TerrainState;

  render(<LogisticsStep requests={[]} movements={[]} balances={[]} repairs={[]} draft={draft} onChange={onChange} terrain={{ state, graph }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Добавить заявку' }));
  fireEvent.change(screen.getByLabelText('Номенклатура'), { target: { value: 'fuel' } });
  fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Доступный остаток'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Единица измерения'), { target: { value: 'L' } });
  fireEvent.change(screen.getByLabelText('Масса груза, т'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('Объём груза, м³'), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('Маршрут снабжения'), { target: { value: 'route-1' } });
  fireEvent.change(screen.getByLabelText('Требуется к'), { target: { value: '2026-11-25T07:00:00Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать доставку' }));
  expect(screen.getByRole('status').textContent).toContain('06:24');
  expect(screen.getByRole('status').textContent).toContain('Дефицит: 0');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить заявку' }));
  expect(current.logistics?.requests[0]).toMatchObject({ resourceId: 'fuel', quantity: 400, allocatedQuantity: 400, deficit: 0, status: 'ALLOCATED' });
  expect(current.logistics?.requests[0]).not.toHaveProperty('deliveredQuantity');
  expect(current.logistics?.routes[0]).toMatchObject({ routeId: 'route-1', status: 'OPEN' });
});


it('использует скорость и проходимость маршрута, нанесённого на исходной карте', () => {
  const route = {
    id: 'route-1', revision: 1, kind: 'ROUTE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'LineString', coordinates: [[35, 50], [35.1, 50]] }, name: 'Дорога 1', sourceId: 'map', authorId: 'hq',
    eventId: 'event-1', validFrom: at, validUntil: '2026-11-26T06:00:00Z', state: 'OBSERVED', confidence: 1,
    uncertainty: { radiusM: null, note: '' }, visibility: {}, links: {}, sideId: 'blue', passable: true, speedKph: 30, crossingMinutes: 0,
    symbol: { id: 'route', version: '1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'doc', sourcePage: 1 },
  };
  const draft = { ...baseDraft(), initialMap: { id: 'map-1', initialOperationalAt: at, markers: [route] } } as unknown as PreparationDraft;
  let current = draft;
  render(<LogisticsStep requests={[]} movements={[]} balances={[]} repairs={[]} draft={draft} onChange={(next: PreparationDraft) => { current = next; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Добавить заявку' }));
  fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Доступный остаток'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Масса груза, т'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('Объём груза, м³'), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('Маршрут снабжения'), { target: { value: 'route-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать доставку' }));
  expect(screen.getByRole('status').textContent).toContain('Расчёт: OPEN');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить заявку' }));
  expect(current.logistics?.routes[0]).toMatchObject({ routeId: 'route-1', status: 'OPEN' });
});
