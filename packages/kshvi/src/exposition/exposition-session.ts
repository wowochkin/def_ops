import type { WorldState } from '../model/world';
import { reduceWorld, type WorldEvent } from '../events/reducer';
import {
  createExpositionProgram,
  expositionDuration,
  type ExpositionDecision,
  type ExpositionProgram,
  type PlanFactComparison,
} from './exposition-program';

export type ExpositionJournalEntry = Readonly<{
  eventId: string;
  sequence: number;
  atMs: number;
  type: string;
  payload?: unknown;
  causeIds?: readonly string[];
}>;

export type ExpositionCheckpoint = Readonly<{
  id: string;
  atMs: number;
  journalCursor: number;
  world: WorldState;
}>;

export type DemonstrationEvent = WorldEvent & Readonly<{ atMs: number; checkpointId?: string }>;
export type DemonstrationScenario = Readonly<{
  scenarioId: string;
  initialWorld: WorldState;
  catalog: Readonly<{ id: string; version: string }>;
  systemSides: readonly Readonly<{ sideId: string; agentId: string; profileVersion: string }>[];
  rules: Readonly<{ reducerVersion: number; profileVersion: string }>;
  events: readonly DemonstrationEvent[];
}>;

export type OfficialExpositionArchive = Readonly<{
  archiveId: string;
  branchId: string;
  manifestHash: string;
  journal: readonly ExpositionJournalEntry[];
  checkpoints: readonly ExpositionCheckpoint[];
  officialAssessments: readonly unknown[];
  map: Readonly<Record<string, unknown>>;
  demonstration: DemonstrationScenario;
}>;

export type ExpositionOrigin = Readonly<{
  archiveId: string;
  branchId: string;
  manifestHash: string;
  parentBranchId?: string;
  checkpointId?: string;
}>;

export type ExpositionPlayback = Readonly<{
  status: 'PAUSED' | 'PLAYING';
  atMs: number;
  tempo: number;
  chapterId: string;
}>;

export type ExpositionCalculationContext = Readonly<{
  scenarioId: string;
  catalog: DemonstrationScenario['catalog'];
  systemSides: DemonstrationScenario['systemSides'];
  rules: DemonstrationScenario['rules'];
}>;

export type ExpositionSession = Readonly<{
  sessionId: string;
  branchId: string;
  purpose: 'EXPOSITION';
  label: 'Экспозиция';
  source: 'ARCHIVE' | 'AUTONOMOUS';
  program: ExpositionProgram;
  seed: number | null;
  journal: readonly ExpositionJournalEntry[];
  checkpoints: readonly ExpositionCheckpoint[];
  world: WorldState;
  map: Readonly<Record<string, unknown>>;
  calculation: ExpositionCalculationContext | null;
  randomOutcomesCreated: number;
  officialAssessmentCreated: false;
  officialAssessments: readonly never[];
  origin: ExpositionOrigin;
  playback: ExpositionPlayback;
  sourceArchive: OfficialExpositionArchive;
}>;

export type AutonomousCalculationInput = Readonly<{
  scenario: DemonstrationScenario;
  seed: number;
  branchId: string;
  fromCheckpoint?: ExpositionCheckpoint;
}>;
export type AutonomousCalculationResult = Readonly<{
  world: WorldState;
  journal: readonly ExpositionJournalEntry[];
  checkpoints: readonly ExpositionCheckpoint[];
  randomOutcomesCreated: number;
}>;
export type AutonomousCalculator = (input: AutonomousCalculationInput) => AutonomousCalculationResult;

export type PresenterCommand =
  | Readonly<{ type: 'PLAY' | 'PAUSE' }>
  | Readonly<{ type: 'SET_TEMPO'; tempo: number }>
  | Readonly<{ type: 'SEEK'; atMs: number }>
  | Readonly<{ type: 'SEEK_CHAPTER'; chapterId: string }>;

function identifier(kind: string): string {
  return `${kind}-${globalThis.crypto.randomUUID()}`;
}

function validateSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Зерно показа должно быть неотрицательным целым');
}

function validateArchive(archive: OfficialExpositionArchive): void {
  if (!archive.archiveId.trim() || !archive.branchId.trim() || !/^[0-9a-f]{64}$/.test(archive.manifestHash)) {
    throw new Error('Официальный архив имеет некорректную идентификацию или хеш');
  }
}

function validateBranch(branchId: string, sourceBranchId: string): void {
  if (!branchId.trim() || branchId === sourceBranchId || branchId.startsWith('conduct')) {
    throw new Error('Экспозиции требуется отдельная демонстрационная ветвь');
  }
}

function initialPlayback(program: ExpositionProgram, atMs = 0): ExpositionPlayback {
  const chapter = program.chapters.find(item => atMs >= item.startMs && atMs < item.endMs) ?? program.chapters[0];
  return { status: 'PAUSED', atMs, tempo: program.tempo, chapterId: chapter.id };
}

