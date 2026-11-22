// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraPosition } from '../../../packages/kshvi/src/exposition/camera-route';
import { ExpositionMap } from '../src/modern/kshvi/exposition/ExpositionMap';

const instances: MockMap[] = [];
class MockMap {
  setStyle = vi.fn();
  jumpTo = vi.fn();
  resize = vi.fn();
  remove = vi.fn();
  on = vi.fn();
  constructor() { instances.push(this); }
}
vi.mock('maplibre-gl', () => ({ Map: MockMap }));
afterEach(() => { cleanup(); instances.length = 0; });

const camera = (atMs: number): CameraPosition => ({ atMs, center: [30 + atMs / 1_000, 50], zoom: 8, heading: atMs / 10 });

describe('жизненный цикл MapLibre', () => {
  it('не пересоздаёт style при движении камеры, а меняет его только вместе с картой или слоями', async () => {
    const layers = ['weather'] as const;
    const firstMap = { weather: { summary: 'Ясно' } };
    const secondMap = { weather: { summary: 'Дождь' } };
    const view = render(<ExpositionMap map={firstMap} layers={layers} camera={camera(0)} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const map = instances[0];
    await waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));
    const initialResize = map.resize.mock.calls.length;

    view.rerender(<ExpositionMap map={firstMap} layers={layers} camera={camera(1_000)} />);
    await waitFor(() => expect(map.jumpTo.mock.calls.length).toBeGreaterThan(1));
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.resize).toHaveBeenCalledTimes(initialResize);

    view.rerender(<ExpositionMap map={secondMap} layers={layers} camera={camera(1_000)} />);
    await waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(2));
    expect(map.resize).toHaveBeenCalledTimes(initialResize + 1);
  });
});
