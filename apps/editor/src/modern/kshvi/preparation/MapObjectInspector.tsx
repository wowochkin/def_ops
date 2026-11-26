import { useId } from 'react';
import type { SymbolDefinition } from '@def-ops/tactical-symbols';
import type { MapLayerId, MapMarker } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import type { ScenarioSide } from '../../../../../../packages/kshvi/src/scenario/sides';
import type { ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import type { InitialMapAudience } from './InitialMapStep';
import { DateTimeField } from '../../DateTimeField';
import { forceTask } from './force-operations';

const kinds: Record<MapMarker['kind'], string> = {
  FORCE: 'Сила', COMMAND_POST: 'Пункт управления', COMMUNICATION: 'Связь', LOGISTICS: 'Снабжение',
  MEDICAL: 'Медицина', REPAIR: 'Ремонт', AREA: 'Область', BOUNDARY: 'Граница', COLUMN: 'Колонна',
  ROUTE: 'Маршрут', OBSTACLE: 'Препятствие', CROSSING: 'Переправа', TASK: 'Задача',
};
const layerNames: Record<MapLayerId, string> = {
  BASEMAP: 'Подложка', TRUE_FORCES: 'Служебная обстановка', PERSONAL_SITUATION: 'Личная обстановка',
  OBSERVATIONS: 'Наблюдения', EVENTS: 'События', RESOURCES: 'Ресурсы', COMMUNICATIONS: 'Связь',
  WEATHER: 'Погода', CBRN: 'РХБ-обстановка', SOCIO_ECONOMIC: 'Социальная обстановка',
  REFERENCE: 'Справочные объекты', ACTUAL: 'Фактическая обстановка', BRANCHES: 'Варианты', STAFF_COMMENTS: 'Комментарии',
};
function dateInput(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16) : '';
}

