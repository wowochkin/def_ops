import { createCameraRoute, type CameraRoute } from './camera-route';
import type { AudienceLayer } from './audience-policy';

export type ExpositionDecision = Readonly<{
  id: string;
  summary: string;
  hiddenRationale?: string;
}>;

export type ExpositionFrame = Readonly<{
  id: string;
  atMs: number;
  title: string;
  caption: string;
  decision?: ExpositionDecision;
}>;

export type ExpositionChapter = Readonly<{
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  frameIds: readonly string[];
  pauseAfterMs: number;
}>;

export type ExpositionCaption = Readonly<{ id: string; atMs: number; text: string }>;
export type ExpositionExplanation = ExpositionCaption & Readonly<{ audience: boolean }>;
export type ExpositionBranch = Readonly<{
  id: string;
  title: string;
  fromCheckpointId: string;
  chapterIds: readonly string[];
}>;
export type PlanFactComparison = Readonly<{ id: string; atMs: number; plan: string; fact: string }>;

export type ExpositionProgram = Readonly<{
  id: string;
  title: string;
  chapters: readonly ExpositionChapter[];
  frames: readonly ExpositionFrame[];
  cameraRoute: CameraRoute;
  layers: readonly AudienceLayer[];
  tempo: number;
  pauseMs: number;
  captions: readonly ExpositionCaption[];
  explanations: readonly ExpositionExplanation[];
  branches: readonly ExpositionBranch[];
  allowedCheckpointIds: readonly string[];
  planFact: readonly PlanFactComparison[];
}>;

const REQUIRED_MAP_LAYERS: readonly AudienceLayer[] = ['weather', 'terrain', 'logistics', 'modern-symbols'];
const idsAreUnique = (ids: readonly string[]) => new Set(ids).size === ids.length;

export function createExpositionProgram(input: ExpositionProgram): ExpositionProgram {
  if (!input.id.trim() || !input.title.trim()) throw new Error('Программе показа нужны идентификатор и название');
  if (!REQUIRED_MAP_LAYERS.every(layer => input.layers.includes(layer))) {
    throw new Error('Программа должна включать слои общей карты: погоду, местность, МТО и современные знаки');
  }
  if (!Number.isFinite(input.tempo) || input.tempo < 0.25 || input.tempo > 8) throw new Error('Темп показа должен быть от 0,25× до 8×');
  if (!Number.isFinite(input.pauseMs) || input.pauseMs < 0) throw new Error('Пауза показа не может быть отрицательной');
  if (input.chapters.length === 0) throw new Error('Программе показа нужна хотя бы одна глава');
  if (!idsAreUnique(input.chapters.map(chapter => chapter.id))) throw new Error('Идентификаторы глав должны быть уникальными');
  let previousStart = -1;
  for (const chapter of input.chapters) {
    if (!Number.isFinite(chapter.startMs) || !Number.isFinite(chapter.endMs) || chapter.startMs < 0 || chapter.endMs <= chapter.startMs) {
      throw new Error(`Некорректный интервал главы ${chapter.id}`);
    }
    if (chapter.startMs < previousStart) throw new Error('Главы должны следовать в хронологическом порядке');
    if (!Number.isFinite(chapter.pauseAfterMs) || chapter.pauseAfterMs < 0) throw new Error(`Некорректная пауза главы ${chapter.id}`);
    previousStart = chapter.startMs;
  }
  if (!idsAreUnique(input.frames.map(frame => frame.id))) throw new Error('Идентификаторы кадров должны быть уникальными');
  if (input.frames.some(frame => !Number.isFinite(frame.atMs) || frame.atMs < 0)) throw new Error('Кадр показа имеет некорректный момент');
  const allowed = new Set(input.allowedCheckpointIds);
  if (input.branches.some(branch => !allowed.has(branch.fromCheckpointId))) throw new Error('Ветвь ссылается на неразрешённую контрольную точку');
  return {
    ...input,
    layers: [...new Set(input.layers)],
    chapters: input.chapters.map(chapter => ({ ...chapter, frameIds: [...chapter.frameIds] })),
    frames: input.frames.map(frame => ({ ...frame, decision: frame.decision ? { ...frame.decision } : undefined })),
    cameraRoute: createCameraRoute(input.cameraRoute.keyframes),
    captions: input.captions.map(caption => ({ ...caption })),
    explanations: input.explanations.map(explanation => ({ ...explanation })),
    branches: input.branches.map(branch => ({ ...branch, chapterIds: [...branch.chapterIds] })),
    allowedCheckpointIds: [...input.allowedCheckpointIds],
    planFact: input.planFact.map(comparison => ({ ...comparison })),
  };
}

export function expositionDuration(program: ExpositionProgram): number {
  return Math.max(0, ...program.chapters.map(chapter => chapter.endMs), ...program.frames.map(frame => frame.atMs));
}
