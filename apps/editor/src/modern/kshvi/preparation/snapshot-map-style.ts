import type { StyleSpecification } from 'maplibre-gl';

export function mergeSnapshotStyles(styles: readonly StyleSpecification[]): StyleSpecification {
  const background = styles.flatMap(style => style.layers).find(layer => layer.type === 'background');
  const result: StyleSpecification = {
    version: 8, sources: {}, layers: [background ? structuredClone(background)
      : { id: 'background', type: 'background', paint: { 'background-color': '#ede8d8' } }],
  };
  for (const [index, style] of styles.entries()) {
    const prefix = `snapshot-${index}-`;
    if (style.glyphs) {
      if (result.glyphs && result.glyphs !== style.glyphs) throw new Error('Наборы используют несовместимые источники шрифтов.');
      result.glyphs = style.glyphs;
    }
    if (style.sprite) {
      if (!result.sprite) result.sprite = structuredClone(style.sprite);
      else if (JSON.stringify(result.sprite) !== JSON.stringify(style.sprite)) {
        const entries = [result.sprite, style.sprite].flatMap(value => typeof value === 'string' ? [{ id: 'default', url: value }] : value);
        const sprites = new Map<string, string>();
        for (const { id, url } of entries) {
          if (sprites.has(id) && sprites.get(id) !== url) throw new Error(`Наборы используют несовместимые спрайты с именем «${id}».`);
          sprites.set(id, url);
        }
        result.sprite = Array.from(sprites, ([id, url]) => ({ id, url }));
      }
    }
    for (const [id, source] of Object.entries(style.sources)) result.sources[prefix + id] = structuredClone(source);
    if (style.terrain) {
      if (result.terrain) throw new Error('Одновременно доступен только один источник трёхмерного рельефа.');
      if (style.sources[style.terrain.source]?.type !== 'raster-dem') throw new Error('Источник трёхмерного рельефа отсутствует.');
      result.terrain = { ...style.terrain, source: prefix + style.terrain.source };
    }
    for (const layer of style.layers) {
      if (layer.type === 'background') continue;
      const copy = structuredClone(layer);
      copy.id = prefix + copy.id;
      if ('source' in copy && typeof copy.source === 'string') {
        if (!Object.hasOwn(style.sources, copy.source)) throw new Error(`В слое «${layer.id}» отсутствует источник «${copy.source}».`);
        copy.source = prefix + copy.source;
      }
      result.layers.push(copy);
    }
  }
  return result;
}

export async function loadEnvironmentStyles<T extends { id: string; name: string; kind: 'vector' | 'raster' | 'terrain'; source?: string }>(
  atlases: readonly T[], load: (id: string) => Promise<StyleSpecification>,
): Promise<StyleSpecification> {
  const priority = { raster: 0, terrain: 1, vector: 2 };
  const styles = await Promise.all([...atlases].sort((a, b) => priority[a.kind] - priority[b.kind]).map(async atlas => {
    try {
      const style = structuredClone(await load(atlas.id));
      if (!style || style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error('Некорректный стиль');
      if (/worldcover|покров/i.test(`${atlas.name} ${atlas.source ?? ''}`)) {
        for (const layer of style.layers) {
          if (layer.type === 'raster') layer.paint = { 'raster-opacity': 0.6, ...layer.paint };
        }
      }
      return style;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'стиль недоступен';
      throw new Error(`«${atlas.name}»: ${message}. Снимите флажок набора или выберите замену.`);
    }
  }));
  return mergeSnapshotStyles(styles);
}
