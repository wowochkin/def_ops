export type CameraKeyframe = Readonly<{
  id: string;
  atMs: number;
  center: readonly [number, number];
  zoom: number;
  heading: number;
}>;

export type CameraRoute = Readonly<{ keyframes: readonly CameraKeyframe[] }>;
export type CameraPosition = Readonly<{
  atMs: number;
  center: readonly [number, number];
  zoom: number;
  heading: number;
}>;

export function createCameraRoute(keyframes: readonly CameraKeyframe[]): CameraRoute {
  if (keyframes.length === 0) throw new Error('Маршрут камеры требует хотя бы один ключевой кадр');
  const ids = new Set<string>();
  let previousAt = -1;
  const copy = keyframes.map(frame => {
    if (!frame.id.trim() || ids.has(frame.id)) throw new Error('Идентификаторы кадров камеры должны быть уникальными');
    if (!Number.isFinite(frame.atMs) || frame.atMs < 0 || frame.atMs <= previousAt) {
      throw new Error('Кадры камеры должны следовать в хронологическом порядке');
    }
    if (!frame.center.every(Number.isFinite) || !Number.isFinite(frame.zoom) || frame.zoom <= 0 || !Number.isFinite(frame.heading)) {
      throw new Error(`Некорректный ключевой кадр камеры ${frame.id}`);
    }
    ids.add(frame.id);
    previousAt = frame.atMs;
    return { ...frame, center: [frame.center[0], frame.center[1]] as const };
  });
  return { keyframes: copy };
}

export function cameraAt(route: CameraRoute, atMs: number): CameraPosition {
  const frames = route.keyframes;
  const clamped = Math.max(frames[0].atMs, Math.min(atMs, frames.at(-1)!.atMs));
  const nextIndex = frames.findIndex(frame => frame.atMs >= clamped);
  if (nextIndex <= 0) {
    const frame = frames[nextIndex === -1 ? frames.length - 1 : 0];
    return { atMs: clamped, center: [...frame.center], zoom: frame.zoom, heading: frame.heading };
  }
  const before = frames[nextIndex - 1];
  const after = frames[nextIndex];
  const progress = (clamped - before.atMs) / (after.atMs - before.atMs);
  const mix = (from: number, to: number) => from + (to - from) * progress;
  return {
    atMs: clamped,
    center: [mix(before.center[0], after.center[0]), mix(before.center[1], after.center[1])],
    zoom: mix(before.zoom, after.zoom),
    heading: mix(before.heading, after.heading),
  };
}
