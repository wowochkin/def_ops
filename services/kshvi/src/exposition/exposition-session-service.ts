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
  type PresenterCommand,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import { exportExpositionArchive, type DerivedExpositionArchive } from './exposition-export';
import {
  projectAudienceMap,
  projectExpositionForAudience,
  type AudienceProjection,
  type ProjectorProfile,
} from './exposition-projection';
import type { AsyncAutonomousCalculator } from './system-agent-calculator';
import type { ExpositionRepository, ExpositionSessionRecord } from './exposition-repository';
import { ExpositionSessionConflictError } from './exposition-repository';

export class ExpositionSessionNotFoundError extends Error {}
export class ExpositionProjectorDeniedError extends Error {}
export type ExpositionActor = Readonly<{ organizationId: string; userId: string }>;

const PUBLIC_MAP_LAYERS = ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'] as const;

function presenterView(session: ExpositionSession): ExpositionPresenterSession {
  const { sourceArchive: _sourceArchive, officialAssessments: _officialAssessments, ...view } = session;
  return {
    ...structuredClone(view),
    world: { ...structuredClone(session.world), resources: structuredClone(session.world.state.Resources) },
    checkpoints: session.checkpoints.map(checkpoint => ({
      ...structuredClone(checkpoint),
      world: { ...structuredClone(checkpoint.world), resources: structuredClone(checkpoint.world.state.Resources) },
    })),
    map: projectAudienceMap(session.map, PUBLIC_MAP_LAYERS),
  };
}

export class ExpositionSessionService {
  private readonly policy: AudiencePolicy;
  private readonly projectors: ReadonlyMap<string, ProjectorProfile>;

  constructor(private readonly options: Readonly<{
    repository: ExpositionRepository;
    calculator: AsyncAutonomousCalculator;
    policy: AudiencePolicy;
    projectors: readonly ProjectorProfile[];
  }>) {
    this.policy = options.policy;
    this.projectors = new Map(options.projectors.map(projector => [projector.id, projector]));
  }

  private async get(sessionId: string, actor: ExpositionActor): Promise<ExpositionSessionRecord> {
    const record = await this.options.repository.getSession(sessionId);
    if (!record || record.organizationId !== actor.organizationId) throw new ExpositionSessionNotFoundError('Экспозиционный сеанс не найден');
    return record;
  }

  private async assertNewId(sessionId?: string): Promise<void> {
    if (sessionId && await this.options.repository.getSession(sessionId)) {
      throw new ExpositionSessionConflictError('Такой sessionId уже существует');
    }
  }

  private assertExposition(session: ExpositionSession): void {
    if (session.purpose !== 'EXPOSITION' || session.officialAssessmentCreated || session.officialAssessments.length > 0) {
      throw new Error('Сервер отклонил смешение экспозиции с официальной оценкой');
    }
  }

  private async saveNew(session: ExpositionSession, actor: ExpositionActor): Promise<ExpositionPresenterSession> {
    this.assertExposition(session);
    await this.options.repository.createSession({ session, organizationId: actor.organizationId, ownerId: actor.userId });
    await this.options.repository.publishHandoff(actor.organizationId, session);
    return presenterView(session);
  }

  private async saveExisting(session: ExpositionSession, actor: ExpositionActor): Promise<ExpositionPresenterSession> {
    this.assertExposition(session);
    await this.options.repository.updateSession({ session, organizationId: actor.organizationId, ownerId: actor.userId });
    return presenterView(session);
  }

