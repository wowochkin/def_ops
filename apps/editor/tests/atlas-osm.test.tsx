// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    show={open} remove={vi.fn()} download={vi.fn(() => '/export')} busy={false} load={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть область' }));
  expect(open).toHaveBeenCalledWith(group);
});
