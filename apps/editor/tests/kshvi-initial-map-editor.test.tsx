// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderSymbol, symbolSet } from '@def-ops/tactical-symbols';
import { InitialMapSymbolPalette } from '../src/modern/kshvi/preparation/InitialMapSymbolPalette';
import { initialMapAudiences } from '../src/modern/kshvi/preparation/initial-map-audiences';
import { editedSymbol, markerImageId } from '../src/modern/kshvi/preparation/initial-map-symbol';
import { MapObjectInspector } from '../src/modern/kshvi/preparation/MapObjectInspector';
import { InitialMapEditor } from '../src/modern/kshvi/preparation/InitialMapEditor';
import { createInitialSituationMap, type MapMarker } from '../../../packages/kshvi/src/scenario/initial-map';

vi.mock('../src/modern/kshvi/preparation/InitialMapCanvas', () => ({
  InitialMapCanvas: ({ map, interaction }: { map?: { markers: readonly { id: string }[] }; interaction?: { onPoint(point: readonly [number, number]): void; drawing?: { points: readonly unknown[] } | null } }) => <div aria-label="Графический порт">
    {interaction?.drawing && <span>Режим нанесения включён · {interaction.drawing.points.length}</span>}
    {map?.markers.map(marker => <span key={marker.id}>{marker.id}</span>)}
    {interaction && <button type="button" onClick={() => interaction.onPoint([0.5, 0.5])}>Точка графического порта</button>}
  </div>,
}));

afterEach(cleanup);