  async start(actor: ExpositionActor, input: Readonly<{
    source: 'ARCHIVE' | 'AUTONOMOUS';
    seed?: number;
    sessionId?: string;
    branchId?: string;
  }>): Promise<ExpositionPresenterSession> {
    await this.assertNewId(input.sessionId);
    const [sourceArchive, program] = await Promise.all([
      this.options.repository.officialArchive(), this.options.repository.expositionProgram(),
    ]);
    const branchId = input.branchId ?? `exposition-${input.source.toLowerCase()}-${globalThis.crypto.randomUUID()}`;
    if (input.source === 'ARCHIVE') {
      return this.saveNew(startArchiveShow({ sourceArchive, program, sessionId: input.sessionId, branchId }), actor);
    }
    if (input.source !== 'AUTONOMOUS' || input.seed === undefined) throw new Error('Автономному показу требуется seed');
    const result = await this.options.calculator.calculate({ scenario: sourceArchive.demonstration, seed: input.seed, branchId });
    return this.saveNew(startAutonomousShow({
      sourceArchive, program, seed: input.seed, sessionId: input.sessionId, branchId, calculate: () => result,
    }), actor);
  }

  async presenter(actor: ExpositionActor, sessionId: string): Promise<ExpositionPresenterSession> {
    return presenterView((await this.get(sessionId, actor)).session);
  }

  async command(actor: ExpositionActor, sessionId: string, command: PresenterCommand): Promise<ExpositionPresenterSession> {
    const session = (await this.get(sessionId, actor)).session;
    return this.saveExisting(controlExposition(session, command), actor);
  }

  async continueFromCheckpoint(actor: ExpositionActor, sessionId: string, checkpointId: string, input: Readonly<{
    sessionId?: string;
    branchId?: string;
    seed?: number;
  }>): Promise<ExpositionPresenterSession> {
    await this.assertNewId(input.sessionId);
    const session = (await this.get(sessionId, actor)).session;
    const checkpoint = session.checkpoints.find(item => item.id === checkpointId);
    if (!checkpoint) throw new Error('Контрольная точка отсутствует в демонстрационном журнале');
    const branchId = input.branchId ?? `exposition-continuation-${globalThis.crypto.randomUUID()}`;
    const seed = input.seed ?? session.seed;
    if (seed === null) throw new Error('Архивный показ нельзя продолжить автономным расчётом');
    const result = await this.options.calculator.calculate({
      scenario: session.sourceArchive.demonstration, seed, branchId, fromCheckpoint: checkpoint,
    });
    return this.saveNew(continueFromCheckpoint(session, checkpointId, {
      sessionId: input.sessionId, branchId, seed, calculate: () => result,
    }), actor);
  }

  async restart(actor: ExpositionActor, sessionId: string, input: Readonly<{
    mode: 'REPLAY_SAVED_LINE' | 'NEW_BRANCH';
    sessionId?: string;
    branchId?: string;
    seed?: number;
  }>): Promise<ExpositionPresenterSession> {
    await this.assertNewId(input.sessionId);
    const session = (await this.get(sessionId, actor)).session;
    if (input.mode === 'REPLAY_SAVED_LINE') {
      return this.saveNew(restartAutonomousShow(session, { mode: input.mode, sessionId: input.sessionId }), actor);
    }
    const branchId = input.branchId ?? `exposition-branch-${globalThis.crypto.randomUUID()}`;
    const seed = input.seed ?? (session.seed === null ? undefined : session.seed + 1);
    if (seed === undefined) throw new Error('Для новой автономной ветви требуется seed');
    const result = await this.options.calculator.calculate({ scenario: session.sourceArchive.demonstration, seed, branchId });
    return this.saveNew(restartAutonomousShow(session, {
      mode: 'NEW_BRANCH', sessionId: input.sessionId, branchId, seed, calculate: () => result,
    }), actor);
  }

