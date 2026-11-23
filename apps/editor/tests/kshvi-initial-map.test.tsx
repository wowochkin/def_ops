// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { InitialMapStep } from '../src/modern/kshvi/preparation/InitialMapStep';
import {
  addInitialMapMarker,
  createInitialSituationMap,
  type InitialSituationMap,
  type MapMarker,
  type MapSymbolUse,
} from '../../../packages/kshvi/src/scenario/initial-map';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-01T08:00:00+03:00';
const approvedSymbol: MapSymbolUse = { id: 'infantry', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'signs.doc', sourcePage: 12 };
const symbols = [approvedSymbol, { ...approvedSymbol, id: 'unverified', status: 'VERIFIED' as const }];

function emptyMap(): InitialSituationMap {
  return createInitialSituationMap({
    id: 'map-ui', revision: 1,
    environment: { snapshotId: 'env-ui', manifestSha256: hashA, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-ui', terrainStateRef: 'terrain-ui',
    symbolSet: { id: 'symbols', revision: 1, sha256: hashB }, attribution: ['OSM'],
  });
}

function marker(id = 'blue-force'): MapMarker {
  return {
    id, revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source', authorId: 'author', eventId: 'event',
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.9,
    uncertainty: { radiusM: 20, note: 'наблюдение' }, visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] },
    links: { forceId: 'force-1' }, sideId: 'blue', symbol: approvedSymbol,
  };
}

