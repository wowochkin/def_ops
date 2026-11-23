import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { EnvironmentSnapshot } from '../../../../../../packages/kshvi/src/environment/provider';
import type { InitialSituationMap } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import 'maplibre-gl/dist/maplibre-gl.css';

export function snapshotStyleUrls<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('/kshvi/') ? `/api${value}` : value) as T;
  if (Array.isArray(value)) return value.map(item => snapshotStyleUrls(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, snapshotStyleUrls(child)])) as T;
  }
  return value;
}

export function InitialMapCanvas({ snapshot, map }: { snapshot: EnvironmentSnapshot; map: InitialSituationMap }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let lib: typeof import('maplibre-gl');
    const atlasId = snapshot.atlases[0]?.id;
    if (!atlasId || !container.current) return;
    setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/kshvi/environment/snapshots/${snapshot.id}/atlas/${encodeURIComponent(atlasId)}/style`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Стиль снимка недоступен (${response.status})`);
        const style = snapshotStyleUrls(await response.json() as StyleSpecification);
        lib = await import('maplibre-gl');
        if (disposed || !container.current) return;
        const canvas = new lib.Map({
          container: container.current, style, attributionControl: { compact: true },
          transformRequest: url => ({ url: url.startsWith('/kshvi/') ? `/api${url}` : url }),
        });
        instance.current = canvas;
        canvas.addControl(new lib.NavigationControl(), 'top-right');
        canvas.on('load', () => {
          loaded.current = true;
          const [west, south, east, north] = map.bounds;
          canvas.fitBounds([[west, south], [east, north]], { padding: 32, duration: 0 });
          updateMarkers();
        });
        canvas.on('error', event => { if (!disposed) setError(event.error.message); });
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Карта недоступна');
      }
    })();
    return () => {
      disposed = true;
      loaded.current = false;
      instance.current?.remove();
      instance.current = null;
    };
  }, [snapshot.id]);

  function updateMarkers(): void {
    const canvas = instance.current;
    if (!canvas || !loaded.current) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: map.markers.filter(marker => marker.geometry).map(marker => ({
        type: 'Feature' as const, geometry: marker.geometry!,
        properties: { id: marker.id, kind: marker.kind, sideId: marker.sideId },
      })),
    } as unknown as GeoJSON.GeoJSON;
    const existing = canvas.getSource('kshvi-initial-markers') as GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    canvas.addSource('kshvi-initial-markers', { type: 'geojson', data });
    canvas.addLayer({
      id: 'kshvi-initial-points', type: 'circle', source: 'kshvi-initial-markers',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'sideId'], 'red', '#b42318', 'blue', '#175cd3', '#475467'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-lines', type: 'line', source: 'kshvi-initial-markers',
      filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#175cd3', 'line-width': 3 },
    });
    canvas.addLayer({
      id: 'kshvi-initial-labels', type: 'symbol', source: 'kshvi-initial-markers',
      layout: { 'text-field': ['get', 'id'], 'text-size': 12, 'text-offset': [0, 1.2] },
      paint: { 'text-color': '#101828', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    });
  }

  useEffect(() => { updateMarkers(); }, [map.markers]);

  return <section aria-label="Топографическая карта исходной обстановки">
    <div ref={container} style={{ height: 480, minHeight: 320, borderRadius: 8, overflow: 'hidden' }} aria-label="Карта исходной обстановки" />
    {error && <p role="alert">Топографическая карта недоступна: {error}</p>}
  </section>;
}
