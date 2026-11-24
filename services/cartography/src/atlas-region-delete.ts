import type { AtlasStore } from './atlas';
import type { AtlasJobs } from './atlas-jobs';

export type DeleteAtlasItem = Readonly<{ id: string; sha256: string }>;
export type DeleteAtlasRegionResult = Readonly<{
  deleted: string[];
  unchanged: { id: string; reason: string }[];
}>;

export async function deleteAtlasRegion(store: AtlasStore, jobs: AtlasJobs, tenant: string, items: readonly DeleteAtlasItem[]): Promise<DeleteAtlasRegionResult> {
  const deleted: string[] = [], unchanged: { id: string; reason: string }[] = [];
  for (const item of items) {
    const current = await store.get(tenant, item.id).catch(() => null);
    if (!current) continue;
    if (current.sha256 !== item.sha256) { unchanged.push({ id: item.id, reason: 'Содержимое изменилось' }); continue; }
    if (await jobs.hasRunningForMap(tenant, item.id)) { unchanged.push({ id: item.id, reason: 'Идёт подготовка набора' }); continue; }
    await jobs.removeTileCache(tenant, item.id);
    await store.remove(tenant, item.id);
    deleted.push(item.id);
  }
  return { deleted, unchanged };
}
