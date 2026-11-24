import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { EnvironmentSnapshot } from '../../../../packages/kshvi/src/environment/provider';
import type { EnvironmentSnapshotStore } from './snapshot-store';
import { clipRasterTile } from '@def-ops/raster-tiles';

/** Читатель зафиксированного MBTiles, не загрузчик исходных картографических данных. */
export async function readSnapshotTile(
  store: EnvironmentSnapshotStore,
  snapshot: EnvironmentSnapshot,
  atlasId: string,
  z: number,
  x: number,
  y: number,
): Promise<Readonly<{ bytes: Buffer; format: string }> | null> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Недопустимый адрес тайла снимка');
  const atlas = snapshot.atlases.find(value => value.id === atlasId);
  const ref = atlas?.export.contentRef;
  if (!atlas || !ref) throw new Error('Экспорт атласа в снимке не найден');
  await store.read(ref, snapshot.id);
  const file = path.join(store.root, snapshot.id, ref.path);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const row = database.prepare('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=? limit 1').get(z, x, 2 ** z - 1 - y) as { tile_data?: Uint8Array } | undefined;
    const bytes = row?.tile_data;
    if (!bytes?.length) return null;
    if (atlas.meta.format === 'pbf') return { bytes: Buffer.from(bytes), format: atlas.meta.format };
    return clipRasterTile({ bytes: Buffer.from(bytes), format: atlas.meta.format, bounds: atlas.meta.bounds, z, x, y });
  } finally {
    database.close();
  }
}
