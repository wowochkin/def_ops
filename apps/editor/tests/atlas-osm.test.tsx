// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(() => cleanup());
import { AtlasCatalog } from '../src/modern/AtlasCatalog';
import type { AtlasMeta } from '../../../services/cartography/src/atlas';
import type { RegionGroup } from '../src/modern/atlas-region-state';

it('открывает область как целую группу наборов', () => {
  const open = vi.fn();
  const map = { id: 'vector', kind: 'vector', name: 'Основа', layers: [], bounds: [35, 49, 37, 51], minzoom: 8, maxzoom: 13, bytes: 1, format: 'pbf', attribution: 'Тест' } as AtlasMeta;
  const group: RegionGroup = { key: 'area', bounds: map.bounds, maps: [map] };
  render(<AtlasCatalog
    groups={[group]} selected={[]} disabled={new Set()} terrainId={null}
    names={{}} rename={vi.fn()} toggle={vi.fn()} toggleLayer={vi.fn()} terrain={vi.fn()}
    show={open} remove={vi.fn()} removeRegion={vi.fn()} download={vi.fn(() => '/export')} busy={false} load={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть область' }));
  expect(open).toHaveBeenCalledWith(group);
});


it('удаляет область только после отдельного подтверждения', () => {
  const removeRegion = vi.fn();
  const map = { id: 'vector', kind: 'vector', name: 'Основа', layers: [], bounds: [35, 49, 37, 51], minzoom: 8, maxzoom: 13, bytes: 1, format: 'pbf', attribution: 'Тест' } as AtlasMeta;
  const group: RegionGroup = { key: 'area', bounds: map.bounds, maps: [map] };
  render(<AtlasCatalog
    groups={[group]} selected={[]} disabled={new Set()} terrainId={null}
    names={{}} rename={vi.fn()} toggle={vi.fn()} toggleLayer={vi.fn()} terrain={vi.fn()}
    show={vi.fn()} remove={vi.fn()} removeRegion={removeRegion} download={vi.fn(() => '/export')} busy={false} load={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить область' }));
  expect(screen.getByText(/Удалить область .* со всеми наборами/)).toBeTruthy();
  expect(removeRegion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить удаление области' }));
  expect(removeRegion).toHaveBeenCalledWith(group);
});
