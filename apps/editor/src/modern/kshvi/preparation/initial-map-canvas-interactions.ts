import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { InitialSituationMap, Position } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { markerImageId } from './initial-map-symbol';
import type { MapEditorInteractions } from './InitialMapEditor';

const objectLayers = ['kshvi-initial-points', 'kshvi-initial-point-icons', 'kshvi-initial-lines', 'kshvi-initial-areas', 'kshvi-initial-line-icons', 'kshvi-initial-area-icons'];
type Drag = { kind: 'objects'; ids: readonly string[]; point: Position }
  | { kind: 'vertex'; id: string; vertex: number; ring: number }
  | { kind: 'box'; x: number; y: number };

export function attachEditorInteractions(canvas: MapLibreMap, getInteraction: () => MapEditorInteractions | undefined, getMap: () => InitialSituationMap | undefined): () => void {
  let drag: Drag | null = null;
  let box: HTMLDivElement | null = null;
  let ignoreClickUntil = 0;
  let restorePan = false;
  const point = (event: MapMouseEvent): Position => [event.lngLat.lng, event.lngLat.lat];
  const hit = (event: MapMouseEvent, vertices = false) => {
    const layers = (vertices ? ['kshvi-editor-vertices'] : objectLayers).filter(id => canvas.getLayer(id));
    return layers.length ? canvas.queryRenderedFeatures(event.point, { layers })[0] : undefined;
  };
  const clear = () => { drag = null; box?.remove(); box = null; if (restorePan) canvas.dragPan.enable(); restorePan = false; };
  const click = (event: MapMouseEvent) => {
    const config = getInteraction();
    if (!config || performance.now() < ignoreClickUntil) return;
    if (config.drawing && !config.disabled) { config.onPoint(point(event)); return; }
    const feature = hit(event);
    if (typeof feature?.properties?.id === 'string') config.onSelect(feature.properties.id,
      event.originalEvent.shiftKey || event.originalEvent.ctrlKey || event.originalEvent.metaKey);
  };
  const doubleClick = (event: MapMouseEvent) => {
    const config = getInteraction();
    if (config?.drawing && !config.disabled) { event.preventDefault(); config.onFinish(); }
  };
  const mouseDown = (event: MapMouseEvent) => {
    const config = getInteraction();
    if (!config || config.disabled || config.drawing || event.originalEvent.button !== 0) return;
    const vertex = hit(event, true)?.properties;
    const feature = hit(event)?.properties;
    if (vertex && typeof vertex.markerId === 'string') {
      drag = { kind: 'vertex', id: vertex.markerId, vertex: Number(vertex.vertex), ring: Number(vertex.ring) };
    } else if (typeof feature?.id === 'string') {
      const ids = config.selectedIds.includes(feature.id) ? config.selectedIds : [feature.id];
      drag = { kind: 'objects', ids, point: point(event) };
    } else if (event.originalEvent.shiftKey) {
      drag = { kind: 'box', x: event.point.x, y: event.point.y };
    }
    if (drag) { event.preventDefault(); restorePan = canvas.dragPan.isEnabled(); canvas.dragPan.disable(); }
  };
  const mouseMove = (event: MapMouseEvent) => {
    if (!drag) return;
    if (getInteraction()?.disabled) { clear(); return; }
    if (drag.kind === 'box') {
      if (!box) { box = document.createElement('div'); box.className = 'initial-editor-selection-box'; canvas.getContainer().appendChild(box); }
      Object.assign(box.style, { left: `${Math.min(drag.x, event.point.x)}px`, top: `${Math.min(drag.y, event.point.y)}px`,
        width: `${Math.abs(drag.x - event.point.x)}px`, height: `${Math.abs(drag.y - event.point.y)}px` });
    }
    canvas.getCanvas().style.cursor = 'grabbing';
  };
  const mouseUp = (event: MapMouseEvent) => {
    const previous = drag, config = getInteraction();
    clear(); canvas.getCanvas().style.cursor = '';
    if (!previous || !config || config.disabled) return;
    const visible = new Set(getMap()?.markers.map(marker => marker.id));
    if (previous.kind === 'vertex' && visible.has(previous.id)) {
      config.onMoveVertex(previous.id, previous.vertex, previous.ring, point(event)); ignoreClickUntil = performance.now() + 200;
    } else if (previous.kind === 'objects' && previous.ids.every(id => visible.has(id))) {
      const destination = point(event), lon = destination[0] - previous.point[0], lat = destination[1] - previous.point[1];
      if (Math.abs(lon) + Math.abs(lat) > 1e-10) { config.onMove(previous.ids, { lon, lat }); ignoreClickUntil = performance.now() + 200; }
    } else if (previous.kind === 'box') {
      const layers = objectLayers.filter(id => canvas.getLayer(id));
      const features = layers.length ? canvas.queryRenderedFeatures([[Math.min(previous.x, event.point.x), Math.min(previous.y, event.point.y)],
        [Math.max(previous.x, event.point.x), Math.max(previous.y, event.point.y)]], { layers }) : [];
      config.onSelectBox([...new Set(features.map(feature => feature.properties?.id).filter((id): id is string => typeof id === 'string' && visible.has(id)))]);
      ignoreClickUntil = performance.now() + 200;
    }
  };
  const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
  const entries = [['click', click], ['dblclick', doubleClick], ['mousedown', mouseDown], ['mousemove', mouseMove], ['mouseup', mouseUp]] as const;
  for (const [name, handler] of entries) canvas.on(name, handler);
  if (typeof window !== 'undefined') window.addEventListener('keydown', cancel);
  return () => { clear(); for (const [name, handler] of entries) canvas.off(name, handler); if (typeof window !== 'undefined') window.removeEventListener('keydown', cancel); };
}

