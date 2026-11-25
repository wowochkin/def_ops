import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Bounds, EnvironmentSnapshot } from '../../../../../../packages/kshvi/src/environment/provider';
import type { InitialSituationMap } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { getSymbol, renderSymbol } from '@def-ops/tactical-symbols';
import type { KshviClient } from '../kshvi-api';
import { loadEnvironmentStyles } from './snapshot-map-style';
import { editedSymbol, markerImageId } from './initial-map-symbol';
import type { MapEditorInteractions } from './InitialMapEditor';
import { attachEditorInteractions, updateEditorOverlays } from './initial-map-canvas-interactions';
import type { WeatherRaster } from '../../weather-layer';
import 'maplibre-gl/dist/maplibre-gl.css';

async function ensureSymbolImages(canvas: MapLibreMap, map: InitialSituationMap): Promise<void> {
  if (typeof Image === 'undefined') return;
  const seen = new Set<string>();
  for (const marker of map.markers) {
    const imageId = markerImageId(marker.symbol);
    if (seen.has(imageId)) continue;
    seen.add(imageId);
    try {
      const symbol = editedSymbol(getSymbol(marker.symbol.id), marker.symbol);
      if (canvas.hasImage(imageId)) continue;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSymbol(symbol, { width: 80, height: 80 }))}`;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG знака не загрузился')); });
      if (!canvas.hasImage(imageId)) canvas.addImage(imageId, image);
    } catch {
      // Внешняя отметка без известного знака сохраняет резервное круговое обозначение.
    }
  }
}

export function snapshotStyleUrls<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('/kshvi/') || value.startsWith('/cartography/') ? `/api${value}` : value) as T;
  if (Array.isArray(value)) return value.map(item => snapshotStyleUrls(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, snapshotStyleUrls(child)])) as T;
  }
  return value;
}

export function annotationFont(style: StyleSpecification): string[] | null {
  if (!style.glyphs) return null;
  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    const fonts = layer.layout?.['text-font'];
    if (Array.isArray(fonts) && fonts.length && fonts.every(font => typeof font === 'string')
      && !['get', 'literal', 'concat', 'to-string'].includes(fonts[0] as string)) return [fonts[0] as string];
  }
  return null;
}

export function InitialMapCanvas({ client, snapshot, map, interaction }: {
  client: KshviClient; snapshot: EnvironmentSnapshot; map?: InitialSituationMap; interaction?: MapEditorInteractions;
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
    {style && <EnvironmentMapPreview style={style} bounds={snapshot.region.bounds} map={map} interaction={interaction}
      label="Карта исходной обстановки" />}
  </>;
}

export type WeatherMapPoint = Readonly<{ lon: number; lat: number; value: number }>;

export function EnvironmentMapPreview({ style, bounds, map, weatherRasters, interaction, label = 'Предпросмотр выбранных слоёв' }: {
  style: StyleSpecification; bounds: Bounds; map?: InitialSituationMap; weatherRasters?: readonly WeatherRaster[]; interaction?: MapEditorInteractions; label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const latest = useRef({ map, weatherRasters, interaction });
  latest.current = { map, weatherRasters, interaction };
  const [error, setError] = useState('');

  function fit(canvas: MapLibreMap) {
    const [west, south, east, north] = bounds;
    canvas.fitBounds([[west, south], [east, north]], { padding: 32, duration: 0 });
  }

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | undefined;
    setError('');
    void import('maplibre-gl').then(lib => {
      if (disposed || !container.current) return;
      const canvas = new lib.Map({ container: container.current, style: snapshotStyleUrls(style), attributionControl: { compact: true }, locale: {
        'NavigationControl.ZoomIn': 'Приблизить',
        'NavigationControl.ZoomOut': 'Отдалить',
        'NavigationControl.ResetBearing': 'Повернуть карту на север',
      } });
      instance.current = canvas;
      if (latest.current.interaction) detach = attachEditorInteractions(canvas, () => latest.current.interaction, () => latest.current.map);
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
        if (currentMap) void ensureSymbolImages(canvas, drawingSymbols(currentMap)).then(updateMarkers);
      });
      canvas.on('error', event => { if (!disposed) setError(event.error.message); });
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Карта недоступна'); });
    return () => {
      disposed = true;
      loaded.current = false;
      detach?.();
      instance.current?.remove();
      instance.current = null;
    };
  }, [style, bounds]);

  function drawingSymbols(value: InitialSituationMap): InitialSituationMap {
    const pending = latest.current.interaction?.drawing;
    return pending ? { ...value, markers: [...value.markers, pending.marker] } : value;
  }

  function updateWeather(): void {
    const canvas = instance.current;
    if (!canvas || !loaded.current) return;
    const rasters = latest.current.weatherRasters ?? [];
    for (const [index, raster] of rasters.entries()) {
      const id = `kshvi-weather-${index}`;
      const existing = canvas.getSource(id) as import('maplibre-gl').ImageSource | undefined;
      if (existing) {
        existing.updateImage({ image: new ImageData(raster.pixels, raster.size, raster.size), coordinates: raster.coordinates });
        continue;
      }
      canvas.addSource(id, { type: 'image', coordinates: raster.coordinates });
      (canvas.getSource(id) as import('maplibre-gl').ImageSource).updateImage({
        image: new ImageData(raster.pixels, raster.size, raster.size), coordinates: raster.coordinates,
      });
      const before = canvas.getStyle().layers.find(layer => layer.id.startsWith('kshvi-initial-'))?.id;
      canvas.addLayer({ id, type: 'raster', source: id,
        paint: { 'raster-opacity': 0.68, 'raster-fade-duration': 0 } }, before);
    }
    for (let index = rasters.length; canvas.getSource(`kshvi-weather-${index}`); index += 1) {
      canvas.removeLayer(`kshvi-weather-${index}`);
      canvas.removeSource(`kshvi-weather-${index}`);
    }
    if (canvas.getLayer('kshvi-weather')) canvas.removeLayer('kshvi-weather');
    if (canvas.getSource('kshvi-weather')) canvas.removeSource('kshvi-weather');
  }

  useEffect(() => updateWeather(), [weatherRasters]);

  function updateMarkers(): void {
    const canvas = instance.current;
    const map = latest.current.map;
    if (!canvas || !loaded.current || !map) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: map.markers.filter(marker => marker.geometry).map(marker => {
        let icon = '';
        try {
          const id = markerImageId(marker.symbol);
          if (canvas.hasImage(id)) icon = id;
        } catch { /* резервный значок для неизвестного источника */ }
        return {
          type: 'Feature' as const, geometry: marker.geometry!,
          properties: { id: marker.id, name: marker.name ?? marker.id, kind: marker.kind, sideId: marker.sideId, ...(icon ? { icon } : {}) },
        };
      }),
    } as unknown as GeoJSON.GeoJSON;
    const existing = canvas.getSource('kshvi-initial-markers') as GeoJSONSource | undefined;
    if (existing) { existing.setData(data); updateEditorOverlays(canvas, map, latest.current.interaction); return; }
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
    const font = annotationFont(style);
    if (font) canvas.addLayer({
      id: 'kshvi-initial-labels', type: 'symbol', source: 'kshvi-initial-markers',
      layout: { 'text-font': font!, 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2] },
      paint: { 'text-color': '#101828', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    });
    updateEditorOverlays(canvas, map, latest.current.interaction);
  }

  useEffect(() => {
    const canvas = instance.current;
    if (canvas && map) void ensureSymbolImages(canvas, drawingSymbols(map)).then(updateMarkers);
  }, [map, interaction]);

  return <section className="kshvi-environment-map" aria-label={label}>
    <div ref={container} className="kshvi-environment-map-canvas" />
    <button className="kshvi-fit-region" type="button" onClick={() => { if (instance.current) fit(instance.current); }}>Область целиком</button>
    {error && <p role="alert">Топографическая карта недоступна: {error}</p>}
  </section>;
}
