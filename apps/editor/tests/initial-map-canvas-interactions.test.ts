import { expect, it, vi } from 'vitest';
import { attachEditorInteractions } from '../src/modern/kshvi/preparation/initial-map-canvas-interactions';

it('при отзыве редактирования в середине переноса не отправляет изменение', () => {
  const listeners = new Map<string, (event: any) => void>();
  const onMove = vi.fn();
  let disabled = false;
  const interactions = () => ({ disabled, drawing: null, selectedIds: ['object'], onMove, onPoint: vi.fn(),
    onFinish: vi.fn(), onSelect: vi.fn(), onSelectBox: vi.fn(), onMoveVertex: vi.fn() });
  const canvas = {
    on: (event: string, handler: any) => listeners.set(event, handler), off: (event: string) => listeners.delete(event),
    getLayer: () => ({}), queryRenderedFeatures: () => [{ properties: { id: 'object' }, layer: { id: 'kshvi-initial-points' } }],
    dragPan: { disable: vi.fn(), enable: vi.fn(), isEnabled: () => true }, getCanvas: () => ({ style: {} }),
    getContainer: () => ({ appendChild: vi.fn() }),
  };
  const dispose = attachEditorInteractions(canvas as never, interactions, () => ({ markers: [{ id: 'object' }] } as never));
  const event = (lng: number) => ({ point: { x: 20, y: 30 }, lngLat: { lng, lat: 0.5 }, originalEvent: { button: 0, shiftKey: false }, preventDefault: vi.fn() });
  listeners.get('mousedown')!(event(0.2));
  disabled = true;
  listeners.get('mouseup')!(event(0.4));
  expect(onMove).not.toHaveBeenCalled();
  expect(canvas.dragPan.enable).toHaveBeenCalled();
  dispose();
  expect(listeners.size).toBe(0);
});

it('не включает панорамирование, которое редактор сам не отключал', () => {
  const listeners = new Map<string, (event: any) => void>();
  const enable = vi.fn();
  const canvas = { on: (event: string, handler: any) => listeners.set(event, handler), off: (event: string) => listeners.delete(event),
    dragPan: { disable: vi.fn(), enable, isEnabled: () => false }, getCanvas: () => ({ style: {} }) };
  const dispose = attachEditorInteractions(canvas as never, () => undefined, () => undefined);
  listeners.get('mouseup')!({} as never);
  dispose();
  expect(enable).not.toHaveBeenCalled();
});