function source(canvas: MapLibreMap, id: string, features: GeoJSON.Feature[]): void {
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  const existing = canvas.getSource(id) as GeoJSONSource | undefined;
  if (existing) existing.setData(data); else canvas.addSource(id, { type: 'geojson', data });
}

export function updateEditorOverlays(canvas: MapLibreMap, map: InitialSituationMap, interaction?: MapEditorInteractions): void {
  if (!interaction && !canvas.getSource('kshvi-editor-vertices')) return;
  const vertices: GeoJSON.Feature[] = [];
  if (interaction && !interaction.disabled) for (const marker of map.markers) {
    if (!interaction.selectedIds.includes(marker.id) || !marker.geometry) continue;
    const groups = marker.geometry.type === 'Point' ? [[marker.geometry.coordinates]]
      : marker.geometry.type === 'LineString' ? [marker.geometry.coordinates] : marker.geometry.coordinates;
    groups.forEach((ring, ringIndex) => ring.forEach((position, index) => {
      if (marker.geometry!.type === 'Polygon' && index === ring.length - 1) return;
      vertices.push({ type: 'Feature', properties: { markerId: marker.id, vertex: index, ring: ringIndex }, geometry: { type: 'Point', coordinates: [...position] } });
    }));
  }
  source(canvas, 'kshvi-editor-vertices', vertices);
  if (!canvas.getLayer('kshvi-editor-vertices')) canvas.addLayer({ id: 'kshvi-editor-vertices', type: 'circle', source: 'kshvi-editor-vertices',
    paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#225f88', 'circle-stroke-width': 2 } });
  const pending = interaction?.drawing;
  const features: GeoJSON.Feature[] = [];
  if (pending?.points.length) {
    const icon = pending.geometryKind === 'POINT' ? markerImageId(pending.marker.symbol) : '';
    for (const position of pending.points) features.push({ type: 'Feature', properties: icon && canvas.hasImage(icon) ? { icon } : {}, geometry: { type: 'Point', coordinates: [...position] } });
    if (pending.points.length > 1) {
      const points = pending.points.map(position => [...position]);
      if (pending.geometryKind === 'AREA') points.push([...points[0]]);
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } });
    }
  }
  source(canvas, 'kshvi-editor-drawing', features);
  if (!canvas.getLayer('kshvi-editor-drawing-line')) {
    canvas.addLayer({ id: 'kshvi-editor-drawing-line', type: 'line', source: 'kshvi-editor-drawing', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#225f88', 'line-width': 2, 'line-dasharray': [3, 2] } });
    canvas.addLayer({ id: 'kshvi-editor-drawing-points', type: 'circle', source: 'kshvi-editor-drawing', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'icon']]], paint: { 'circle-color': '#225f88', 'circle-radius': 4 } });
  }
  if (!canvas.getLayer('kshvi-editor-drawing-icons')) canvas.addLayer({ id: 'kshvi-editor-drawing-icons', type: 'symbol', source: 'kshvi-editor-drawing', filter: ['has', 'icon'], layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true }, paint: { 'icon-opacity': 0.8 } });
  canvas.getCanvas().style.cursor = pending ? 'crosshair' : '';
  if (pending) canvas.doubleClickZoom.disable(); else canvas.doubleClickZoom.enable();
}