  private assertPublicContentUnchanged(session: ExpositionSession, program: ExpositionProgram): void {
    for (const caption of program.captions.filter(item => this.policy.publicCaptionIds.includes(item.id))) {
      const previous = session.program.captions.find(item => item.id === caption.id);
      if (!previous || previous.text !== caption.text) throw new Error('Изменение утверждённой публичной подписи требует новой политики аудитории');
    }
    for (const explanation of program.explanations) {
      const approved = this.policy.publicExplanationIds.includes(explanation.id);
      if (explanation.audience && !approved) throw new Error('Нельзя опубликовать пояснение через audience:true без назначения политики');
      if (!approved) continue;
      const previous = session.program.explanations.find(item => item.id === explanation.id);
      if (!previous?.audience || previous.text !== explanation.text || !explanation.audience) {
        throw new Error('Изменение утверждённого публичного пояснения требует новой политики аудитории');
      }
    }
    for (const frame of program.frames) {
      const decision = frame.decision;
      if (!decision || !this.policy.publicDecisionIds.includes(decision.id)) continue;
      const previous = session.program.frames.find(item => item.decision?.id === decision.id)?.decision;
      if (!previous || previous.summary !== decision.summary) throw new Error('Изменение публичного решения требует новой политики аудитории');
    }
  }

  async updateProgram(actor: ExpositionActor, sessionId: string, input: ExpositionProgram): Promise<ExpositionPresenterSession> {
    const session = (await this.get(sessionId, actor)).session;
    const program = createExpositionProgram(input);
    this.assertPublicContentUnchanged(session, program);
    const checkpointIds = new Set(session.checkpoints.map(checkpoint => checkpoint.id));
    if (session.source === 'AUTONOMOUS' && program.allowedCheckpointIds.some(id => !checkpointIds.has(id))) {
      throw new Error('Программа ссылается на отсутствующую контрольную точку');
    }
    const chapterIds = new Set(program.chapters.map(chapter => chapter.id));
    if (program.branches.some(branch => branch.chapterIds.some(id => !chapterIds.has(id)))) {
      throw new Error('Ветвь программы ссылается на отсутствующую главу');
    }
    const updated = { ...session, program, playback: { ...session.playback, tempo: program.tempo } };
    return this.saveExisting(controlExposition(updated, { type: 'SEEK', atMs: session.playback.atMs }), actor);
  }

  private projectorProfile(actor: ExpositionActor): ProjectorProfile {
    const projector = this.projectors.get(actor.userId);
    if (!projector) throw new ExpositionProjectorDeniedError('Проекторный профиль не разрешён серверной политикой');
    return projector;
  }

  async projector(actor: ExpositionActor, sessionId: string): Promise<AudienceProjection> {
    const session = (await this.get(sessionId, actor)).session;
    const active = await this.options.repository.activeHandoff(actor.organizationId);
    return projectExpositionForAudience({
      session,
      policy: this.policy,
      projector: this.projectorProfile(actor),
      handoffGeneration: active?.sessionId === sessionId ? active.generation : 0,
    });
  }

  async presenterProjection(actor: ExpositionActor, sessionId: string): Promise<AudienceProjection> {
    const session = (await this.get(sessionId, actor)).session;
    const active = await this.options.repository.activeHandoff(actor.organizationId);
    return projectExpositionForAudience({
      session,
      policy: this.policy,
      projector: { id: 'presenter-preview', kind: 'AUDIENCE_PROJECTOR', allowedLayers: this.policy.allowedLayers },
      handoffGeneration: active?.sessionId === sessionId ? active.generation : 0,
    });
  }

  async activeProjector(actor: ExpositionActor): Promise<AudienceProjection> {
    const active = await this.options.repository.activeHandoff(actor.organizationId);
    if (!active) throw new ExpositionSessionNotFoundError('Активный экспозиционный показ не назначен');
    const session = (await this.get(active.sessionId, actor)).session;
    return projectExpositionForAudience({
      session,
      policy: this.policy,
      projector: this.projectorProfile(actor),
      handoffGeneration: active.generation,
    });
  }

  async exportArchive(actor: ExpositionActor, sessionId: string, archiveId?: string): Promise<DerivedExpositionArchive> {
    return exportExpositionArchive({ session: (await this.get(sessionId, actor)).session, policy: this.policy, archiveId });
  }
}
