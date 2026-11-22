import type { WorldState } from '../model/world';
import { reduceWorld, type WorldEvent } from '../events/reducer';
import {
  createExpositionProgram,
  expositionDuration,
  type ExpositionDecision,
  type ExpositionProgram,
  type PlanFactComparison,
} from './exposition-program';

export const EXPOSITION_RNG_VERSION = 'exposition-rng-v1' as const;

export type ExpositionJournalEntry = Readonly<{
  eventId: string;
  sequence: number;
  atMs: number;
  type: string;
  payload?: unknown;
  causeIds?: readonly string[];
}>;

export type ExpositionRngSnapshot = Readonly<{
  version: typeof EXPOSITION_RNG_VERSION;
  seed: number;
  branchId: string;
  cursor: number;
  state: number;
}>;

export type ExpositionCheckpoint = Readonly<{
  id: string;
  atMs: number;
  journalCursor: number;
  scenarioCursor?: number;
  world: WorldState;
  rng?: ExpositionRngSnapshot;
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
  pauseRemainingMs: number;
  endPauseRemainingMs: number;
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
  rng: ExpositionRngSnapshot | null;
  randomOutcomesCreated: number;
  officialAssessmentCreated: false;
  officialAssessments: readonly never[];
  origin: ExpositionOrigin;
  playback: ExpositionPlayback;
  sourceArchive: OfficialExpositionArchive;
}>;

/** Ответ presenter API: официальный источник и его оценки остаются только на сервере. */
export type ExpositionPresenterSession = Omit<ExpositionSession, 'sourceArchive' | 'officialAssessments'>;

export type ExpositionAgentDecision = Readonly<{
  consumptionFactor: number;
  supplyFactor: number;
}>;

export type AutonomousCalculationInput = Readonly<{
  scenario: DemonstrationScenario;
  seed: number;
  branchId: string;
  fromCheckpoint?: ExpositionCheckpoint;
  /** Решения реальных системных агентов, полученные сервером для eventId/agentId. */
  agentDecisions?: Readonly<Record<string, ExpositionAgentDecision>>;
}>;
export type AutonomousCalculationResult = Readonly<{
  world: WorldState;
  journal: readonly ExpositionJournalEntry[];
  checkpoints: readonly ExpositionCheckpoint[];
  rng: ExpositionRngSnapshot;
  randomOutcomesCreated: number;
}>;
export type AutonomousCalculator = (input: AutonomousCalculationInput) => AutonomousCalculationResult;

export type PresenterCommand =
  | Readonly<{ type: 'PLAY' | 'PAUSE' }>
  | Readonly<{ type: 'SET_TEMPO'; tempo: number }>
  | Readonly<{ type: 'SEEK'; atMs: number }>
  | Readonly<{ type: 'ADVANCE'; elapsedMs: number }>
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
  return { status: 'PAUSED', atMs, tempo: program.tempo, chapterId: chapter.id, pauseRemainingMs: 0, endPauseRemainingMs: 0 };
}

function calculationContext(scenario: DemonstrationScenario): ExpositionCalculationContext {
  return {
    scenarioId: scenario.scenarioId,
    catalog: structuredClone(scenario.catalog),
    systemSides: structuredClone(scenario.systemSides),
    rules: structuredClone(scenario.rules),
  };
}

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function initialRng(seed: number, branchId: string, cursor = 0): ExpositionRngSnapshot {
  return { version: EXPOSITION_RNG_VERSION, seed, branchId, cursor, state: hash32(`${EXPOSITION_RNG_VERSION}|${seed}|${branchId}`) };
}

function restoredRng(input: AutonomousCalculationInput): ExpositionRngSnapshot {
  const saved = input.fromCheckpoint?.rng;
  if (input.fromCheckpoint && !saved) throw new Error('Контрольная точка автономного показа не содержит состояние RNG');
  if (saved && saved.version !== EXPOSITION_RNG_VERSION) throw new Error('Неподдерживаемая версия RNG экспозиции');
  if (!saved) return initialRng(input.seed, input.branchId);
  return {
    version: EXPOSITION_RNG_VERSION,
    seed: input.seed,
    branchId: input.branchId,
    cursor: input.seed === saved.seed ? saved.cursor : 0,
    state: input.seed === saved.seed && input.branchId === saved.branchId
      ? saved.state
      : initialRng(input.seed, input.branchId).state,
  };
}

