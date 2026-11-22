import type { AudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import { createExpositionProgram, type ExpositionProgram } from '../../../../packages/kshvi/src/exposition/exposition-program';
import {
  continueFromCheckpoint,
  controlExposition,
  restartAutonomousShow,
  startArchiveShow,
  startAutonomousShow,
  type ExpositionPresenterSession,
  type ExpositionSession,
  type OfficialExpositionArchive,
  type PresenterCommand,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import { exportExpositionArchive, type DerivedExpositionArchive } from './exposition-export';
import {
  projectExpositionForAudience,
  publicMapValue,
  type AudienceProjection,
  type ProjectorProfile,
} from './exposition-projection';
import type { AsyncAutonomousCalculator } from './system-agent-calculator';

export class ExpositionSessionNotFoundError extends Error {}
export class ExpositionProjectorDeniedError extends Error {}

function presenterView(session: ExpositionSession): ExpositionPresenterSession {
  const { sourceArchive: _sourceArchive, officialAssessments: _officialAssessments, ...view } = session;
  return {
    ...structuredClone(view),
    world: { ...structuredClone(session.world), resources: structuredClone(session.world.state.Resources) },
    checkpoints: session.checkpoints.map(checkpoint => ({
      ...structuredClone(checkpoint),
      world: { ...structuredClone(checkpoint.world), resources: structuredClone(checkpoint.world.state.Resources) },
    })),
    map: Object.fromEntries(['weather', 'terrain', 'logistics', 'modernSymbols', 'forces', 'routes']
      .filter(key => session.map[key] !== undefined)
      .map(key => [key, publicMapValue(session.map[key])])),
  };
}

export class ExpositionSessionService {
  private readonly sessions = new Map<string, ExpositionSession>();
  private readonly sourceArchive: OfficialExpositionArchive;
  private readonly program: ExpositionProgram;
  private readonly policy: AudiencePolicy;
  private readonly projectors: ReadonlyMap<string, ProjectorProfile>;

  constructor(private readonly options: Readonly<{
    sourceArchive: OfficialExpositionArchive;
    program: ExpositionProgram;
    calculator: AsyncAutonomousCalculator;
    policy: AudiencePolicy;
    projectors: readonly ProjectorProfile[];
  }>) {
    this.sourceArchive = structuredClone(options.sourceArchive);
    this.program = createExpositionProgram(options.program);
    this.policy = options.policy;
    this.projectors = new Map(options.projectors.map(projector => [projector.id, projector]));
  }

  private get(sessionId: string): ExpositionSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ExpositionSessionNotFoundError('Экспозиционный сеанс не найден');
    return session;
  }

  private save(session: ExpositionSession): ExpositionPresenterSession {
    if (session.purpose !== 'EXPOSITION' || session.officialAssessmentCreated || session.officialAssessments.length > 0) {
      throw new Error('Сервер отклонил смешение экспозиции с официальной оценкой');
    }
    this.sessions.set(session.sessionId, session);
    return presenterView(session);
  }

  async start(input: Readonly<{
    source: 'ARCHIVE' | 'AUTONOMOUS';
    seed?: number;
    sessionId?: string;
    branchId?: string;
  }>): Promise<ExpositionPresenterSession> {
    const branchId = input.branchId ?? `exposition-${input.source.toLowerCase()}-${globalThis.crypto.randomUUID()}`;
    if (input.source === 'ARCHIVE') {
      return this.save(startArchiveShow({
        sourceArchive: this.sourceArchive, program: this.program,
        sessionId: input.sessionId, branchId,
      }));
    }
    if (input.source !== 'AUTONOMOUS' || input.seed === undefined) throw new Error('Автономному показу требуется seed');
    const result = await this.options.calculator.calculate({
      scenario: this.sourceArchive.demonstration, seed: input.seed, branchId,
    });
    return this.save(startAutonomousShow({
      sourceArchive: this.sourceArchive, program: this.program,
      seed: input.seed, sessionId: input.sessionId, branchId,
      calculate: () => result,
    }));
  }

  presenter(sessionId: string): ExpositionPresenterSession {
    return presenterView(this.get(sessionId));
  }

  command(sessionId: string, command: PresenterCommand): ExpositionPresenterSession {
    return this.save(controlExposition(this.get(sessionId), command));
  }

  async continueFromCheckpoint(sessionId: string, checkpointId: string, input: Readonly<{
    sessionId?: string;
    branchId?: string;
    seed?: number;
  }>): Promise<ExpositionPresenterSession> {
    const session = this.get(sessionId);
    const checkpoint = session.checkpoints.find(item => item.id === checkpointId);
    if (!checkpoint) throw new Error('Контрольная точка отсутствует в демонстрационном журнале');
    const branchId = input.branchId ?? `exposition-continuation-${globalThis.crypto.randomUUID()}`;
    const seed = input.seed ?? session.seed;
    if (seed === null) throw new Error('Архивный показ нельзя продолжить автономным расчётом');
    const result = await this.options.calculator.calculate({
      scenario: session.sourceArchive.demonstration, seed, branchId, fromCheckpoint: checkpoint,
    });
    return this.save(continueFromCheckpoint(session, checkpointId, {
      sessionId: input.sessionId, branchId, seed, calculate: () => result,
    }));
  }

  async restart(sessionId: string, input: Readonly<{
    mode: 'REPLAY_SAVED_LINE' | 'NEW_BRANCH';
    sessionId?: string;
    branchId?: string;
    seed?: number;
  }>): Promise<ExpositionPresenterSession> {
    const session = this.get(sessionId);
    if (input.mode === 'REPLAY_SAVED_LINE') {
      return this.save(restartAutonomousShow(session, { mode: input.mode, sessionId: input.sessionId }));
    }
    const branchId = input.branchId ?? `exposition-branch-${globalThis.crypto.randomUUID()}`;
    const seed = input.seed ?? (session.seed === null ? undefined : session.seed + 1);
    if (seed === undefined) throw new Error('Для новой автономной ветви требуется seed');
    const result = await this.options.calculator.calculate({
      scenario: session.sourceArchive.demonstration, seed, branchId,
    });
    return this.save(restartAutonomousShow(session, {
      mode: 'NEW_BRANCH', sessionId: input.sessionId, branchId, seed, calculate: () => result,
    }));
  }

  updateProgram(sessionId: string, input: ExpositionProgram): ExpositionPresenterSession {
    const session = this.get(sessionId);
    const program = createExpositionProgram(input);
    const checkpointIds = new Set(session.checkpoints.map(checkpoint => checkpoint.id));
    if (session.source === 'AUTONOMOUS' && program.allowedCheckpointIds.some(id => !checkpointIds.has(id))) {
      throw new Error('Программа ссылается на отсутствующую контрольную точку');
    }
    const chapterIds = new Set(program.chapters.map(chapter => chapter.id));
    if (program.branches.some(branch => branch.chapterIds.some(id => !chapterIds.has(id)))) {
      throw new Error('Ветвь программы ссылается на отсутствующую главу');
    }
    const updated = {
      ...session,
      program,
      playback: { ...session.playback, tempo: program.tempo },
    };
    return this.save(controlExposition(updated, { type: 'SEEK', atMs: session.playback.atMs }));
  }

  projector(sessionId: string, projectorId: string): AudienceProjection {
    const projector = this.projectors.get(projectorId);
    if (!projector) throw new ExpositionProjectorDeniedError('Проекторный профиль не разрешён серверной политикой');
    return projectExpositionForAudience({ session: this.get(sessionId), policy: this.policy, projector });
  }

  exportArchive(sessionId: string, archiveId?: string): DerivedExpositionArchive {
    return exportExpositionArchive({ session: this.get(sessionId), policy: this.policy, archiveId });
  }
}