it('одинаково фильтрует холст и список и позволяет выбрать пустую назначенную инстанцию', () => {
  const map = createInitialSituationMap({ id: 'empty-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'],
  });
  const symbol = symbolSet.symbols[0];
  const secret: MapMarker = { id: 'secret-object', name: 'Закрытое название', revision: 1, kind: 'TASK', layerId: 'REFERENCE',
    truth: 'PRIVATE', geometry: { type: 'Point', coordinates: [0.4, 0.4] }, sourceId: 'source', authorId: 'author', eventId: 'entry',
    validFrom: map.initialOperationalAt, validUntil: '2030-01-02T00:00:00Z', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: 0, note: '' }, visibility: { instanceIds: ['another-instance'] }, links: { documentId: 'document' }, sideId: 'other',
    symbol: { id: symbol.id, version: symbol.version, sideId: 'other', status: symbol.status, sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page! } };
  render(<InitialMapEditor map={{ ...map, markers: [secret], history: [secret] }} symbols={symbolSet.symbols} audiences={[
    { instanceId: 'instance-a', sideId: 'a', role: 'TRAINEE', label: 'Учебная группа' },
  ]} truthAuthorized={false} role="AUTHOR" authorId="author" forces={[]} client={{} as never} snapshot={{} as never}
    onChange={vi.fn()} onSave={vi.fn()} canEdit />);
  expect(screen.getByRole('option', { name: 'Учебная группа' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Истинная служебная карта' })).toBeNull();
  expect(screen.getByText('В этой проекции нет объектов')).toBeTruthy();
  expect(screen.getByLabelText('Графический порт').textContent).not.toContain('secret-object');
  expect(screen.queryByText('Закрытое название')).toBeNull();
});

it('не сохраняет точку с незаполненными атрибутами и показывает русскую диагностику', () => {
  const map = createInitialSituationMap({ id: 'draft-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const onChange = vi.fn();
  render(<InitialMapEditor map={map} symbols={symbolSet.symbols} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={onChange} onSave={vi.fn()} canEdit />);
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  fireEvent.change(screen.getByLabelText('Поиск знака'), { target: { value: symbol.id } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
  expect(screen.getByText('Режим нанесения включён · 0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Точка графического порта' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Укажите источник отметки');
});

it.each(['Кнопка', 'Escape', 'Отменить действие'])('%s закрывает незавершённую форму целиком', method => {
  const map = createInitialSituationMap({ id: 'cancel-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const onChange = vi.fn(), onPendingChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  render(<InitialMapEditor map={map} symbols={[symbol]} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={onChange} onSave={vi.fn()} onPendingChange={onPendingChange} canEdit />);
  fireEvent.click(screen.getByText(symbol.name));
  fireEvent.click(screen.getByRole('button', {name:'Точка графического порта'}));
  expect(screen.getByRole('alert')).toBeTruthy();
  if (method === 'Escape') fireEvent.keyDown(window, {key:'Escape'});
  else fireEvent.click(screen.getByRole('button', {name:method === 'Кнопка' ? 'Отменить нанесение' : method}));
  expect(screen.queryByLabelText('Название объекта')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', {name:'Сохранить карту'}) as HTMLButtonElement).disabled).toBe(false);
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

it('инспектор передаёт явные атрибуты и не придумывает отсутствующие силы', () => {
  const onChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  render(<MapObjectInspector value={{ id: 'object', revision: 1, kind: 'TASK', layerId: 'REFERENCE', truth: 'PRIVATE', geometry: null,
    sourceId: '', authorId: 'author', eventId: '', validFrom: '', validUntil: '', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: '',
    symbol: { id: symbol.id, version: symbol.version, sideId: '', status: symbol.status, sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page! },
  }} symbol={symbol} layers={['REFERENCE']} forces={[]} audiences={[]} onChange={onChange} />);
  expect(screen.getByText('Силы в этой редакции не заданы')).toBeTruthy();
  expect((screen.getByLabelText('Связанная сила') as HTMLSelectElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Источник объекта'), { target: { value: 'user-source' } });
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ sourceId: 'user-source', geometry: null, links: {} });
  fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Учебный объект' } });
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ name: 'Учебный объект' });
});

it('строит пустые проекции из состава участников, не из отметок', () => {
  expect(initialMapAudiences([{ instanceId: 'instance-a', sideId: 'side-a', role: 'TRAINEE', label: 'Учебная группа' }])).toEqual([
    { instanceId: 'instance-a', sideId: 'side-a', role: 'TRAINEE', label: 'Учебная группа' },
  ]);
  expect(initialMapAudiences([])).toEqual([]);
});

it('ищет знак по русскому названию или номеру и показывает его геометрию и изображение', () => {
  const symbol = symbolSet.symbols.find(item => item.kind === 'LINE')!;
  const onSelect = vi.fn();
  render(<InitialMapSymbolPalette symbols={symbolSet.symbols} selectedId="" onSelect={onSelect} />);
  expect(screen.getByRole('option', { name: 'Движение и маршруты' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /^SOURCE_/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Поиск знака'), { target: { value: symbol.id } });
  const button = screen.getByRole('button', { name: new RegExp(symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  expect(button.querySelector('img')).not.toBeNull();
  expect(button.textContent).toContain('Линия');
  expect(button.textContent).toContain('Нужна сверка');
  fireEvent.click(button);
  expect(onSelect.mock.calls[0][0].id).toBe(symbol.id);
  expect(onSelect.mock.calls[0][0].status).toBe('MAPPED');
});

it('заменяет исходную надпись и сохраняет её шрифт, цвет и положение', () => {
  const symbol = symbolSet.symbols.find(item => item.inscriptions?.length)!;
  const inscription = symbol.inscriptions![0];
  const original = JSON.stringify(symbol);
  const markerSymbol = {
    id: symbol.id, version: symbol.version, sideId: 'side-a', status: 'APPROVED' as const,
    sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page!,
    labels: { [inscription.id]: 'Новое обозначение' },
  };
  const changed = editedSymbol(symbol, markerSymbol);
  const svg = renderSymbol(changed, { width: 160, height: 160 });
  expect(svg).toContain('Новое обозначение');
  expect(svg).toContain(`font-family="${inscription.fontFamily ?? 'sans-serif'}"`);
  expect(svg).toContain(`font-weight="${inscription.fontWeight ?? '400'}"`);
  expect(svg).toContain(`font-style="${inscription.fontStyle ?? 'normal'}"`);
  expect(svg).toContain(`fill="${inscription.fill}"`);
  expect(JSON.stringify(symbol)).toBe(original);
  expect(markerImageId(markerSymbol)).not.toBe(markerImageId({ ...markerSymbol, labels: {} }));
});
