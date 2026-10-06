/** Каталог всех пресетов: по строке на каждый, сгруппировано по стилям. */
import { PRESETS, type PresetKind } from '@def-ops/core';
import { SceneBuilder } from './builder';

export function buildGallery(group: string, paper: string) {
  const b = new SceneBuilder([13.4, 52.5], 7.4, paper);
  let y = 0;
  const kinds: PresetKind[] = ['arrow', 'line', 'area', 'symbol', 'label'];
  for (const kind of kinds) {
    const table = PRESETS[kind] as Record<string, { name: string; group: string }>;
    let col = 0;
    for (const [id, p] of Object.entries(table)) {
      if (p.group !== group) continue;
      const x = (col % 3) * 330;
      if (col % 3 === 0 && col > 0) y += kind === 'arrow' ? 120 : 90;
      col++;
      b.label('atlas.town', [x, y - 32], p.name, (f) => { f.style.color = '#555'; f.style.italic = false; f.style.font = 'PT Sans Narrow'; f.style.size = 12; });
      if (kind === 'arrow') b.arrow(id, [[x + 10, y + 40], [x + 120, y + 10], [x + 270, y + 20]]);
      if (kind === 'line') b.line(id, [[x + 10, y + 20], [x + 110, y], [x + 200, y + 25], [x + 280, y + 10]]);
      if (kind === 'area') b.area(id, [[x + 40, y - 10], [x + 160, y - 15], [x + 230, y + 30], [x + 150, y + 55], [x + 50, y + 45]]);
      if (kind === 'symbol') b.symbol(id, [x + 140, y + 15]);
      if (kind === 'label') b.label(id, [x + 140, y + 15], p.name.includes('Регион') ? 'Померания' : 'Образец 65 А');
    }
    if (col) y += kind === 'arrow' ? 150 : 120;
  }
  return b.doc;
}
