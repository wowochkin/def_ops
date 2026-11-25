import type { DatabaseSync } from 'node:sqlite';
import { tileRange, type BBox } from '@def-ops/core';

export interface AtlasInventoryFrame {
  bounds: BBox;
  minzoom: number;
  maxzoom: number;
}

export interface AtlasTileCount {
  zoom: number;
  present: number;
  expected: number;
}

/** Считает адреса непустых записей MBTiles. Прозрачность и разрешение источника не исследуются. */
export function countAtlasTiles(db: DatabaseSync, frame: AtlasInventoryFrame): AtlasTileCount[] {
  const [west, south, east, north] = frame.bounds;
  const boxes: BBox[] = west <= east ? [frame.bounds] : [[-180, south, east, north], [west, south, 180, north]];
  const ranges = boxes.map(box => tileRange(box, frame.minzoom));
  const spans: {x0: number; x1: number}[] = [];
  for (const {x0, x1} of ranges) {
    const last = spans.at(-1);
    if (last && x0 <= last.x1 + 1) last.x1 = Math.max(last.x1, x1);
    else spans.push({x0, x1});
  }
  const count = db.prepare(`SELECT COUNT(*) AS present FROM (
    SELECT DISTINCT tile_column, tile_row FROM tiles
    WHERE zoom_level = ? AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?
      AND typeof(tile_column) = 'integer' AND typeof(tile_row) = 'integer' AND length(tile_data) > 0
  )`);
  const {y0, y1} = ranges[0];
  const levels: AtlasTileCount[] = [];
  for (let zoom = frame.minzoom; zoom <= frame.maxzoom; zoom++) {
    const scale = 2 ** (zoom - frame.minzoom);
    const grid = 2 ** zoom;
    const rowMin = grid - (y1 + 1) * scale;
    const rowMax = grid - y0 * scale - 1;
    let expected = 0;
    let present = 0;
    for (const {x0, x1} of spans) {
      const left = x0 * scale;
      const right = (x1 + 1) * scale - 1;
      expected += (right - left + 1) * (rowMax - rowMin + 1);
      present += Number(count.get(zoom, left, right, rowMin, rowMax)!.present);
    }
    levels.push({zoom, expected, present});
  }
  return levels;
}