const audiences = [
  { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Синий штаб' },
  { sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Красный штаб' },
];

function fillManualMarker(): void {
  fireEvent.change(screen.getByLabelText('Идентификатор отметки'), { target: { value: 'manual-force' } });
  fireEvent.change(screen.getByLabelText('Сторона'), { target: { value: 'blue' } });
  fireEvent.change(screen.getByLabelText('Долгота'), { target: { value: '0.25' } });
  fireEvent.change(screen.getByLabelText('Широта'), { target: { value: '0.3' } });
  fireEvent.change(screen.getByLabelText('Источник'), { target: { value: 'source-manual' } });
  fireEvent.change(screen.getByLabelText('Автор'), { target: { value: 'author-1' } });
  fireEvent.change(screen.getByLabelText('Событие или основание'), { target: { value: 'event-1' } });
  fireEvent.change(screen.getByLabelText('Начало действия'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Окончание действия'), { target: { value: end } });
  fireEvent.change(screen.getByLabelText('Инстанции видимости'), { target: { value: 'blue-hq' } });
  fireEvent.change(screen.getByLabelText('Связанная сила'), { target: { value: 'force-1' } });
  fireEvent.change(screen.getByLabelText('Достоверность'), { target: { value: '0.85' } });
  fireEvent.change(screen.getByLabelText('Неопределённость, м'), { target: { value: '15' } });
}

describe('InitialMapStep: ручная подготовка и AC-22', () => {
  it('не подставляет центр или нулевые координаты при ручном нанесении', () => {
    const onChange = vi.fn();
    render(<InitialMapStep map={emptyMap()} onChange={onChange} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    expect((screen.getByLabelText('Долгота') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Широта') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отметку' }));
    expect(screen.getByText(/POSITION_UNKNOWN/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('добавляет вручную нанесённую силу с источником, временем, видимостью и знаком', () => {
    const onChange = vi.fn();
    render(<InitialMapStep map={emptyMap()} onChange={onChange} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    fillManualMarker();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отметку' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('manual-force').length).toBeGreaterThan(0);
    expect(onChange.mock.calls[0][0].markers[0]).toMatchObject({
      sourceId: 'source-manual', authorId: 'author-1', eventId: 'event-1', sideId: 'blue',
      geometry: { type: 'Point', coordinates: [0.25, 0.3] },
      visibility: { instanceIds: ['blue-hq'] }, symbol: { id: 'infantry', version: 'v1' },
    });
  });

  it('показывает только утверждённые знаки с документом и страницей', () => {
    render(<InitialMapStep map={emptyMap()} onChange={vi.fn()} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    expect(screen.getByRole('option', { name: /infantry/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /unverified/ })).toBeNull();
    expect(screen.getByText(/signs\.doc, стр\. 12/)).toBeTruthy();
  });

  it('импортирует GeoJSON и повторно валидирует семантику', () => {
    const onChange = vi.fn();
    render(<InitialMapStep map={emptyMap()} onChange={onChange} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    const item = marker('geo-force');
    const document = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: item.geometry, properties: {
        id: item.id, kind: item.kind, layerId: item.layerId, truth: item.truth, sourceId: item.sourceId,
        authorId: item.authorId, eventId: item.eventId, validFrom: item.validFrom, validUntil: item.validUntil,
        state: item.state, confidence: item.confidence, uncertainty: item.uncertainty, visibility: item.visibility,
        links: item.links, sideId: item.sideId, symbol: item.symbol,
      } }],
    };
    fireEvent.change(screen.getByLabelText('GeoJSON'), { target: { value: JSON.stringify(document) } });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать GeoJSON' }));
    expect(screen.getByText('Импортировано отметок: 1')).toBeTruthy();
    expect(onChange.mock.calls[0][0].markers[0].id).toBe('geo-force');
  });

  it('различает истинную карту и начальные сведения инстанций без утечки', () => {
    const secret = {
      ...marker('secret-red'), sideId: 'red', geometry: { type: 'Point', coordinates: [0.8, 0.8] } as const,
      visibility: { sideIds: ['red'], instanceIds: ['red-hq'] }, symbol: { ...approvedSymbol, sideId: 'red' },
    };
    const reported = {
      ...marker('reported-red'), sideId: 'red', truth: 'PRIVATE' as const, layerId: 'OBSERVATIONS' as const,
      visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] }, symbol: { ...approvedSymbol, sideId: 'red' },
    };
    const map = addInitialMapMarker(addInitialMapMarker(addInitialMapMarker(emptyMap(), marker()), secret), reported);
    render(<InitialMapStep map={map} onChange={vi.fn()} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    expect(screen.getAllByText('blue-force').length).toBeGreaterThan(0);
    expect(screen.getAllByText('reported-red').length).toBeGreaterThan(0);
    expect(screen.queryByText('secret-red')).toBeNull();
    fireEvent.change(screen.getByLabelText('Начальная проекция'), { target: { value: 'TRUTH' } });
    expect(screen.getAllByText('secret-red').length).toBeGreaterThan(0);
  });

  it('показывает независимые слои, легенду, погоду и атрибуцию для печати', () => {
    const map = addInitialMapMarker(emptyMap(), marker());
    render(<InitialMapStep map={map} onChange={vi.fn()} audiences={audiences} availableSymbols={symbols} truthRole="DIRECTOR" />);
    expect(screen.getByText('Независимые слои')).toBeTruthy();
    expect(screen.getByText('Легенда и атрибуция')).toBeTruthy();
    expect(screen.getByText(/infantry v1/)).toBeTruthy();
    expect(screen.getByText(/Погода: weather-ui/)).toBeTruthy();
    expect(screen.getByText('OSM')).toBeTruthy();
  });
});

describe('InitialMapStep: браузерный вход', () => {
  it('не использует серверный вход пакета или Node API', () => {
    const step = readFileSync('apps/editor/src/modern/kshvi/preparation/InitialMapStep.tsx', 'utf8');
    const layers = readFileSync('apps/editor/src/modern/kshvi/preparation/InitialMapLayers.tsx', 'utf8');
    expect(step + layers).not.toContain("@def-ops/kshvi'");
    expect(step + layers).not.toMatch(/node:|indexedDB|\bfetch\s*\(/);
  });
});


describe('InitialMapStep: SYM-07 при вставке на карту', () => {
  it('ищет утверждённый знак по русскому названию, коду и назначению', () => {
    const options = [{ ...approvedSymbol, nameRu: 'Мотострелковый отряд', purpose: 'Силы на исходной карте' }];
    render(<InitialMapStep map={emptyMap()} onChange={vi.fn()} audiences={audiences} availableSymbols={options} truthRole="DIRECTOR" />);
    const search = screen.getByLabelText('Поиск знака');
    fireEvent.change(search, { target: { value: 'мотострелковый' } });
    expect(screen.getByRole('option', { name: /infantry/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'Силы на исходной' } });
    expect(screen.getByRole('option', { name: /infantry/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'infantry' } });
    expect(screen.getByRole('option', { name: /infantry/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'нет такого знака' } });
    expect(screen.queryByRole('option', { name: /infantry/ })).toBeNull();
  });
});


describe('AC-22: связка проекций и стороны знака', () => {
  it('не падает у обучаемого до появления инстанций и объясняет следующий шаг', () => {
    render(<InitialMapStep map={emptyMap()} onChange={vi.fn()} audiences={[]} availableSymbols={symbols} truthRole="TRAINEE" />);
    expect(screen.getByText(/Добавьте инстанции видимости/)).toBeTruthy();
    expect(screen.queryByText('blue-force')).toBeNull();
  });

  it('назначает знаку сторону наносимого объекта, а не фиктивный UNKNOWN', () => {
    const onChange = vi.fn();
    const redAudiences = [{ sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Красный штаб' }];
    render(<InitialMapStep map={emptyMap()} onChange={onChange} audiences={redAudiences} availableSymbols={[{ ...approvedSymbol, sideId: 'UNKNOWN' }]} truthRole="DIRECTOR" />);
    fillManualMarker();
    fireEvent.change(screen.getByLabelText('Сторона'), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText('Инстанции видимости'), { target: { value: 'red-hq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отметку' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].markers[0].symbol.sideId).toBe('red');
  });
});