function calculationContext(scenario: DemonstrationScenario): ExpositionCalculationContext {
  return {
    scenarioId: scenario.scenarioId,
    catalog: structuredClone(scenario.catalog),
    systemSides: structuredClone(scenario.systemSides),
    rules: structuredClone(scenario.rules),
  };
}

export const calculatePreparedScenario: AutonomousCalculator = input => {
  const { scenario, fromCheckpoint } = input;
  if (scenario.rules.reducerVersion !== 1 || !scenario.rules.profileVersion.startsWith('full-simulation')) {
    throw new Error('Демонстрационный сценарий должен использовать принятый full-simulation');
  }
  validateSeed(input.seed);
  let world = structuredClone(fromCheckpoint?.world ?? scenario.initialWorld);
  const startCursor = fromCheckpoint?.journalCursor ?? 0;
  const journal: ExpositionJournalEntry[] = [];
  const checkpoints: ExpositionCheckpoint[] = [];
  scenario.events.slice(startCursor).forEach((event, index) => {
    if (!Number.isFinite(event.atMs) || event.atMs < (fromCheckpoint?.atMs ?? 0)) {
      throw new Error('Демонстрационные события должны следовать после контрольной точки');
    }
    world = reduceWorld(world, event, { reducerVersion: scenario.rules.reducerVersion });
    const sequence = startCursor + index + 1;
    journal.push({
      eventId: event.eventId,
      sequence,
      atMs: event.atMs,
      type: event.type,
      payload: structuredClone(event.payload),
      causeIds: event.causeIds ? [...event.causeIds] : undefined,
    });
    if (event.checkpointId) {
      checkpoints.push({ id: event.checkpointId, atMs: event.atMs, journalCursor: sequence, world: structuredClone(world) });
    }
  });
  return { world, journal, checkpoints, randomOutcomesCreated: 0 };
};

type StartArchiveInput = Readonly<{
  sourceArchive: OfficialExpositionArchive;
  program: ExpositionProgram;
  sessionId?: string;
  branchId?: string;
}>;

export function startArchiveShow(input: StartArchiveInput): ExpositionSession {
  validateArchive(input.sourceArchive);
  const sourceArchive = structuredClone(input.sourceArchive);
  const branchId = input.branchId ?? identifier('exposition-archive');
  validateBranch(branchId, sourceArchive.branchId);
  const program = createExpositionProgram(input.program);
  return {
    sessionId: input.sessionId ?? identifier('exposition-show'),
    branchId,
    purpose: 'EXPOSITION',
    label: 'Экспозиция',
    source: 'ARCHIVE',
    program,
    seed: null,
    journal: structuredClone(sourceArchive.journal),
    checkpoints: structuredClone(sourceArchive.checkpoints),
    world: structuredClone(sourceArchive.checkpoints.at(-1)?.world ?? sourceArchive.demonstration.initialWorld),
    map: structuredClone(sourceArchive.map),
    calculation: null,
    randomOutcomesCreated: 0,
    officialAssessmentCreated: false,
    officialAssessments: [],
    origin: {
      archiveId: sourceArchive.archiveId,
      branchId: sourceArchive.branchId,
      manifestHash: sourceArchive.manifestHash,
    },
    playback: initialPlayback(program),
    sourceArchive,
  };
}

type StartAutonomousInput = StartArchiveInput & Readonly<{
  seed: number;
  calculate?: AutonomousCalculator;
}>;

export function startAutonomousShow(input: StartAutonomousInput): ExpositionSession {
  validateArchive(input.sourceArchive);
  validateSeed(input.seed);
  const sourceArchive = structuredClone(input.sourceArchive);
  const branchId = input.branchId ?? identifier('exposition-autonomous');
  validateBranch(branchId, sourceArchive.branchId);
  const program = createExpositionProgram(input.program);
  const result = (input.calculate ?? calculatePreparedScenario)({
    scenario: sourceArchive.demonstration,
    seed: input.seed,
    branchId,
  });
  return {
    sessionId: input.sessionId ?? identifier('exposition-show'),
    branchId,
    purpose: 'EXPOSITION',
    label: 'Экспозиция',
    source: 'AUTONOMOUS',
    program,
    seed: input.seed,
    journal: structuredClone(result.journal),
    checkpoints: structuredClone(result.checkpoints),
    world: structuredClone(result.world),
    map: structuredClone(sourceArchive.map),
    calculation: calculationContext(sourceArchive.demonstration),
    randomOutcomesCreated: result.randomOutcomesCreated,
    officialAssessmentCreated: false,
    officialAssessments: [],
    origin: {
      archiveId: sourceArchive.archiveId,
      branchId: sourceArchive.branchId,
      manifestHash: sourceArchive.manifestHash,
    },
    playback: initialPlayback(program),
    sourceArchive,
  };
}

