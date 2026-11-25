import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Bounds, EnvironmentSnapshot } from '../../../../../../packages/kshvi/src/environment/provider';
import type { InitialSituationMap } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { getSymbol, symbolImageId, symbolImages } from '@def-ops/tactical-symbols';
import type { KshviClient } from '../kshvi-api';
import { loadEnvironmentStyles } from './snapshot-map-style';
import 'maplibre-gl/dist/maplibre-gl.css';

async function ensureSymbolImages(canvas: MapLibreMap, map: InitialSituationMap): Promise<void> {
  if (typeof Image === 'undefined') return;
  const seen = new Set<string>();
  for (const marker of map.markers) {
    if (seen.has(marker.symbol.id)) continue;
    seen.add(marker.symbol.id);
    try {
      const symbol = getSymbol(marker.symbol.id);
      const definition = symbolImages([symbol], { width: 80, height: 80 })[0]!;
      if (canvas.hasImage(definition.id)) continue;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(definition.svg)}`;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG знака не загрузился')); });
      if (!canvas.hasImage(definition.id)) canvas.addImage(definition.id, image);
    } catch {
      // Внешняя отметка без известного знака сохраняет резервное круговое обозначение.
    }
  }
}

export function snapshotStyleUrls<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('/kshvi/') ? `/api${value}` : value) as T;
  if (Array.isArray(value)) return value.map(item => snapshotStyleUrls(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, snapshotStyleUrls(child)])) as T;
  }
  return value;
}

export function InitialMapCanvas({ client, snapshot, map }: {
  client: KshviClient; snapshot: EnvironmentSnapshot; map?: InitialSituationMap;
}) {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setStyle(null);
    setError('');
    void loadEnvironmentStyles(snapshot.atlases.map(atlas => atlas.meta), id => client.getEnvironmentSnapshotStyle(snapshot.id, id))
      .then(value => { if (active) setStyle(snapshotStyleUrls(value)); })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [client, snapshot]);

  return <>
    {error && <p role="alert">Топографическая карта недоступна: {error}</p>}
    {style && <EnvironmentMapPreview style={style} bounds={snapshot.region.bounds} map={map}
      label="Карта исходной обстановки" />}
  </>;
}

export type WeatherMapPoint = Readonly<{ lon: number; lat: number; value: number }>;

export function EnvironmentMapPreview({ style, bounds, map, weatherPoints, label = 'Предпросмотр выбранных слоёв' }: {
  style: StyleSpecification; bounds: Bounds; map?: InitialSituationMap; weatherPoints?: readonly WeatherMapPoint[]; label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const latest = useRef({ map, weatherPoints });
  latest.current = { map, weatherPoints };
  const [error, setError] = useState('');

  function fit(canvas: MapLibreMap) {
    const [west, south, east, north] = bounds;
    canvas.fitBounds([[west, south], [east, north]], { padding: 32, duration: 0 });
  }

  useEffect(() => {
    let disposed = false;
    setError('');
    void import('maplibre-gl').then(lib => {
      if (disposed || !container.current) return;
      const canvas = new lib.Map({ container: container.current, style, attributionControl: { compact: true }, locale: {
        'NavigationControl.ZoomIn': 'Приблизить',
        'NavigationControl.ZoomOut': 'Отдалить',
        'NavigationControl.ResetBearing': 'Повернуть карту на север',
      } });
      instance.current = canvas;
      canvas.addControl(new lib.NavigationControl(), 'top-right');
      canvas.on('load', () => {
        if (disposed) return;
        loaded.current = true;
        fit(canvas);
        const [w, s, e, n] = bounds;
        canvas.addSource('kshvi-region', { type: 'geojson', data: {
          type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
        } });
        canvas.addLayer({ id: 'kshvi-region', type: 'line', source: 'kshvi-region',
          paint: { 'line-color': '#214760', 'line-width': 2, 'line-dasharray': [4, 2] } });
        updateWeather();
        const currentMap = latest.current.map;
        if (currentMap) void ensureSymbolImages(canvas, currentMap).then(updateMarkers);
      });
      canvas.on('error', event => { if (!disposed) setError(event.error.message); });
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Карта недоступна'); });
    return () => {
      disposed = true;
      loaded.current = false;
      instance.current?.remove();
      instance.current = null;
    };
  }, [style, bounds]);

  function updateWeather(): void {
    const canvas = instance.current;
    if (!canvas || !loaded.current) return;
    const points = latest.current.weatherPoints ?? [];
    const data: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection', features: points.map(({ lon, lat, value }) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { temperature: value },
      })),
    };
    const previous = canvas.getSource('kshvi-weather') as GeoJSONSource | undefined;
    if (previous) { previous.setData(data); return; }
    if (!points.length) return;
    canvas.addSource('kshvi-weather', { type: 'geojson', data });
    canvas.addLayer({ id: 'kshvi-weather', type: 'circle', source: 'kshvi-weather', paint: {
      'circle-color': ['interpolate', ['linear'], ['get', 'temperature'], -20, '#225ea8', 0, '#41b6c4', 20, '#fdae61', 40, '#d73027'],
      'circle-radius': 8, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff',
    } });
  }

  useEffect(() => updateWeather(), [weatherPoints]);

  function updateMarkers(): void {
    const canvas = instance.current;
    const map = latest.current.map;
    if (!canvas || !loaded.current || !map) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: map.markers.filter(marker => marker.geometry).map(marker => {
        let icon = '';
        try {
          const id = symbolImageId(getSymbol(marker.symbol.id));
          if (canvas.hasImage(id)) icon = id;
        } catch { /* резервный значок для неизвестного источника */ }
        return {
          type: 'Feature' as const, geometry: marker.geometry!,
          properties: { id: marker.id, kind: marker.kind, sideId: marker.sideId, ...(icon ? { icon } : {}) },
        };
      }),
    } as unknown as GeoJSON.GeoJSON;
    const existing = canvas.getSource('kshvi-initial-markers') as GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    canvas.addSource('kshvi-initial-markers', { type: 'geojson', data });
    const sideColor: ExpressionSpecification = ['match', ['get', 'sideId'], 'red', '#b42318', 'blue', '#175cd3', '#475467'];
    canvas.addLayer({
      id: 'kshvi-initial-areas', type: 'fill', source: 'kshvi-initial-markers',
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': sideColor, 'fill-opacity': 0.14 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-area-outlines', type: 'line', source: 'kshvi-initial-markers',
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': sideColor, 'line-width': 2 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-lines', type: 'line', source: 'kshvi-initial-markers',
      filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': sideColor, 'line-width': 3 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-points', type: 'circle', source: 'kshvi-initial-markers',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'icon']]],
      paint: { 'circle-radius': 7, 'circle-color': sideColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-point-icons', type: 'symbol', source: 'kshvi-initial-markers',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'icon']],
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true },
    });
    canvas.addLayer({
      id: 'kshvi-initial-line-icons', type: 'symbol', source: 'kshvi-initial-markers',
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'icon']],
      layout: { 'symbol-placement': 'line', 'icon-image': ['get', 'icon'], 'icon-size': 0.65, 'symbol-spacing': 100, 'icon-rotation-alignment': 'map' },
    });
    canvas.addLayer({
      id: 'kshvi-initial-area-icons', type: 'symbol', source: 'kshvi-initial-markers',
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['has', 'icon']],
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.8, 'icon-allow-overlap': true },
    });
    canvas.addLayer({
      id: 'kshvi-initial-labels', type: 'symbol', source: 'kshvi-initial-markers',
      layout: { 'text-field': ['get', 'id'], 'text-size': 12, 'text-offset': [0, 1.2] },
      paint: { 'text-color': '#101828', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    });
  }

  useEffect(() => {
    const canvas = instance.current;
    if (canvas && map) void ensureSymbolImages(canvas, map).then(updateMarkers);
  }, [map]);

  return <section className="kshvi-environment-map" aria-label={label}>
    <div ref={container} className="kshvi-environment-map-canvas" />
    <button className="kshvi-fit-region" type="button" onClick={() => { if (instance.current) fit(instance.current); }}>Область целиком</button>
    {error && <p role="alert">Топографическая карта недоступна: {error}</p>}
  </section>;
}
