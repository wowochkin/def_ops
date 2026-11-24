// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InitialMapStep } from '../src/modern/kshvi/preparation/InitialMapStep';
import { addInitialMapMarker, createInitialSituationMap, type MapMarker, type MapSymbolUse } from '../../../packages/kshvi/src/scenario/initial-map';

afterEach(cleanup);
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
const symbol: MapSymbolUse & { kind: 'LINE' } = { id: 'route-sign', version: '3.0.0', sideId: 'blue', status: 'APPROVED', sourceDocument: 'signs.doc', sourcePage: 1, kind: 'LINE' };
const map = () => createInitialSituationMap({
  id: 'map-geometry', revision: 1,
  environment: { snapshotId: 'env', manifestSha256: hashA, bounds: [0, 0, 1, 1] },
  initialOperationalAt: '2030-01-01T06:00:00+03:00', timeZone: 'Europe/Moscow', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
  symbolSet: { id: 'symbols', revision: 1, sha256: hashB }, attribution: [],
});
const required = {
  sourceId: 'source', authorId: 'author', eventId: 'event', validFrom: '2030-01-01T06:00:00+03:00', validUntil: '2030-01-01T08:00:00+03:00',
  state: 'OBSERVED' as const, confidence: 1, uncertainty: { radiusM: 0, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force' },
};

it('добавляет линейный знак с пользовательским маршрутом', () => {
  const onChange = vi.fn();
  render(<InitialMapStep map={map()} onChange={onChange} audiences={[]} availableSymbols={[symbol]} truthRole="DIRECTOR" />);
  fireEvent.change(screen.getByLabelText('Идентификатор отметки'), { target: { value: 'route-1' } });
  fireEvent.change(screen.getByLabelText('Сторона'), { target: { value: 'blue' } });
  fireEvent.change(screen.getByLabelText('Источник'), { target: { value: 'source' } });
  fireEvent.change(screen.getByLabelText('Автор'), { target: { value: 'author' } });
  fireEvent.change(screen.getByLabelText('Событие или основание'), { target: { value: 'event' } });
  fireEvent.change(screen.getByLabelText('Начало действия'), { target: { value: '2030-01-01T06:00:00+03:00' } });
  fireEvent.change(screen.getByLabelText('Окончание действия'), { target: { value: '2030-01-01T08:00:00+03:00' } });
  fireEvent.change(screen.getByLabelText('Связанная сила'), { target: { value: 'force' } });
  fireEvent.change(screen.getByLabelText('Достоверность'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Неопределённость, м'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Точки маршрута'), { target: { value: '0.1, 0.1; 0.4, 0.2; 0.5, 0.4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить отметку' }));
  expect(onChange.mock.calls[0][0].markers[0].geometry).toEqual({ type: 'LineString', coordinates: [[0.1, 0.1], [0.4, 0.2], [0.5, 0.4]] });
});

it('редактирует координаты уже нанесённого маршрута с историей', () => {
  const route: MapMarker = {
    id: 'route-existing', revision: 1, kind: 'ROUTE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'LineString', coordinates: [[0.1, 0.1], [0.4, 0.2]] }, sideId: 'blue', symbol,
    ...required,
  };
  const initial = addInitialMapMarker(map(), route);
  const onChange = vi.fn();
  render(<InitialMapStep map={initial} onChange={onChange} audiences={[]} availableSymbols={[symbol]} truthRole="DIRECTOR" />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить геометрию route-existing' }));
  fireEvent.change(screen.getByLabelText('Координаты редактируемой отметки'), { target: { value: '0.1, 0.1; 0.4, 0.2; 0.5, 0.4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить геометрию' }));
  expect(onChange.mock.calls[0][0].markers[0].geometry.coordinates).toHaveLength(3);
  expect(onChange.mock.calls[0][0].history).toHaveLength(1);
});
