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
  InitialMapCanvas: ({ map, interaction, onDropSymbol }: {
    map?: { markers: readonly { id: string }[] };
    interaction?: {
      onPoint(point: readonly [number, number]): void;
      onMovePendingVertex?(index: number, point: readonly [number, number]): void;
      drawing?: { points: readonly unknown[] } | null;
    };
    onDropSymbol?(id: string, point: readonly [number, number]): void;
  }) => <div aria-label="Графический порт">
    {interaction?.drawing && <span>Режим нанесения включён · {interaction.drawing.points.length}</span>}
    {map?.markers.map(marker => <span key={marker.id}>{marker.id}</span>)}
    {interaction && <button type="button" data-index="0" onClick={event => {
      const index = Number(event.currentTarget.dataset.index);
      event.currentTarget.dataset.index = String(index + 1);
      interaction.onPoint([index / 10 + 0.1, 0.5]);
    }}>Точка графического порта</button>}
    {interaction?.onMovePendingVertex && <button type="button" onClick={() => interaction.onMovePendingVertex!(0, [0.6, 0.6])}>Переместить первую вершину</button>}
    {onDropSymbol && <button type="button" onClick={() => onDropSymbol((window as unknown as { dropSymbolId: string }).dropSymbolId, [0.5, 0.5])}>Бросок знака</button>}
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
    { instanceId: 'instance-b', sideId: 'b', role: 'TRAINEE', label: 'Другая группа' },
  ]} truthAuthorized={false} role="AUTHOR" authorId="author" forces={[]} client={{} as never} snapshot={{} as never}
    onChange={vi.fn()} onSave={vi.fn()} canEdit />);
  expect(screen.getByRole('option', { name: 'Учебная группа' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Истинная служебная карта' })).toBeNull();
  expect(screen.getByText('В этой проекции нет объектов')).toBeTruthy();
  expect(screen.getByLabelText('Графический порт').textContent).not.toContain('secret-object');
  expect(screen.queryByText('Закрытое название')).toBeNull();
});

it('создаёт точку с автоматическими атрибутами без обязательных полей', () => {
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
  const saved = onChange.mock.calls.at(-1)![0];
  expect(saved.markers[0]).toMatchObject({
    sourceId: 'manual:initial-situation', eventId: 'manual:initial-situation', authorId: 'author',
    validFrom: map.initialOperationalAt, validUntil: '', state: 'UNKNOWN', confidence: null,
    links: {}, uncertainty: { radiusM: null, note: '' },
  });
});

it.each(['Кнопка', 'Escape', 'Отменить действие'])('%s закрывает незавершённую форму целиком', method => {
  const map = createInitialSituationMap({ id: 'cancel-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const onChange = vi.fn(), onPendingChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'LINE')!;
  render(<InitialMapEditor map={map} symbols={[symbol]} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={onChange} onSave={vi.fn()} onPendingChange={onPendingChange} canEdit />);
  fireEvent.click(screen.getByText(symbol.name));
  fireEvent.click(screen.getByRole('button', {name:'Точка графического порта'}));
  expect(screen.getByText('Режим нанесения включён · 1')).toBeTruthy();
  if (method === 'Escape') fireEvent.keyDown(window, {key:'Escape'});
  else fireEvent.click(screen.getByRole('button', {name:method === 'Кнопка' ? 'Отменить нанесение' : method}));
  expect(screen.queryByLabelText('Название объекта')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', {name:'Сохранить карту'}) as HTMLButtonElement).disabled).toBe(false);
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

it('инспектор показывает системные поля только для чтения и не требует силу', () => {
  const onChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  render(<MapObjectInspector value={{ id: 'object', revision: 1, kind: 'TASK', layerId: 'REFERENCE', truth: 'PRIVATE', geometry: null,
    sourceId: '', authorId: 'author', eventId: '', validFrom: '', validUntil: '', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: '',
    symbol: { id: symbol.id, version: symbol.version, sideId: '', status: symbol.status, sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page! },
  }} symbol={symbol} layers={['REFERENCE']} forces={[]} audiences={[]} onChange={onChange} />);
  expect(screen.queryByLabelText('Связанная сила')).toBeNull();
  expect((screen.getByLabelText('Источник объекта') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Учебный объект' } });
  expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ name: 'Учебный объект' });
});

it('выносит календарь инспектора из прокручиваемой панели атрибутов', () => {
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  const { container } = render(<MapObjectInspector value={{ id: 'object', revision: 1, kind: 'TASK', layerId: 'REFERENCE', truth: 'PRIVATE', geometry: null,
    sourceId: 'manual:initial-situation', authorId: 'author', eventId: 'manual:initial-situation', validFrom: '', validUntil: '', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: '',
    symbol: { id: symbol.id, version: symbol.version, sideId: '', status: symbol.status, sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page! },
  }} symbol={symbol} layers={['REFERENCE']} forces={[]} audiences={[]} onChange={vi.fn()} />);
  fireEvent.click(screen.getByText('Дополнительные параметры'));
  fireEvent.click(screen.getByLabelText('Окончание действия объекта, UTC'));
  const dialog = screen.getByRole('dialog', { name: 'Дата и время: Окончание действия объекта, UTC' });
  expect(container.contains(dialog)).toBe(false);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
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

it('не показывает одиночный фильтр, состав участников и импорт GeoJSON', () => {
  const map = createInitialSituationMap({ id: 'single-view-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  render(<InitialMapEditor map={map} symbols={symbolSet.symbols} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={vi.fn()} onSave={vi.fn()} canEdit />);
  expect(screen.queryByLabelText('Проекция карты')).toBeNull();
  expect(screen.queryByLabelText('Вид обстановки')).toBeNull();
  expect(screen.queryByText('Состав участников редакции')).toBeNull();
  expect(screen.queryByText('Импорт GeoJSON')).toBeNull();
});

it('Enter завершает маршрут, Backspace удаляет последнюю вершину, первая вершина перемещается', () => {
  const map = createInitialSituationMap({ id: 'keyboard-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const onChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'LINE')!;
  render(<InitialMapEditor map={map} symbols={[symbol]} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={onChange} onSave={vi.fn()} canEdit />);
  fireEvent.click(screen.getByText(symbol.name));
  const point = screen.getByRole('button', { name: 'Точка графического порта' });
  fireEvent.click(point); fireEvent.click(point); fireEvent.click(point);
  fireEvent.keyDown(window, { key: 'Backspace' });
  expect(screen.getByText('Режим нанесения включён · 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Переместить первую вершину' }));
  fireEvent.keyDown(window, { key: 'Enter' });
  const saved = onChange.mock.calls.at(-1)![0];
  expect(saved.markers[0].geometry.coordinates).toEqual([[0.6, 0.6], [0.2, 0.5]]);
});

it('перетаскивание знака из палитры создаёт точку на координатах карты', () => {
  const map = createInitialSituationMap({ id: 'drop-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const onChange = vi.fn();
  const symbol = symbolSet.symbols.find(item => item.kind === 'POINT')!;
  (window as unknown as { dropSymbolId: string }).dropSymbolId = symbol.id;
  render(<InitialMapEditor map={map} symbols={[symbol]} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={onChange} onSave={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Бросок знака' }));
  const saved = onChange.mock.calls.at(-1)![0];
  expect(saved.markers[0].geometry).toEqual({ type: 'Point', coordinates: [0.5, 0.5] });
});

it('повторная проверка заменяет прежний результат', () => {
  const map = createInitialSituationMap({ id: 'validation-editor', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: symbolSet.id, revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const symbol = symbolSet.symbols[0];
  const invalid: MapMarker = { id: 'invalid', revision: 1, kind: 'TASK', layerId: 'REFERENCE', truth: 'PRIVATE',
    geometry: { type: 'Point', coordinates: [0.5, 0.5] }, sourceId: '', authorId: 'author', eventId: 'manual:initial-situation',
    validFrom: map.initialOperationalAt, validUntil: '', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: 'blue',
    symbol: { id: symbol.id, version: symbol.version, sideId: 'blue', status: 'APPROVED', sourceDocument: 'test', sourcePage: 1 } };
  const view = render(<InitialMapEditor map={map} symbols={symbolSet.symbols} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={vi.fn()} onSave={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить карту' }));
  expect(screen.getByText('Проверка завершена: ошибок и предупреждений нет')).toBeTruthy();
  view.rerender(<InitialMapEditor map={{ ...map, markers: [invalid], history: [] }} symbols={symbolSet.symbols} audiences={[]} truthAuthorized role="DIRECTOR" authorId="author" forces={[]}
    client={{} as never} snapshot={{} as never} onChange={vi.fn()} onSave={vi.fn()} canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить карту' }));
  expect(screen.getByRole('alert').textContent).toContain('Укажите источник отметки');
  expect(screen.queryByText('Проверка завершена: ошибок и предупреждений нет')).toBeNull();
});
