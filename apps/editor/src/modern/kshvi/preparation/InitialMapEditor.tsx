import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderSymbol, type SymbolDefinition } from '@def-ops/tactical-symbols';
import {
  addInitialMapMarker, projectInitialMap, validateInitialMap,
  type ApprovedInitialMap, type InitialSituationMap, type MapMarker, type Position,
} from '../../../../../../packages/kshvi/src/scenario/initial-map';
import type { EnvironmentSnapshot } from '../../../../../../packages/kshvi/src/environment/provider';
import type { ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import type { KshviClient } from '../kshvi-api';
import type { InitialMapAudience } from './InitialMapStep';
import { InitialMapCanvas } from './InitialMapCanvas';
import { InitialMapSymbolPalette } from './InitialMapSymbolPalette';
import { MapObjectInspector } from './MapObjectInspector';
import { geometryText, markerGeometryKind, parseGeometryText } from './geometry-text';
import { applyInitialMapAction, createEditorHistory, redo, undo, type InitialMapEditorAction } from './initial-map-editor-controller';
import { editedSymbol } from './initial-map-symbol';

const audienceKey = (audience: InitialMapAudience) => audience.audienceId ?? audience.instanceId;

export type MapEditorInteractions = Readonly<{
  onPoint(point: Position): void;
  onFinish(): void;
  onSelect(id: string, additive: boolean): void;
  onSelectBox(ids: readonly string[]): void;
  onMove(ids: readonly string[], delta: { lon: number; lat: number }): void;
  onMoveVertex(id: string, vertex: number, ring: number, point: Position): void;
  onDeletePendingVertex(index?: number): void;
  onMovePendingVertex(index: number, point: Position): void;
  onDeleteVertex(id: string, vertex: number, ring: number): void;
  selectedIds: readonly string[];
  drawing: ReturnType<typeof createEditorHistory>['pending'];
  disabled: boolean;
}>;

export function InitialMapEditor({ map, symbols, audiences, truthAuthorized, role, authorId, endsAt, forces, client, snapshot,
  onChange, onSave, onApprove, onPendingChange, canEdit, busy = false, saved = false }: {
  map: InitialSituationMap;
  symbols: readonly SymbolDefinition[];
  audiences: readonly InitialMapAudience[];
  truthAuthorized: boolean;
  role: string;
  authorId: string;
  endsAt?: string | null;
  forces: readonly ScenarioForce[];
  client: KshviClient;
  snapshot: EnvironmentSnapshot;
  onChange(map: InitialSituationMap): void;
  onSave(map: InitialSituationMap): Promise<void>;
  onApprove?(map: InitialSituationMap): Promise<ApprovedInitialMap>;
  onPendingChange?(pending: boolean): void;
  canEdit: boolean;
  busy?: boolean;
  saved?: boolean;
}) {
  const [history, setHistory] = useState(() => createEditorHistory(map));
  const current = useRef(history);
  const lastEmitted = useRef(map);
  const [projection, setProjection] = useState(truthAuthorized ? 'TRUTH' : audiences[0] ? audienceKey(audiences[0]) : 'NONE');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [form, setForm] = useState<MapMarker | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [coordinates, setCoordinates] = useState('');
  const disabled = !canEdit || busy || saving;
  const pending = formDirty || !!history.pending;
  useLayoutEffect(() => onPendingChange?.(pending), [onPendingChange, pending]);
  useLayoutEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  useEffect(() => {
    if (map === lastEmitted.current) return;
    const next = createEditorHistory(map);
    current.current = next; setHistory(next); lastEmitted.current = map;
    setSelectedIds([]); setForm(null); setFormDirty(false); setCreating(false);
  }, [map]);

  const audience = audiences.find(item => audienceKey(item) === projection);
  const trueView = truthAuthorized && projection === 'TRUTH' && (role === 'DIRECTOR' || role === 'LEADER');
  const multipleViews = audiences.length > 0 && (truthAuthorized || audiences.length > 1);
  const visible = trueView ? { ...history.present } : audience ? projectInitialMap(history.present, {
    mode: 'INSTANCE', sideId: audience.sideId, instanceId: audience.instanceId, role: audience.role,
  }) : { ...history.present, markers: [], history: [] };
  const visibleIds = new Set(visible.markers.map(marker => marker.id));
  const selection = selectedIds.filter(id => visibleIds.has(id));
  const activeForm = creating ? form : form && selection.includes(form.id) ? form : null;
  const formSymbol = symbols.find(symbol => symbol.id === form?.symbol.id);
  useEffect(() => {
    if (creating || formDirty) return;
    const marker = selection.length === 1 ? history.present.markers.find(item => item.id === selection[0]) : undefined;
    setForm(marker ? structuredClone(marker) : null);
    setCoordinates(marker?.geometry ? geometryText(marker.geometry) : '');
  }, [history.present, selectedIds, creating, formDirty]);

  function showError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Не удалось изменить объект';
    if (!/^[A-Z0-9_, :.-]+$/.test(message)) { setError(message); return; }
    const codes = new Set(message.split(/[,\s]+/));
    const issues = validateInitialMap({ bounds: current.current.present.bounds, markers: form ? [form] : current.current.present.markers });
    const explanations = [...new Set(issues.filter(issue => codes.has(issue.code)).map(issue => issue.message))];
    const known: Record<string, string> = {
      DUPLICATE_OBJECT_ID: 'Идентификатор объекта уже занят', MAP_MARKER_NOT_FOUND: 'Объект не найден в текущей карте',
      GROUP_SHIFT_LINKS: 'Для переноса выберите всю группу связанных объектов', GROUP_SHIFT_EMPTY: 'Выберите объекты для переноса',
      GEOJSON_DOCUMENT_INVALID: 'Проверьте структуру документа GeoJSON',
    };
    if (explanations.length) setError(explanations.join('; '));
    else setError([...codes].map(code => known[code]).filter(Boolean).join('; ') || 'Проверьте геометрию, связи и обязательные атрибуты объекта');
  }
  function updateHistory(next: typeof history) {
    const previous = current.current;
    current.current = next; setHistory(next);
    if (next.present !== previous.present) { lastEmitted.current = next.present; onChange(next.present); }
  }
  function act(action: InitialMapEditorAction): typeof history | null {
    if (disabled) return null;
    try { setError(''); setNotice(''); const next = applyInitialMapAction(current.current, action); updateHistory(next); return next; }
    catch (cause) { showError(cause); return null; }
  }
  function select(id: string, additive: boolean) {
    if (!visibleIds.has(id) || history.pending) return;
    if (formDirty && form && !window.confirm('Отменить несохранённую правку атрибутов?')) return;
    const next = additive ? selection.includes(id) ? selection.filter(item => item !== id) : [...selection, id] : [id];
    setSelectedIds(next); setCreating(false); setFormDirty(false);
    const marker = next.length === 1 ? history.present.markers.find(item => item.id === next[0]) : undefined;
    setForm(marker ? structuredClone(marker) : null);
    setCoordinates(marker?.geometry ? geometryText(marker.geometry) : '');
  }
  function chooseSymbol(symbol: SymbolDefinition) {
    if (disabled) return;
    if ((formDirty || (history.pending?.points.length ?? 0) > 0) && !window.confirm('Отменить незавершённый объект и выбрать другой знак?')) return;
    updateHistory({ ...current.current, pending: null });
    setSelectedIds([]); setCreating(true); setFormDirty(false); setCoordinates('');
    const sideId = map.sides?.[0]?.id ?? audience?.sideId ?? '';
    const marker: MapMarker = { id: crypto.randomUUID(), revision: 1, kind: symbol.kind === 'AREA' ? 'AREA' : symbol.kind === 'LINE' ? 'ROUTE' : 'TASK',
      name: `${symbol.name} · ${history.present.markers.filter(item => item.name?.startsWith(`${symbol.name} ·`)).length + 1}`,
      layerId: 'REFERENCE', truth: 'PRIVATE', geometry: null, sourceId: 'manual:initial-situation', authorId, eventId: 'manual:initial-situation',
      validFrom: map.initialOperationalAt, validUntil: endsAt ?? '', state: 'UNKNOWN', confidence: null,
      uncertainty: { radiusM: null, note: '' }, visibility: trueView ? { staffOnly: true } : audience ? { instanceIds: [audience.instanceId] } : {},
      links: {}, sideId, symbol: { id: symbol.id, version: symbol.version,
        sideId, status: symbol.status, sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page ?? 0 },
    };
    setForm(marker); setError('');
    updateHistory(applyInitialMapAction(current.current, { type: 'BEGIN_DRAW', marker, geometryKind: symbol.kind }));
    setNotice(symbol.kind === 'POINT' ? `Щёлкните по карте или перетащите «${symbol.name}».`
      : `Щёлкайте вершины. Enter — завершить, Backspace — удалить последнюю, Esc — отмена.`);
  }
  function cancelDrawing() {
    if (disabled || !current.current.pending) return;
    if (formDirty && !window.confirm('Закрыть форму и сбросить введённые атрибуты?')) return;
    if (!act({ type: 'CANCEL_DRAW' })) return;
    setCreating(false);
    setForm(null);
    setFormDirty(false);
    setCoordinates('');
    setSelectedIds([]);
    setNotice('Нанесение отменено. Карта не изменилась.');
  }
  function undoAction() {
    if (current.current.pending) cancelDrawing();
    else updateHistory(undo(current.current));
  }
  function redoAction() {
    if (!current.current.pending) updateHistory(redo(current.current));
  }
  function finish() {
    const marker = form ?? current.current.pending?.marker;
    if (!marker || disabled) return;
    try {
      const pending = current.current.pending;
      if (!pending) return;
      const next = applyInitialMapAction({ ...current.current, pending: { ...pending, marker } }, { type: 'FINISH_DRAW' });
      updateHistory(next); setError(''); setNotice('Объект добавлен в черновик карты'); setSelectedIds([marker.id]); setCreating(false);
      setForm(next.present.markers.find(item => item.id === marker.id) ?? null); setFormDirty(false);
    } catch (cause) { showError(cause); }
  }
  function point(point: Position) {
    if (!current.current.pending) return;
    const next = act({ type: 'APPEND_VERTEX', point });
    if (next?.pending?.geometryKind === 'POINT') finish();
  }
  function dropSymbol(symbolId: string, position: Position) {
    const symbol = symbols.find(item => item.id === symbolId);
    if (!symbol || disabled) return;
    chooseSymbol(symbol);
    point(position);
  }
  function applyForm(): InitialSituationMap | null {
    if (!form || creating || disabled) return current.current.present;
    const { id, revision: _revision, geometry: _geometry, ...patch } = form;
    const next = act({ type: 'UPDATE_ATTRIBUTES', markerId: id, patch });
    if (!next) return null;
    setForm(next.present.markers.find(marker => marker.id === id) ?? null); setFormDirty(false);
    return next.present;
  }
  async function save() {
    if (disabled || current.current.pending || creating) return;
    const next = formDirty ? applyForm() : current.current.present;
    if (!next) return;
    setSaving(true); setError('');
    try { await onSave(next); setNotice('Карта сохранена сервером'); } catch (cause) { showError(cause); }
    finally { setSaving(false); }
  }
  function removeSelected() {
    if (!selection.length || disabled || !window.confirm(`Удалить объектов: ${selection.length}? Связи будут проверены.`)) return;
    if (act({ type: 'DELETE_MARKERS', markerIds: selection })) { setSelectedIds([]); setForm(null); setFormDirty(false); }
  }
  const keyboardActions = { disabled, undo: undoAction, redo: redoAction, cancel: cancelDrawing, finish, deleteLast: () => act({ type: 'DELETE_PENDING_VERTEX' }) };
  const actions = useRef(keyboardActions);
  actions.current = keyboardActions;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (!actions.current.disabled) actions.current.cancel(); return; }
      const element = event.target as HTMLElement | null;
      const interactive = element && typeof element.closest === 'function' ? element.closest('input,textarea,select,[contenteditable="true"]') : null;
      if (actions.current.disabled || interactive) return;
      if (event.key === 'Enter') { event.preventDefault(); actions.current.finish(); return; }
      if (event.key === 'Backspace') { event.preventDefault(); actions.current.deleteLast(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (event.shiftKey) actions.current.redo(); else actions.current.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); actions.current.redo(); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, []);

  return <section className={`initial-editor${expanded ? ' initial-editor-expanded' : ''}`} aria-label="Редактор исходной обстановки">
    <header className="initial-editor-toolbar">
      <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Свернуть карту' : 'Развернуть карту'}</button>
      {multipleViews && <label>Вид обстановки<select value={trueView ? 'TRUTH' : audience ? audienceKey(audience) : 'NONE'} onChange={event => {
        if ((formDirty || history.pending) && !window.confirm('Отменить незавершённую правку перед сменой вида?')) return;
        setProjection(event.target.value); setSelectedIds([]); setForm(null); setCreating(false); setFormDirty(false);
        updateHistory({ ...current.current, pending: null });
      }}>
        {truthAuthorized && (role === 'DIRECTOR' || role === 'LEADER') && <option value="TRUTH">Все объекты</option>}
        {audiences.map(item => <option key={audienceKey(item)} value={audienceKey(item)}>{item.label}</option>)}
      </select></label>}
      <button type="button" disabled={disabled || (!history.past.length && !history.pending)} onClick={undoAction}>Отменить действие</button>
      <button type="button" disabled={disabled || !!history.pending || !history.future.length} onClick={redoAction}>Повторить действие</button>
      {history.pending && <><button type="button" disabled={disabled} onClick={finish}>Завершить нанесение</button>
        <button type="button" disabled={disabled} onClick={cancelDrawing}>Отменить нанесение</button></>}
      <span role="status">{notice && <span>{notice} </span>}{history.pending ? `Нанесение: вершин ${history.pending.points.length}` : selection.length ? `Выбрано: ${selection.length}` : 'Выберите знак или объект'}</span>
    </header>
    {error && <p role="alert" className="kshvi-error">{history.pending && 'Объект ещё не добавлен. '}{error}</p>}
    <div className="initial-editor-body">
      <InitialMapSymbolPalette symbols={symbols} selectedId={activeForm?.symbol.id ?? ''} onSelect={chooseSymbol} disabled={disabled} />
      <div className="initial-editor-center">
        <InitialMapCanvas client={client} snapshot={snapshot} map={visible} interaction={{
          onPoint: point, onFinish: finish, onSelect: select,
          onSelectBox: ids => {
            if (formDirty && !window.confirm('Отменить несохранённую правку атрибутов?')) return;
            setSelectedIds(ids.filter(id => visibleIds.has(id))); setForm(null); setCreating(false); setFormDirty(false);
          },
          onMove: (ids, delta) => { act({ type: 'MOVE_OBJECT', markerIds: ids, delta }); },
          onMoveVertex: (id, vertex, ring, position) => { act({ type: 'MOVE_VERTEX', markerId: id, vertex, ring, point: position }); },
          onDeletePendingVertex: index => { act({ type: 'DELETE_PENDING_VERTEX', ...(index === undefined ? {} : { index }) }); },
          onMovePendingVertex: (index, position) => { act({ type: 'MOVE_PENDING_VERTEX', index, point: position }); },
          onDeleteVertex: (id, vertex, ring) => { act({ type: 'DELETE_VERTEX', markerId: id, vertex, ring }); },
          selectedIds: selection, drawing: history.pending && { ...history.pending, marker: form ?? history.pending.marker }, disabled,
        }} onDropSymbol={dropSymbol} />
        <section aria-label="Объекты проекции"><h3>Объекты · {visible.markers.length}</h3>
          {!visible.markers.length && <p>В этой проекции нет объектов</p>}
          {visible.markers.map(marker => <button type="button" key={marker.id} aria-pressed={selection.includes(marker.id)} onClick={event => select(marker.id, event.shiftKey || event.ctrlKey || event.metaKey)}>{marker.name ?? marker.id}</button>)}
        </section>
        <div className="initial-editor-selection-actions"><button type="button" disabled={disabled || !selection.length} onClick={removeSelected}>Удалить выбранные</button>
        <button type="button" disabled={disabled || !selection.length || formDirty || !!history.pending} onClick={() => {
          const copies = selection.map(id => ({ id, newId: crypto.randomUUID() }));
          if (act({ type: 'DUPLICATE_MARKERS', copies })) { setSelectedIds(copies.map(copy => copy.newId)); setForm(null); }
        }}>Дублировать выбранные</button></div>
      </div>
      {activeForm ? <div className="initial-editor-properties">
        <div className="initial-editor-object-actions">
          {creating && history.pending ? <button type="button" className="kshvi-primary" disabled={disabled || !history.pending.points.length} onClick={finish}>Добавить объект</button>
            : !creating && <button type="button" disabled={disabled || !formDirty} onClick={applyForm}>Применить атрибуты</button>}
          {creating && <p>При необходимости измените название и сторону. Дополнительные параметры необязательны.</p>}
        </div>
        <MapObjectInspector value={activeForm} symbol={formSymbol} layers={history.present.layers.map(layer => layer.id)} forces={forces}
        audiences={audiences} sides={history.present.sides} disabled={disabled} allowIdChange={creating} onChange={value => { setForm(value); setFormDirty(true); }} />
        <details><summary>Точные координаты</summary><label>Координаты объекта<textarea value={coordinates} onChange={event => setCoordinates(event.target.value)} /></label>
          <button type="button" disabled={disabled || !formSymbol} onClick={() => {
            try {
              const geometry = parseGeometryText(coordinates, creating ? formSymbol!.kind : markerGeometryKind(activeForm));
              const next = creating
                ? applyInitialMapAction(current.current, { type: 'REPLACE_MAP', map: addInitialMapMarker(current.current.present, { ...activeForm, geometry }, { draftSymbols: true }) })
                : applyInitialMapAction(current.current, { type: 'UPDATE_ATTRIBUTES', markerId: activeForm.id, patch: { ...activeForm, geometry } });
              updateHistory(next); setCreating(false); setSelectedIds([activeForm.id]); setFormDirty(false);
            } catch (cause) { showError(cause); }
          }}>Применить координаты</button>
        </details>
      </div> : <aside className="initial-editor-inspector"><p>Выберите объект на карте или знак в палитре.</p></aside>}
    </div>
    <section aria-label="Легенда карты"><h3>Легенда</h3>{[...new Set(visible.markers.map(marker => marker.symbol.id))].map(id => {
      const symbol = symbols.find(item => item.id === id);
      const marker = visible.markers.find(item => item.symbol.id === id)!;
      return symbol ? <span key={id}><img alt="" width={50} height={42} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSymbol(editedSymbol(symbol, marker.symbol, history.present.sides?.find(side => side.id === marker.sideId)), { width: 80, height: 64 }))}`} />{symbol.name}</span> : <span key={id}>Неизвестный знак · {id}</span>;
    })}</section>
    <footer className="initial-editor-actions">
      <button type="button" disabled={disabled || !!history.pending || creating} onClick={() => void save()}>Сохранить карту</button>
      <button type="button" disabled={disabled || !onApprove || !saved || formDirty || !!history.pending || !history.present.markers.length} onClick={async () => {
        setSaving(true); setError(''); try { await onApprove!(history.present); setNotice('Карта утверждена сервером'); } catch (cause) { showError(cause); } finally { setSaving(false); }
      }}>Утвердить исходную карту</button>
      <button type="button" onClick={() => {
        setNotice('');
        const issues = validateInitialMap(visible);
        const errors = issues.filter(issue => issue.severity === 'ERROR');
        setError(errors.map(issue => `${issue.objectId ?? 'Карта'}: ${issue.message}`).join('; '));
        if (errors.length) return;
        const warnings = issues.filter(issue => issue.severity === 'WARNING').length;
        setNotice(warnings ? `Проверка завершена: ошибок нет, предупреждений ${warnings}` : 'Проверка завершена: ошибок и предупреждений нет');
      }}>Проверить карту</button>
    </footer>
  </section>;
}
