import { DatabaseSync } from 'node:sqlite';
import { inspectAtlas } from '../services/cartography/src/atlas';
import { countAtlasTiles, type AtlasTileCount } from '../services/cartography/src/atlas-tile-inventory';

function report(file: string, levels: AtlasTileCount[]) {
  console.log(file);
  for (const {zoom, present, expected} of levels) console.log(`  z${zoom}  ${present} / ${expected}`);
  return levels.some(level => level.present < level.expected);
}

try {
  const [base, ...layers] = process.argv.slice(2);
  if (!base) throw Error('Укажите базовый файл MBTiles и, при наличии, файлы сравниваемых слоёв.');
  const frame = inspectAtlas(base);
  console.log('Непустые тайлы в рамке обзорного уровня базы / число позиций в рамке');
  let partial = report(base, frame.tileInventory);
  for (const file of layers) {
    const db = new DatabaseSync(file, {readOnly: true});
    try {
      if (report(file, countAtlasTiles(db, frame))) partial = true;
    } finally {
      db.close();
    }
  }
  if (partial) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
