import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AudienceLayer, CameraPosition } from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import type { AudienceProjectionView } from './AudienceProjector';
import { createExpositionMapStyle } from './map-style';
import 'maplibre-gl/dist/maplibre-gl.css';

export function ExpositionMap({ map, layers, camera }: Readonly<{
  map: AudienceProjectionView['map'];
  layers: readonly AudienceLayer[];
  camera: CameraPosition;
}>) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const latest = useRef({ map, layers, camera });
  latest.current = { map, layers, camera };
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(lib => {
      if (disposed || !container.current) return;
      const current = latest.current;
      const created = new lib.Map({
        container: container.current,
        style: createExpositionMapStyle(current.map, current.layers),
        center: [current.camera.center[0], current.camera.center[1]],
        zoom: current.camera.zoom,
        bearing: current.camera.heading,
        pitch: 0,
        interactive: false,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      instance.current = created;
      created.on('load', () => { if (!disposed) setReady(value => value + 1); });
      created.on('error', event => { if (!disposed) setError(event.error.message); });
      setReady(value => value + 1);
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      disposed = true;
      instance.current?.remove();
      instance.current = null;
    };
  }, []);

  const styleKey = JSON.stringify({ map, layers });
  useEffect(() => {
    const created = instance.current;
    if (!created || ready === 0) return;
    created.setStyle(createExpositionMapStyle(map, layers));
    created.resize();
  }, [styleKey, ready]);

  useEffect(() => {
    const created = instance.current;
    if (!created || ready === 0) return;
    created.jumpTo({ center: [camera.center[0], camera.center[1]], zoom: camera.zoom, bearing: camera.heading, pitch: 0 });
  }, [camera.center[0], camera.center[1], camera.zoom, camera.heading, ready]);

  return <div className="exposition-maplibre-wrap">
    <div
      ref={container}
      className="exposition-maplibre"
      data-testid="exposition-maplibre"
      data-center={camera.center.join(',')}
      data-zoom={camera.zoom}
      data-heading={camera.heading}
      role="img"
      aria-label="Географическая карта экспозиции с местностью и маршрутом камеры"
    />
    {error && <span className="exposition-map-error" role="status">Карта: {error}</span>}
  </div>;
}
