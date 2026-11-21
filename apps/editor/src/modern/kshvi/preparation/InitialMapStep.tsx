import { useState } from 'react';
import {
  addInitialMapMarker,
  approveInitialMap,
  importInitialMap,
  projectInitialMap,
  validateInitialMap,
  type ApprovedInitialMap,
  type InitialSituationMap,
  type MapMarker,
  type MapSymbolUse,
} from '../../../../../../packages/kshvi/src/scenario/initial-map';
import type { InitialMapIssue } from '../../../../../../packages/kshvi/src/scenario/initial-map-validation';
import { InitialMapLayers } from './InitialMapLayers';

export type InitialMapAudience = Readonly<{ sideId: string; instanceId: string; role: string; label: string }>;
export type InitialMapSymbolOption = MapSymbolUse & Readonly<{
  nameRu?: string;
  purpose?: string;
  service?: string;
  objectType?: string;
}>;
export type InitialMapStepProps = Readonly<{
  map: InitialSituationMap;
  onChange: (map: InitialSituationMap) => void;
  audiences: readonly InitialMapAudience[];
  availableSymbols: readonly InitialMapSymbolOption[];
  truthRole: string;
}>;

type ManualForm = {
  id: string;
  kind: MapMarker['kind'];
  sideId: string;
  lon: string;
  lat: string;
  sourceId: string;
  authorId: string;
  eventId: string;
  validFrom: string;
  validUntil: string;
  instanceIds: string;
  forceId: string;
  confidence: string;
  uncertaintyM: string;
  symbolId: string;
};

const emptyForm: ManualForm = {
  id: '', kind: 'FORCE', sideId: '', lon: '', lat: '', sourceId: '', authorId: '', eventId: '',
  validFrom: '', validUntil: '', instanceIds: '', forceId: '', confidence: '', uncertaintyM: '', symbolId: '',
};

