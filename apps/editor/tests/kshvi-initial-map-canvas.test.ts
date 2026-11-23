import { expect, it } from 'vitest';
import { snapshotStyleUrls } from '../src/modern/kshvi/preparation/InitialMapCanvas';

it('адресует ресурсы зафиксированной карты через шлюз без обращения к соседнему живому атласу', () => {
  expect(snapshotStyleUrls({
    sources: { atlas: { tiles: ['/kshvi/environment/snapshots/snapshot/atlas/a1/tiles/{z}/{x}/{y}'] } },
    glyphs: '/kshvi/environment/snapshots/snapshot/resources/glyphs/{fontstack}/{range}.pbf',
    external: 'https://example.invalid/resource',
  })).toEqual({
    sources: { atlas: { tiles: ['/api/kshvi/environment/snapshots/snapshot/atlas/a1/tiles/{z}/{x}/{y}'] } },
    glyphs: '/api/kshvi/environment/snapshots/snapshot/resources/glyphs/{fontstack}/{range}.pbf',
    external: 'https://example.invalid/resource',
  });
});
