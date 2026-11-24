import type { ReplayArchive, ReplayClock } from './types';

export function replayClockAt(archive: ReplayArchive, cursor: number, playbackSpeed = 1, branchId = archive.branchId): ReplayClock {
  if (!Number.isFinite(playbackSpeed) || playbackSpeed <= 0) throw new Error('Скорость просмотра должна быть положительной');
  const snapshot = archive.snapshots
    .filter(candidate => candidate.branchId === branchId && candidate.sequence <= cursor)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const event = archive.events
    .filter(candidate => candidate.branchId === branchId && candidate.sequence <= cursor)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const point = event && (!snapshot || event.sequence >= snapshot.sequence) ? event : snapshot;
  if (!point) throw new Error(`Для курсора реплея нет шкалы времени ветви ${branchId}`);
  return {
    operationalAt: point.operationalAt,
    wallClockAt: point.wallClockAt,
    playbackSpeed,
  };
}