export function continueFromCheckpoint(
  show: ExpositionSession,
  checkpointId: string,
  options: Readonly<{ sessionId?: string; branchId?: string; seed?: number; calculate?: AutonomousCalculator }> = {},
): ExpositionSession {
  if (show.source !== 'AUTONOMOUS') throw new Error('Продолжение расчёта доступно только для автономного показа');
  if (!show.program.allowedCheckpointIds.includes(checkpointId)) throw new Error('Контрольная точка не разрешена программой показа');
  const checkpoint = show.checkpoints.find(item => item.id === checkpointId);
  if (!checkpoint) throw new Error('Контрольная точка отсутствует в демонстрационном журнале');
  const branchId = options.branchId ?? identifier('exposition-continuation');
  validateBranch(branchId, show.sourceArchive.branchId);
  if (branchId === show.branchId) throw new Error('Продолжение должно образовать новую ветвь');
  const seed = options.seed ?? show.seed!;
  validateSeed(seed);
  const result = (options.calculate ?? calculatePreparedScenario)({
    scenario: show.sourceArchive.demonstration,
    seed,
    branchId,
    fromCheckpoint: checkpoint,
  });
  const program = createExpositionProgram(show.program);
  return {
    ...structuredClone(show),
    sessionId: options.sessionId ?? identifier('exposition-show'),
    branchId,
    program,
    seed,
    journal: [...structuredClone(show.journal.slice(0, checkpoint.journalCursor)), ...structuredClone(result.journal)],
    checkpoints: [
      ...structuredClone(show.checkpoints.filter(item => item.journalCursor <= checkpoint.journalCursor)),
      ...structuredClone(result.checkpoints),
    ],
    world: structuredClone(result.world),
    randomOutcomesCreated: result.randomOutcomesCreated,
    officialAssessmentCreated: false,
    officialAssessments: [],
    origin: {
      archiveId: show.sourceArchive.archiveId,
      branchId: show.sourceArchive.branchId,
      manifestHash: show.sourceArchive.manifestHash,
      parentBranchId: show.branchId,
      checkpointId,
    },
    playback: initialPlayback(program, checkpoint.atMs),
  };
}

export function restartAutonomousShow(
  show: ExpositionSession,
  options: Readonly<{
    mode: 'REPLAY_SAVED_LINE' | 'NEW_BRANCH';
    sessionId?: string;
    branchId?: string;
    seed?: number;
    calculate?: AutonomousCalculator;
  }>,
): ExpositionSession {
  if (show.source !== 'AUTONOMOUS') throw new Error('Повтор расчёта доступен только для автономного показа');
  if (options.mode === 'REPLAY_SAVED_LINE') {
    return {
      ...structuredClone(show),
      sessionId: options.sessionId ?? identifier('exposition-replay'),
      randomOutcomesCreated: 0,
      officialAssessmentCreated: false,
      officialAssessments: [],
      playback: initialPlayback(show.program),
    };
  }
  const fresh = startAutonomousShow({
    sourceArchive: show.sourceArchive,
    program: show.program,
    seed: options.seed ?? show.seed! + 1,
    sessionId: options.sessionId,
    branchId: options.branchId,
    calculate: options.calculate,
  });
  return { ...fresh, origin: { ...fresh.origin, parentBranchId: show.branchId } };
}

export function controlExposition(show: ExpositionSession, command: PresenterCommand): ExpositionSession {
  const playback = { ...show.playback };
  if (command.type === 'PLAY') playback.status = 'PLAYING';
  if (command.type === 'PAUSE') playback.status = 'PAUSED';
  if (command.type === 'SET_TEMPO') {
    if (!Number.isFinite(command.tempo) || command.tempo < 0.25 || command.tempo > 8) throw new Error('Недопустимый темп показа');
    playback.tempo = command.tempo;
  }
  if (command.type === 'SEEK_CHAPTER') {
    const chapter = show.program.chapters.find(item => item.id === command.chapterId);
    if (!chapter) throw new Error('Глава показа не найдена');
    playback.atMs = chapter.startMs;
    playback.chapterId = chapter.id;
  }
  if (command.type === 'SEEK') {
    if (!Number.isFinite(command.atMs)) throw new Error('Некорректный момент показа');
    playback.atMs = Math.max(0, Math.min(command.atMs, expositionDuration(show.program)));
    const chapter = show.program.chapters.find(item => playback.atMs >= item.startMs && playback.atMs < item.endMs)
      ?? show.program.chapters.at(-1)!;
    playback.chapterId = chapter.id;
  }
  return { ...show, playback };
}

export function planFactAt(show: ExpositionSession, atMs: number): PlanFactComparison | null {
  const comparison = show.program.planFact.filter(item => item.atMs <= atMs).at(-1);
  return comparison ? { ...comparison } : null;
}

export function decisionAt(show: ExpositionSession, decisionId: string): (ExpositionDecision & Readonly<{ frameId: string; atMs: number }>) | null {
  const frame = show.program.frames.find(item => item.decision?.id === decisionId);
  return frame?.decision ? { ...frame.decision, frameId: frame.id, atMs: frame.atMs } : null;
}