export function InitialMapStep({ map, onChange, audiences, availableSymbols, truthRole }: InitialMapStepProps) {
  const [symbolQuery, setSymbolQuery] = useState('');
  const query = symbolQuery.trim().toLocaleLowerCase('ru');
  const approvedSymbols = availableSymbols.filter(symbol => symbol.status === 'APPROVED'
    && (!query || [symbol.id, symbol.nameRu, symbol.purpose, symbol.service, symbol.objectType]
      .some(value => value?.toLocaleLowerCase('ru').includes(query))));
  const [current, setCurrent] = useState(map);
  const [projection, setProjection] = useState(audiences[0]?.instanceId ?? 'TRUTH');
  const [form, setForm] = useState<ManualForm>({ ...emptyForm, symbolId: approvedSymbols[0]?.id ?? '' });
  const [geoJson, setGeoJson] = useState('');
  const [issues, setIssues] = useState<readonly InitialMapIssue[]>([]);
  const [notice, setNotice] = useState('');
  const [approved, setApproved] = useState<ApprovedInitialMap | null>(null);
  const audience = audiences.find(item => item.instanceId === projection);
  const projected = projection === 'TRUTH'
    ? projectInitialMap(current, { mode: 'TRUTH', role: truthRole })
    : audience
      ? projectInitialMap(current, { mode: 'INSTANCE', sideId: audience.sideId, instanceId: audience.instanceId, role: audience.role })
      : { ...current, markers: [], history: [] };
  const selectedSymbol = approvedSymbols.find(symbol => symbol.id === form.symbolId) ?? approvedSymbols[0];
  const update = (field: keyof ManualForm, value: string) => setForm(previous => ({ ...previous, [field]: value }));
  const commit = (next: InitialSituationMap) => {
    setCurrent(next);
    setApproved(null);
    onChange(next);
  };

  const addManual = () => {
    setNotice('');
    const coordinates = form.lon.trim() && form.lat.trim()
      ? { type: 'Point' as const, coordinates: [Number(form.lon), Number(form.lat)] as const }
      : null;
    const marker: MapMarker = {
      id: form.id.trim(), revision: 1, kind: form.kind, layerId: 'TRUE_FORCES', truth: 'TRUTH', geometry: coordinates,
      sourceId: form.sourceId.trim(), authorId: form.authorId.trim(), eventId: form.eventId.trim(),
      validFrom: form.validFrom.trim(), validUntil: form.validUntil.trim(), state: 'OBSERVED',
      confidence: form.confidence.trim() ? Number(form.confidence) : null,
      uncertainty: { radiusM: form.uncertaintyM.trim() ? Number(form.uncertaintyM) : null, note: '' },
      visibility: {
        sideIds: form.sideId.trim() ? [form.sideId.trim()] : [],
        instanceIds: form.instanceIds.split(',').map(item => item.trim()).filter(Boolean),
      },
      links: { forceId: form.forceId.trim() }, sideId: form.sideId.trim(),
      symbol: selectedSymbol ?? { id: '', version: '', sideId: '', status: 'IMPORTED', sourceDocument: '', sourcePage: 0 },
    };
    const found = validateInitialMap({ bounds: current.bounds, markers: [marker] });
    if (found.some(item => item.severity === 'ERROR')) {
      setIssues(found);
      return;
    }
    try {
      commit(addInitialMapMarker(current, marker));
      setIssues([]);
      setNotice('Отметка добавлена');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось добавить отметку');
    }
  };

  const importDocument = () => {
    setNotice('');
    try {
      const result = importInitialMap(geoJson, { bounds: current.bounds });
      if (result.issues.some(item => item.severity === 'ERROR')) {
        setIssues(result.issues);
        return;
      }
      let next = result.map ?? current;
      if (!result.map) for (const marker of result.markers) next = addInitialMapMarker(next, marker);
      commit(next);
      setIssues([]);
      setNotice(`Импортировано отметок: ${result.markers.length}`);
    } catch (error) {
      setIssues([{ code: error instanceof Error ? error.message : 'GEOJSON_DOCUMENT_INVALID', severity: 'ERROR', message: 'Проверьте структуру и семантику GeoJSON' }]);
    }
  };

  const approve = () => {
    try {
      const next = approveInitialMap(current);
      setCurrent(next);
      setApproved(next);
      onChange(next);
      setIssues([]);
      setNotice('Карта утверждена');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Карта не утверждена');
    }
  };

  return <section aria-labelledby="initial-map-title">
    <h2 id="initial-map-title">Карта исходной обстановки</h2>
    <p>Отдельная редакция поверх неизменяемого снимка среды: {current.environment.snapshotId}</p>
    <label htmlFor="initial-map-projection">Начальная проекция</label>
    <select id="initial-map-projection" value={projection} onChange={event => setProjection(event.target.value)}>
      {audiences.map(item => <option key={item.instanceId} value={item.instanceId}>{item.label}</option>)}
      {(truthRole === 'DIRECTOR' || truthRole === 'UMPIRE') && <option value="TRUTH">Истинная служебная карта</option>}
    </select>
    <InitialMapLayers map={projected} />

    <fieldset>
      <legend>Ручное нанесение</legend>
      <label htmlFor="initial-map-id">Идентификатор отметки</label>
      <input id="initial-map-id" value={form.id} onChange={event => update('id', event.target.value)} />
      <label htmlFor="initial-map-kind">Тип отметки</label>
      <select id="initial-map-kind" value={form.kind} onChange={event => update('kind', event.target.value)}>
        {['FORCE', 'COMMAND_POST', 'COMMUNICATION', 'LOGISTICS', 'MEDICAL', 'REPAIR', 'AREA', 'BOUNDARY', 'COLUMN', 'ROUTE', 'OBSTACLE', 'CROSSING', 'TASK'].map(kind => <option key={kind}>{kind}</option>)}
      </select>
      <label htmlFor="initial-map-side">Сторона</label>
      <input id="initial-map-side" value={form.sideId} onChange={event => update('sideId', event.target.value)} />
      <label htmlFor="initial-map-lon">Долгота</label>
      <input id="initial-map-lon" inputMode="decimal" value={form.lon} onChange={event => update('lon', event.target.value)} />
      <label htmlFor="initial-map-lat">Широта</label>
      <input id="initial-map-lat" inputMode="decimal" value={form.lat} onChange={event => update('lat', event.target.value)} />
      <label htmlFor="initial-map-source">Источник</label>
      <input id="initial-map-source" value={form.sourceId} onChange={event => update('sourceId', event.target.value)} />
      <label htmlFor="initial-map-author">Автор</label>
      <input id="initial-map-author" value={form.authorId} onChange={event => update('authorId', event.target.value)} />
      <label htmlFor="initial-map-event">Событие или основание</label>
      <input id="initial-map-event" value={form.eventId} onChange={event => update('eventId', event.target.value)} />
      <label htmlFor="initial-map-from">Начало действия</label>
      <input id="initial-map-from" value={form.validFrom} onChange={event => update('validFrom', event.target.value)} />
      <label htmlFor="initial-map-until">Окончание действия</label>
      <input id="initial-map-until" value={form.validUntil} onChange={event => update('validUntil', event.target.value)} />
      <label htmlFor="initial-map-instances">Инстанции видимости</label>
      <input id="initial-map-instances" value={form.instanceIds} onChange={event => update('instanceIds', event.target.value)} />
      <label htmlFor="initial-map-force">Связанная сила</label>
      <input id="initial-map-force" value={form.forceId} onChange={event => update('forceId', event.target.value)} />
      <label htmlFor="initial-map-confidence">Достоверность</label>
      <input id="initial-map-confidence" inputMode="decimal" value={form.confidence} onChange={event => update('confidence', event.target.value)} />
      <label htmlFor="initial-map-uncertainty">Неопределённость, м</label>
      <input id="initial-map-uncertainty" inputMode="decimal" value={form.uncertaintyM} onChange={event => update('uncertaintyM', event.target.value)} />
      <label htmlFor="initial-map-symbol-search">Поиск знака</label>
      <input id="initial-map-symbol-search" value={symbolQuery} onChange={event => setSymbolQuery(event.target.value)} placeholder="Название, код или назначение" />
      <label htmlFor="initial-map-symbol">Утверждённый знак</label>
      <select id="initial-map-symbol" value={form.symbolId} onChange={event => update('symbolId', event.target.value)}>
        {approvedSymbols.map(symbol => <option key={`${symbol.id}@${symbol.version}`} value={symbol.id}>{symbol.id} ({symbol.version})</option>)}
      </select>
      {selectedSymbol && <p>{selectedSymbol.sourceDocument}, стр. {selectedSymbol.sourcePage}</p>}
      <button type="button" onClick={addManual}>Добавить отметку</button>
    </fieldset>

    <label htmlFor="initial-map-geojson">GeoJSON</label>
    <textarea id="initial-map-geojson" value={geoJson} onChange={event => setGeoJson(event.target.value)} />
    <button type="button" onClick={importDocument}>Импортировать GeoJSON</button>
    <button type="button" onClick={approve}>Утвердить карту</button>
    {notice && <p role="status">{notice}</p>}
    {issues.length > 0 && <ul aria-label="Ошибки исходной карты">{issues.map((item, index) => <li key={`${item.code}-${item.objectId ?? index}`}>
      {item.code}: {item.message}
    </li>)}</ul>}
    {approved && <p>Хеш карты: {approved.sha256}</p>}
  </section>;
}
