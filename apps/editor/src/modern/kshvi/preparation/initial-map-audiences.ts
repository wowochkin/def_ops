import type { MapMarker } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import type { InitialMapAudience } from './InitialMapStep';

/** Проекции выводятся только из реально нанесённых правил видимости, без демонстрационных штабов. */
export function initialMapAudiences(
  markers: readonly Readonly<Pick<MapMarker, 'sideId' | 'visibility'>>[],
): readonly InitialMapAudience[] {
  const byInstance = new Map<string, InitialMapAudience>();
  for (const marker of markers) {
    const visibilitySides = [...new Set((marker.visibility.sideIds ?? []).map(side => side.trim()).filter(Boolean))];
    if (visibilitySides.length > 1) throw new Error(`AMBIGUOUS_AUDIENCE_SIDE: ${marker.sideId}`);
    // Для сообщения о противнике сторона аудитории берётся из разрешения видимости,
    // а не из принадлежности самого наблюдаемого объекта.
    const audienceSide = visibilitySides[0] ?? marker.sideId;
    for (const instanceId of marker.visibility.instanceIds ?? []) {
      const id = instanceId.trim();
      if (!id) continue;
      const existing = byInstance.get(id);
      if (existing && existing.sideId !== audienceSide) throw new Error(`AMBIGUOUS_INSTANCE_SIDE: ${id}`);
      if (!existing) byInstance.set(id, {
        sideId: audienceSide, instanceId: id, role: 'TRAINEE', label: `Штаб ${audienceSide} · ${id}`,
      });
    }
  }
  return [...byInstance.values()].sort((left, right) => left.sideId.localeCompare(right.sideId) || left.instanceId.localeCompare(right.instanceId));
}