function nextRandom(snapshot: ExpositionRngSnapshot, streamId: string): Readonly<{ value: number; snapshot: ExpositionRngSnapshot }> {
  const cursor = snapshot.cursor + 1;
  const state = hash32(`${EXPOSITION_RNG_VERSION}|${snapshot.seed}|${snapshot.branchId}|${streamId}|${cursor}`);
  return { value: state / 4294967296, snapshot: { ...snapshot, cursor, state } };
}

function decisionKey(eventId: string, agentId: string): string {
  return `${eventId}:${agentId}`;
}

export const calculatePreparedScenario: AutonomousCalculator = input => {
  const { scenario, fromCheckpoint } = input;
  if (scenario.rules.reducerVersion !== 1 || !scenario.rules.profileVersion.startsWith('full-simulation')) {
    throw new Error('Демонстрационный сценарий должен использовать принятый full-simulation');
  }
  if (scenario.systemSides.length === 0) throw new Error('Для автономного показа нужны разрешённые системные агенты сторон');
  validateSeed(input.seed);
  let world = structuredClone(fromCheckpoint?.world ?? scenario.initialWorld);
  const startCursor = fromCheckpoint?.scenarioCursor ?? fromCheckpoint?.journalCursor ?? 0;
  let sequence = fromCheckpoint?.journalCursor ?? 0;
  let rng = restoredRng(input);
  let randomOutcomesCreated = 0;
  const random = (streamId: string): number => {
    const next = nextRandom(rng, streamId);
    rng = next.snapshot;
    randomOutcomesCreated += 1;
    return next.value;
  };
  const journal: ExpositionJournalEntry[] = [];
  const checkpoints: ExpositionCheckpoint[] = [];
  scenario.events.slice(startCursor).forEach((event, offset) => {
    const scenarioCursor = startCursor + offset + 1;
    if (!Number.isFinite(event.atMs) || event.atMs < (fromCheckpoint?.atMs ?? 0)) {
      throw new Error('Демонстрационные события должны следовать после контрольной точки');
    }
    const payload = event.payload as { amount?: unknown; supplied?: unknown };
    if (typeof payload?.amount !== 'number' || !Number.isSafeInteger(payload.amount) || payload.amount <= 0) {
      throw new Error('Плановое событие полного расчёта должно содержать положительный расход ресурса');
    }
    const baseSupplied = typeof payload.supplied === 'number' ? payload.supplied : 0;
    const factors = scenario.systemSides.map(side => {
      const decision = input.agentDecisions?.[decisionKey(event.eventId, side.agentId)] ?? { consumptionFactor: 1, supplyFactor: 1 };
      if (!Number.isFinite(decision.consumptionFactor) || decision.consumptionFactor <= 0
        || !Number.isFinite(decision.supplyFactor) || decision.supplyFactor < 0) {
        throw new Error(`Системный агент ${side.agentId} вернул некорректное решение`);
      }
      return {
        consumption: decision.consumptionFactor * (0.75 + random(`consumption|${event.eventId}|${side.agentId}`) * 0.5),
        supply: decision.supplyFactor * (0.75 + random(`supply|${event.eventId}|${side.agentId}`) * 0.5),
      };
    });
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const amount = Math.max(1, Math.round(payload.amount * average(factors.map(item => item.consumption))));
    const supplied = Math.max(0, Math.round(baseSupplied * average(factors.map(item => item.supply))));
    const calculatedEvent: DemonstrationEvent = {
      ...event,
      payload: { ...(typeof event.payload === 'object' && event.payload ? event.payload : {}), amount, supplied },
      causeIds: [...(event.causeIds ?? []), ...scenario.systemSides.map(side => `agent:${side.agentId}@${side.profileVersion}`)],
    };
    world = reduceWorld(world, calculatedEvent, { reducerVersion: scenario.rules.reducerVersion });
    sequence += 1;
    journal.push({
      eventId: calculatedEvent.eventId,
      sequence,
      atMs: calculatedEvent.atMs,
      type: calculatedEvent.type,
      payload: structuredClone(calculatedEvent.payload),
      causeIds: calculatedEvent.causeIds ? [...calculatedEvent.causeIds] : undefined,
    });
    if (event.checkpointId) {
      checkpoints.push({
        id: event.checkpointId,
        atMs: event.atMs,
        journalCursor: sequence,
        scenarioCursor,
        world: structuredClone(world),
        rng: structuredClone(rng),
      });
    }
  });
  return { world, journal, checkpoints, rng, randomOutcomesCreated };
};

