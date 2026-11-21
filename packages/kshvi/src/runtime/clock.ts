export type OperationalClock = {
  anchorOperational: string;
  anchorWall: string;
  speed: number;
  paused: boolean;
};

export function operationalAt(clock: OperationalClock, wallAt: string): string {
  const operationalAnchor = Date.parse(clock.anchorOperational);
  const wallAnchor = Date.parse(clock.anchorWall);
  const wall = Date.parse(wallAt);
  if (![operationalAnchor, wallAnchor, wall].every(Number.isFinite)) throw new Error('Некорректное время часов');
  if (wall < wallAnchor) throw new Error('Астрономическое время раньше привязки');
  if (clock.speed <= 0 || !Number.isFinite(clock.speed)) throw new Error('Скорость должна быть положительной');
  const elapsed = clock.paused ? 0 : (wall - wallAnchor) * clock.speed;
  return new Date(operationalAnchor + elapsed).toISOString();
}
