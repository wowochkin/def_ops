import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { countAtlasTiles } from '../src/atlas-tile-inventory';

describe('Число тайлов в неизменной рамке обзорного уровня', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)');
  });
  afterEach(() => db.close());

  it('учитывает TMS, пустой уровень, дубликаты, пустое содержимое и тайлы вне рамки', () => {
    db.exec(`INSERT INTO tiles VALUES (1,1,1,x'01'), (2,2,2,x'01'), (2,2,2,x'02'),
      (2,3,3,x''), (2,2,0,x'01'), (2,1,2,x'01')`);
    expect(countAtlasTiles(db, {bounds:[10,10,11,11], minzoom:1, maxzoom:3})).toEqual([
      {zoom:1, present:1, expected:1}, {zoom:2, present:1, expected:4}, {zoom:3, present:0, expected:16},
    ]);
  });

  it('объединяет пересекающиеся части рамки за 180-м меридианом на обзорном уровне', () => {
    db.exec("INSERT INTO tiles VALUES (0,0,0,x'01'), (1,0,0,x'01'), (1,0,1,x'01'), (1,1,0,x'01'), (1,1,1,x'01')");
    expect(countAtlasTiles(db, {bounds:[179,-1,-179,1], minzoom:0, maxzoom:1})).toEqual([
      {zoom:0, present:1, expected:1}, {zoom:1, present:4, expected:4},
    ]);
  });

  it('исключает середину мира для раздельных частей рамки', () => {
    db.exec("INSERT INTO tiles VALUES (2,0,2,x'01'), (2,1,2,x'01'), (2,3,2,x'01')");
    expect(countAtlasTiles(db, {bounds:[179,1,-179,2], minzoom:2, maxzoom:2})).toEqual([
      {zoom:2, present:2, expected:2},
    ]);
  });
});
