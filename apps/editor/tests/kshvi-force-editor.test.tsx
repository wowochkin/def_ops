// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyPreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { InitialSituationMap } from '../../../packages/kshvi/src/scenario/initial-map';
import { ForcesStep } from '../src/modern/kshvi/preparation/ForcesStep';

afterEach(cleanup);

const at = '2026-11-25T06:00:00Z';

function draftWithMap(): PreparationDraft {
  const marker = {
    id: 'position-1', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [35.1, 50.2] }, name: 'Позиция 1', sourceId: 'report-1', authorId: 'hq',
    eventId: 'event-1', validFrom: at, validUntil: '2026-11-26T06:00:00Z', state: 'OBSERVED', confidence: 1,
    uncertainty: { radiusM: null, note: '' }, visibility: {}, links: {}, sideId: 'blue',
    symbol: { id: 'force', version: '1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'doc', sourcePage: 1 },
  };
  return {
    ...emptyPreparationDraft(at),
    initialMap: { id: 'map-1', markers: [marker] } as unknown as InitialSituationMap,
  };
}

it('создаёт реальную силу с составом, состоянием, задачей и двусторонней позицией на карте', () => {
  let current = draftWithMap();
  const onChange = vi.fn((next: PreparationDraft) => { current = next; });
  const { rerender } = render(<ForcesStep draft={current} onChange={onChange} onOpenMap={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Добавить силу' }));
  fireEvent.change(screen.getByLabelText('Название подразделения'), { target: { value: '1-я бригада' } });
  fireEvent.change(screen.getByLabelText('Сторона силы'), { target: { value: 'blue' } });
  fireEvent.change(screen.getByLabelText('Инстанция силы'), { target: { value: 'hq-blue' } });
  fireEvent.change(screen.getByLabelText('Личный состав'), { target: { value: '820' } });
  fireEvent.change(screen.getByLabelText('Боевая задача'), { target: { value: 'Занять рубеж' } });
  fireEvent.change(screen.getByLabelText('Позиция на карте'), { target: { value: 'position-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Применить данные силы' }));

  expect(current.forces).toHaveLength(1);
  const force = current.forces[0]!;
  expect(force.identity).toMatchObject({ type: '1-я бригада', sideId: 'blue', nodeId: 'hq-blue' });
  expect(force.composition.personnel[0]).toMatchObject({ quantity: 820, unit: 'person' });
  expect(force.position.geometry).toEqual({ status: 'KNOWN', value: { type: 'Point', coordinates: [35.1, 50.2] } });
  expect(force.position.task).toEqual({ status: 'KNOWN', value: { title: 'Занять рубеж', markerId: 'position-1' } });
  expect(force.state.moralePsych).toMatchObject({ schemaVersion: 1, profileVersion: 1 });
  expect(current.initialMap?.markers[0]?.links.forceId).toBe(force.id);

  rerender(<ForcesStep draft={current} onChange={onChange} onOpenMap={vi.fn()} />);
  expect(screen.getByDisplayValue('1-я бригада')).toBeTruthy();
  expect(screen.getByDisplayValue('Занять рубеж')).toBeTruthy();
});

it('не удаляет силу вместе со связанными записями без явного перечня последствий', () => {
  const current = draftWithMap();
  const onChange = vi.fn();
  const { rerender } = render(<ForcesStep draft={current} onChange={onChange} onOpenMap={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Добавить силу' }));
  fireEvent.click(screen.getByRole('button', { name: 'Применить данные силы' }));
  const saved = onChange.mock.calls.at(-1)?.[0] as PreparationDraft;
  const withEquipment = { ...saved, equipment: [{ id: 'equipment-1', forceId: saved.forces[0]!.id }] } as unknown as PreparationDraft;

  rerender(<ForcesStep draft={withEquipment} onChange={onChange} onOpenMap={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить силу' }));
  expect(screen.getByRole('alert').textContent).toContain('equipment-1');
});
