// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useEffect, useLayoutEffect } from 'react';
import { emptyDocument } from '@def-ops/core';
import type { MapEngine, ViewState } from '../src/engine/types';
import { StageMap, type StageMapProps } from '../src/expo/StageMap';
import { fitView } from '../src/expo/stage-doc';

const map = vi.hoisted(() => ({ current: { center: [12, 51], zoom: 8, bearing: 0 } as ViewState }));
vi.mock('../src/shared', () => ({ useBasemaps: () => ({ current: 'none', opacity: 1, year: null }) }));
vi.mock('../src/expo/film', () => ({ MapFx: () => null, reducedMotion: () => false }));
vi.mock('../src/MapView', () => ({ MapView: ({ onEngineReady }: { onEngineReady: (engine: MapEngine) => void }) => {
  useEffect(() => {
    onEngineReady({
      size: () => ({ width: 1440, height: 600 }), resize: () => {}, setPanEnabled: () => {},
      setView: (v: ViewState) => { map.current = v; }, getContainer: () => document.body,
    } as unknown as MapEngine);
  }, []);
  return null;
} }));
afterEach(cleanup);

it('смена сцены ставит обзор камеры до первого отображения нового экрана', () => {
  const seen: ViewState[] = [];
  const doc = emptyDocument();
  function Screen({ camera }: { camera: StageMapProps['camera'] }) {
    useLayoutEffect(() => { seen.push(map.current); }, [camera]);
    return <StageMap doc={doc} time="1945-04-16T05:00" camera={camera} />;
  }
  const mounted = render(<Screen camera={{ bbox: [12, 51, 13, 52], key: 'turn-3', ms: 0 }} />);
  const overview: [number, number, number, number] = [10, 50, 16, 54];
  mounted.rerender(<Screen camera={{ bbox: overview, key: 'result-open', ms: 0 }} />);
  expect(seen.at(-1)).toEqual(fitView(overview, 1440, 600, 0.08));
});
