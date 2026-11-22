import { HttpError, reply, type Router } from '@def-ops/service-kit';
import type { EnvironmentSelection } from '../../../../packages/kshvi/src/environment/provider';
import type { CartographyEnvironmentProvider } from '../environment/cartography-provider';
import { assertSnapshotComplete } from '../environment/snapshot-store';

function coordinate(query: URLSearchParams, key: 'lon' | 'lat'): number {
  const raw = query.get(key);
  const value = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  const valid = Number.isFinite(value) && (key === 'lon' ? value >= -180 && value <= 180 : value >= -90 && value <= 90);
  if (!valid) throw new HttpError(422, 'invalid_coordinates', `Укажите корректную координату ${key}`);
  return value;
}

/** Отдельная регистрация: основной app.ts подключает модуль на этапе интеграции. */
export function addEnvironmentRoutes(router: Router, provider: CartographyEnvironmentProvider, prefix = '/kshvi'): Router {
  const base = `${prefix}/environment`;
  router.get(`${base}/atlases`, () => provider.listAtlases());
  router.post(`${base}/snapshots`, async ctx => provider.snapshot(await ctx.json<EnvironmentSelection>()));
  router.get(`${base}/snapshots/:id`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    if (ctx.query.get('requireComplete') === '1') assertSnapshotComplete(snapshot);
    return snapshot;
  });
  router.get(`${base}/snapshots/:id/weather`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    const operationalAt = ctx.query.get('operationalAt');
    if (!operationalAt) throw new HttpError(422, 'operational_time_required', 'Укажите оперативное время погоды');
    return provider.weatherAtOperational(snapshot, {
      lon: coordinate(ctx.query, 'lon'),
      lat: coordinate(ctx.query, 'lat'),
      operationalAt,
    });
  });
  router.get(`${base}/snapshots/:id/resources/glyphs/:fontstack/:range`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    const data = await provider.snapshotResource(snapshot, `glyphs/${ctx.params.fontstack}/${ctx.params.range}`);
    return reply(200, data, { 'content-type': 'application/x-protobuf', 'cache-control': 'private, max-age=31536000, immutable' });
  });
  router.get(`${base}/snapshots/:id/resources/sprites/:name`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    const data = await provider.snapshotResource(snapshot, `sprites/${ctx.params.name}`);
    return reply(200, data, {
      'content-type': ctx.params.name.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });
  for (const kind of ['style', 'elevations'] as const) {
    router.get(`${base}/snapshots/:id/atlas/:atlasId/${kind}`, async ctx => {
      const snapshot = await provider.loadSnapshot(ctx.params.id);
      return provider.snapshotArtifact(snapshot, ctx.params.atlasId, kind);
    });
  }
  router.get(`${base}/snapshots/:id/atlas/:atlasId/tiles/:z/:x/:y`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    const tile = await provider.snapshotTile(snapshot, ctx.params.atlasId, Number(ctx.params.z), Number(ctx.params.x), Number(ctx.params.y));
    if (!tile) return reply(204, null);
    const headers: Record<string, string> = {
      'content-type': tile.format === 'pbf' ? 'application/vnd.mapbox-vector-tile' : `image/${tile.format === 'jpg' ? 'jpeg' : tile.format}`,
      'cache-control': 'private, max-age=31536000, immutable',
    };
    if (tile.format === 'pbf' && tile.bytes[0] === 0x1f && tile.bytes[1] === 0x8b) headers['content-encoding'] = 'gzip';
    return reply(200, tile.bytes, headers);
  });
  router.get(`${base}/snapshots/:id/atlas/:atlasId/export`, async ctx => {
    const snapshot = await provider.loadSnapshot(ctx.params.id);
    const data = await provider.snapshotArtifact(snapshot, ctx.params.atlasId, 'export');
    return reply(200, data, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="atlas.mbtiles"' });
  });
  return router;
}