export function MapObjectInspector({ value, symbol, layers, forces, audiences, sides = [], onChange, disabled = false, allowIdChange = false }: {
  value: MapMarker;
  symbol?: SymbolDefinition;
  layers: readonly MapLayerId[];
  forces: readonly ScenarioForce[];
  audiences: readonly InitialMapAudience[];
  sides?: readonly ScenarioSide[];
  onChange(value: MapMarker): void;
  disabled?: boolean;
  allowIdChange?: boolean;
}) {
  const uid = useId();
  const patch = (change: Partial<MapMarker>) => onChange({ ...value, ...change });
  const link = (field: 'forceId' | 'taskId' | 'documentId', input: string) => {
    const links = { ...value.links };
    if (input.trim()) links[field] = input.trim(); else delete links[field];
    patch({ links });
  };
  const tasks = forces.map(force => ({ id: forceTask(force).markerId ?? force.id, title: forceTask(force).title }));
  return <aside className="initial-editor-inspector" aria-label="Атрибуты объекта">
    <h3>{allowIdChange ? 'Новый объект' : 'Выбранный объект'}</h3>
    <fieldset disabled={disabled}>
      <label>Название объекта<input value={value.name ?? ''} onChange={event => patch({ name: event.target.value })} /></label>
      <label>Сторона объекта<select value={value.sideId} onChange={event => patch({ sideId: event.target.value, symbol: { ...value.symbol, sideId: event.target.value } })}>
        <option value="">Без стороны</option>
        {sides.map(side => <option key={side.id} value={side.id}>{side.name}{side.country ? ` · ${side.country}` : ''}</option>)}
        {!sides.length && value.sideId && <option value={value.sideId}>{value.sideId}</option>}
      </select></label>
      <label>Тип объекта<select value={value.kind} onChange={event => patch({ kind: event.target.value as MapMarker['kind'] })}>
        {Object.entries(kinds).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Состояние сведений<select value={value.state} onChange={event => patch({ state: event.target.value as MapMarker['state'] })}>
        <option value="OBSERVED">Наблюдается</option><option value="ASSUMED">Предполагается</option>
        <option value="PLANNED">Запланировано</option><option value="UNKNOWN">Не оценивается</option>
      </select></label>
      {!!forces.length && <label>Связанная сила<select value={value.links.forceId ?? ''} onChange={event => link('forceId', event.target.value)}>
        <option value="">Не выбрана</option>{forces.map(force => <option key={force.id} value={force.id}>{force.identity.type}</option>)}
      </select></label>}
      {!!tasks.length && <label>Связанная задача<select value={value.links.taskId ?? ''} onChange={event => link('taskId', event.target.value)}>
        <option value="">Не выбрана</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select></label>}
      {symbol?.inscriptions?.length ? <fieldset><legend>Надписи знака</legend>{symbol.inscriptions.map(inscription => <div key={inscription.id}>
        <label>Надпись «{inscription.text}»<input value={value.symbol.labels?.[inscription.id] ?? inscription.text} onChange={event => patch({
          symbol: { ...value.symbol, labels: { ...value.symbol.labels, [inscription.id]: event.target.value } },
        })} /></label>
        <label><input type="checkbox" checked={(value.symbol.inscriptionStyles?.[inscription.id]?.fontWeight ?? inscription.fontWeight) === '700'}
          onChange={event => patch({ symbol: { ...value.symbol, inscriptionStyles: { ...value.symbol.inscriptionStyles,
            [inscription.id]: { ...value.symbol.inscriptionStyles?.[inscription.id], fontWeight: event.target.checked ? '700' : '400' } } } })} />Жирный</label>
        <label><input type="checkbox" checked={(value.symbol.inscriptionStyles?.[inscription.id]?.fontStyle ?? inscription.fontStyle) === 'italic'}
          onChange={event => patch({ symbol: { ...value.symbol, inscriptionStyles: { ...value.symbol.inscriptionStyles,
            [inscription.id]: { ...value.symbol.inscriptionStyles?.[inscription.id], fontStyle: event.target.checked ? 'italic' : 'normal' } } } })} />Курсив</label>
        <small>{inscription.fontFamily ?? 'sans-serif'} · исходные цвет и положение</small>
      </div>)}</fieldset> : null}
      <details>
        <summary>Дополнительные параметры</summary>
        <label>Идентификатор объекта<input value={value.id} readOnly={!allowIdChange} onChange={event => patch({ id: event.target.value })} /></label>
        <label>Слой объекта<select value={value.layerId} onChange={event => patch({ layerId: event.target.value as MapLayerId })}>
          {layers.map(id => <option key={id} value={id}>{layerNames[id]}</option>)}
        </select></label>
        <label>Источник объекта<input value={value.sourceId} readOnly /></label>
        <label>Автор объекта<input value={value.authorId} readOnly /></label>
        <label>Основание объекта<input value={value.eventId} readOnly /></label>
        <DateTimeField floating disabled={disabled} id={`${uid}-from`} label="Начало действия объекта, UTC" value={dateInput(value.validFrom)} onChange={input => patch({ validFrom: input ? `${input}:00Z` : '' })} />
        <DateTimeField floating disabled={disabled} id={`${uid}-until`} label="Окончание действия объекта, UTC" value={dateInput(value.validUntil)} onChange={input => patch({ validUntil: input ? `${input}:00Z` : '' })} />
        <label>Достоверность объекта<select value={value.confidence ?? ''} onChange={event => patch({ confidence: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">Не оценивается</option><option value="0.2">Низкая · 0,2</option><option value="0.5">Средняя · 0,5</option><option value="0.8">Высокая · 0,8</option>
        </select></label>
        <label>Радиус неопределённости, м<input type="number" min="0" value={value.uncertainty.radiusM ?? ''}
          onChange={event => patch({ uncertainty: { ...value.uncertainty, radiusM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
        <label>Пояснение неопределённости<input value={value.uncertainty.note} onChange={event => patch({ uncertainty: { ...value.uncertainty, note: event.target.value } })} /></label>
        <label>Связанный документ<input value={value.links.documentId ?? ''} onChange={event => link('documentId', event.target.value)} /></label>
        {(value.kind === 'ROUTE' || value.kind === 'CROSSING') && <fieldset><legend>Проходимость и доставка</legend>
          <label>Скорость на маршруте, км/ч<input type="number" min="0" step="0.1" value={value.speedKph ?? ''}
            onChange={event => patch({ speedKph: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          <label>Ёмкость переправы, т<input type="number" min="0" value={value.crossingCapacityTonnes ?? ''}
            onChange={event => patch({ crossingCapacityTonnes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          <label>Время переправы, мин<input type="number" min="0" value={value.crossingMinutes ?? ''}
            onChange={event => patch({ crossingMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          <label>Состояние проходимости<select value={value.passable === undefined ? 'UNKNOWN' : value.passable ? 'OPEN' : 'CLOSED'} onChange={event => patch({ passable: event.target.value === 'UNKNOWN' ? undefined : event.target.value === 'OPEN' })}>
            <option value="UNKNOWN">Определяется местностью</option><option value="OPEN">Проходимо</option><option value="CLOSED">Закрыто</option>
          </select></label>
        </fieldset>}
        <fieldset><legend>Видимость объекта</legend>
          <label><input type="checkbox" checked={value.visibility.staffOnly === true}
            onChange={event => patch({ visibility: { ...value.visibility, staffOnly: event.target.checked } })} />Все объекты · служебная карта</label>
          {audiences.map(audience => <label key={audience.audienceId ?? `${audience.instanceId}:${audience.role}`}><input type="checkbox"
            checked={value.visibility.instanceIds?.includes(audience.instanceId) ?? false}
            onChange={event => {
              const ids = new Set(value.visibility.instanceIds ?? []);
              if (event.target.checked) ids.add(audience.instanceId); else ids.delete(audience.instanceId);
              patch({ visibility: { ...value.visibility, instanceIds: [...ids], staffOnly: false } });
            }} />{audience.label}</label>)}
        </fieldset>
      </details>
    </fieldset>
  </aside>;
}
