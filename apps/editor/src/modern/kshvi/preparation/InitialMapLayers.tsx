import type { InitialSituationMap, MapLayerId, MapMarker } from '../../../../../../packages/kshvi/src/scenario/initial-map';

const LAYER_NAMES: Record<MapLayerId, string> = {
  BASEMAP: 'Топооснова',
  TRUE_FORCES: 'Истинные силы сторон',
  PERSONAL_SITUATION: 'Личная обстановка',
  OBSERVATIONS: 'Наблюдения',
  EVENTS: 'События',
  RESOURCES: 'Ресурсы и МТО',
  COMMUNICATIONS: 'Связь',
  WEATHER: 'Погода',
  CBRN: 'РХБ',
  SOCIO_ECONOMIC: 'Социально-экономические данные',
  REFERENCE: 'Эталон',
  ACTUAL: 'Факт',
  BRANCHES: 'Ветвления',
  STAFF_COMMENTS: 'Служебные комментарии',
};

export function InitialMapLayers({ map, onEditGeometry }: Readonly<{ map: InitialSituationMap; onEditGeometry?: (marker: MapMarker) => void }>) {
  const symbols = new Map(map.markers.map(item => [`${item.symbol.id}@${item.symbol.version}`, item.symbol] as const));
  return <div>
    <section aria-labelledby="initial-map-layers-title">
      <h3 id="initial-map-layers-title">Независимые слои</h3>
      <ul>
        {map.layers.map(layer => <li key={layer.id}>
          {LAYER_NAMES[layer.id]}: {map.markers.filter(item => item.layerId === layer.id).length}
        </li>)}
      </ul>
    </section>
    <section aria-labelledby="initial-map-objects-title">
      <h3 id="initial-map-objects-title">Отметки текущей проекции</h3>
      {map.markers.length ? <ul>{map.markers.map(item => <li key={item.id}>
        <strong>{item.id}</strong> — {item.kind}; источник: {item.sourceId}; период: {item.validFrom} — {item.validUntil}
        {onEditGeometry && item.geometry && <button type="button" aria-label={`Изменить геометрию ${item.id}`} onClick={() => onEditGeometry(item)}>Изменить</button>}
      </li>)}</ul> : <p>Отметки отсутствуют; координаты автоматически не подставляются</p>}
    </section>
    <section aria-labelledby="initial-map-legend-title">
      <h3 id="initial-map-legend-title">Легенда и атрибуция</h3>
      <ul>{[...symbols.values()].map(symbol => <li key={`${symbol.id}@${symbol.version}`}>
        {symbol.id} {symbol.version} — {symbol.sourceDocument}, стр. {symbol.sourcePage}
      </li>)}</ul>
      <p>Погода: {map.weatherFrameRef}</p>
      <p>Динамическая местность: {map.terrainStateRef}</p>
      {map.attribution.map(item => <p key={item}>{item}</p>)}
    </section>
  </div>;
}