export function worldAtExposition(
  initialWorld: WorldState,
  journal: readonly ExpositionJournalEntry[],
  atMs: number,
  reducerVersion = 1,
): WorldState {
  return journal
    .filter(entry => entry.atMs <= atMs)
    .sort((left, right) => left.sequence - right.sequence)
    .reduce((world, entry) => reduceWorld(world, {
      eventId: entry.eventId, type: entry.type, payload: structuredClone(entry.payload), causeIds: entry.causeIds,
    }, { reducerVersion }), structuredClone(initialWorld));
}

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
  const playback = initialPlayback(program);
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
    world: worldAtExposition(sourceArchive.demonstration.initialWorld, sourceArchive.journal, playback.atMs, sourceArchive.demonstration.rules.reducerVersion),
    map: structuredClone(sourceArchive.map),
    calculation: null,
    rng: null,
    randomOutcomesCreated: 0,
    officialAssessmentCreated: false,
    officialAssessments: [],
    origin: {
      archiveId: sourceArchive.archiveId,
      branchId: sourceArchive.branchId,
      manifestHash: sourceArchive.manifestHash,
    },
    playback,
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
  const playback = initialPlayback(program);
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
    world: worldAtExposition(sourceArchive.demonstration.initialWorld, result.journal, playback.atMs, sourceArchive.demonstration.rules.reducerVersion),
    map: structuredClone(sourceArchive.map),
    calculation: calculationContext(sourceArchive.demonstration),
    rng: structuredClone(result.rng),
    randomOutcomesCreated: result.randomOutcomesCreated,
    officialAssessmentCreated: false,
    officialAssessments: [],
    origin: {
      archiveId: sourceArchive.archiveId,
      branchId: sourceArchive.branchId,
      manifestHash: sourceArchive.manifestHash,
    },
    playback,
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
  const journal = [...structuredClone(show.journal.slice(0, checkpoint.journalCursor)), ...structuredClone(result.journal)];
  const playback = initialPlayback(program, checkpoint.atMs);
  return {
    ...structuredClone(show),
    sessionId: options.sessionId ?? identifier('exposition-show'),
    branchId,
    program,
    seed,
    journal,
    checkpoints: [
      ...structuredClone(show.checkpoints.filter(item => item.journalCursor <= checkpoint.journalCursor)),
      ...structuredClone(result.checkpoints),
    ],
    world: worldAtExposition(show.sourceArchive.demonstration.initialWorld, journal, playback.atMs, show.sourceArchive.demonstration.rules.reducerVersion),
    rng: structuredClone(result.rng),
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
    playback,
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
    const playback = initialPlayback(show.program);
    return {
      ...structuredClone(show),
      sessionId: options.sessionId ?? identifier('exposition-replay'),
      world: worldAtExposition(show.sourceArchive.demonstration.initialWorld, show.journal, playback.atMs, show.sourceArchive.demonstration.rules.reducerVersion),
      randomOutcomesCreated: 0,
      officialAssessmentCreated: false,
      officialAssessments: [],
      playback,
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

function chapterAt(show: ExpositionSession, atMs: number): ExpositionSession['program']['chapters'][number] {
  return show.program.chapters.find(item => atMs >= item.startMs && atMs < item.endMs)
    ?? (atMs >= expositionDuration(show.program) ? show.program.chapters.at(-1)! : show.program.chapters[0]);
}

function atPlayback(show: ExpositionSession, playback: ExpositionPlayback): ExpositionSession {
  return {
    ...show,
    playback,
    world: worldAtExposition(
      show.sourceArchive.demonstration.initialWorld,
      show.journal,
      playback.atMs,
      show.sourceArchive.demonstration.rules.reducerVersion,
    ),
  };
}

function advance(show: ExpositionSession, elapsedMs: number): ExpositionSession {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Интервал часов показа должен быть неотрицательным');
  if (show.playback.status === 'PAUSED' || elapsedMs === 0) return show;
  let playback = { ...show.playback };
  let wallRemaining = elapsedMs;
  const duration = expositionDuration(show.program);

  if (playback.endPauseRemainingMs > 0) {
    const consumed = Math.min(wallRemaining, playback.endPauseRemainingMs);
    playback.endPauseRemainingMs -= consumed;
    wallRemaining -= consumed;
    if (playback.endPauseRemainingMs === 0) playback.status = 'PAUSED';
    return atPlayback(show, playback);
  }
  if (playback.pauseRemainingMs > 0) {
    const consumed = Math.min(wallRemaining, playback.pauseRemainingMs);
    playback.pauseRemainingMs -= consumed;
    wallRemaining -= consumed;
    if (playback.pauseRemainingMs > 0 || wallRemaining === 0) {
      if (playback.pauseRemainingMs === 0) playback.chapterId = chapterAt(show, playback.atMs).id;
      return atPlayback(show, playback);
    }
    playback.chapterId = chapterAt(show, playback.atMs).id;
  }

  let simulationRemaining = wallRemaining * playback.tempo;
  while (simulationRemaining > 0 && playback.status === 'PLAYING') {
    const chapter = show.program.chapters.find(item => item.id === playback.chapterId) ?? chapterAt(show, playback.atMs);
    const boundary = chapter.endMs;
    const untilBoundary = Math.max(0, boundary - playback.atMs);
    if (playback.atMs >= duration) {
      playback.status = 'PAUSED';
      break;
    }
    if (simulationRemaining < untilBoundary || untilBoundary === 0 && playback.atMs >= duration) {
      playback.atMs = Math.min(duration, playback.atMs + simulationRemaining);
      simulationRemaining = 0;
      playback.chapterId = chapterAt(show, playback.atMs).id;
      break;
    }
    playback.atMs = boundary;
    simulationRemaining = Math.max(0, simulationRemaining - untilBoundary);
    if (boundary >= duration) {
      playback.endPauseRemainingMs = show.program.pauseMs;
      playback.status = show.program.pauseMs > 0 ? 'PLAYING' : 'PAUSED';
      simulationRemaining = 0;
      break;
    }
    playback.pauseRemainingMs = chapter.pauseAfterMs;
    if (chapter.pauseAfterMs > 0) {
      // Пауза главы измеряется по wall clock, а не по ускоренным часам мира.
      const wallLeft = simulationRemaining / playback.tempo;
      const consumed = Math.min(wallLeft, playback.pauseRemainingMs);
      playback.pauseRemainingMs -= consumed;
      simulationRemaining = Math.max(0, (wallLeft - consumed) * playback.tempo);
      if (playback.pauseRemainingMs > 0) {
        simulationRemaining = 0;
        break;
      }
    }
    playback.chapterId = chapterAt(show, playback.atMs).id;
  }
  return atPlayback(show, playback);
}

export function controlExposition(show: ExpositionSession, command: PresenterCommand): ExpositionSession {
  if (command.type === 'ADVANCE') return advance(show, command.elapsedMs);
  const playback = { ...show.playback };
  if (command.type === 'PLAY') {
    if (playback.atMs >= expositionDuration(show.program) && playback.endPauseRemainingMs === 0) {
      playback.atMs = 0;
      playback.chapterId = show.program.chapters[0].id;
    }
    playback.status = 'PLAYING';
  }
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
    playback.pauseRemainingMs = 0;
    playback.endPauseRemainingMs = 0;
  }
  if (command.type === 'SEEK') {
    if (!Number.isFinite(command.atMs)) throw new Error('Некорректный момент показа');
    playback.atMs = Math.max(0, Math.min(command.atMs, expositionDuration(show.program)));
    playback.chapterId = chapterAt(show, playback.atMs).id;
    playback.pauseRemainingMs = 0;
    playback.endPauseRemainingMs = 0;
  }
  return atPlayback(show, playback);
}

export function planFactAt(show: Pick<ExpositionSession, 'program'>, atMs: number): PlanFactComparison | null {
  const comparison = show.program.planFact.filter(item => item.atMs <= atMs).at(-1);
  return comparison ? { ...comparison } : null;
}

export function decisionAt(show: Pick<ExpositionSession, 'program'>, decisionId: string): (ExpositionDecision & Readonly<{ frameId: string; atMs: number }>) | null {
  const frame = show.program.frames.find(item => item.decision?.id === decisionId);
  return frame?.decision ? { ...frame.decision, frameId: frame.id, atMs: frame.atMs } : null;
}
