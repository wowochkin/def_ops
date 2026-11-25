import { createHash } from 'node:crypto';
import { advanceReadiness, authorizePartialReadiness, type ReadinessAdvanceInput, type ReadinessStage } from '../../../../packages/kshvi/src/forces/readiness-stage';
import type { ReadinessAuthorization, ReadinessReport, ReadinessState } from '../../../../packages/kshvi/src/forces/readiness';
import type { PreparationDraft, ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import { validateFormation } from '../../../../packages/kshvi/src/forces/formation-validation';
import { validateSupplyPlan } from '../../../../packages/kshvi/src/logistics/supply-request';
import { ExerciseStoreError, type ExerciseActor, type ExerciseCard, type ExerciseStore } from '../store/exercise-store';
import { readPreparation, savePreparation } from './draft-access';

export type ReadinessSignalReport = Readonly<{ id: string; authorId: string; submittedAt: string; text: string }>;
export type ReadinessCommandInput = Readonly<{
  expectedRevision: number;
  at: string;
  signalReport?: ReadinessSignalReport;
  completions?: ReadinessAdvanceInput['completions'];
  criteria?: ReadinessAdvanceInput['criteria'];
  failures?: ReadinessAdvanceInput['failures'];
}>;

function initialState(force: ScenarioForce): ReadinessState {
  return {
    subjectId: force.id, subjectKind: 'FORCE', initialLevel: typeof force.state.readiness === 'number' ? force.state.readiness : null,
    requiredLevel: 1, status: 'NOT_STARTED', completedActivityIds: [], activityRecords: [], reports: [],
    criterionResults: {}, limitations: [], authorizations: [], history: [],
  };
}

function withSignalReport(state: ReadinessState, report: ReadinessSignalReport | undefined): ReadinessState {
  if (!report || state.reports.some(item => item.id === report.id)) return state;
  const entry: ReadinessReport = { ...report };
  return { ...state, reports: [...state.reports, entry] };
}

export class ReadinessService {
  constructor(private readonly store: ExerciseStore) {}

  async saveStage(actor: ExerciseActor, exerciseId: string, input: { expectedRevision: number; stage: ReadinessStage }): Promise<ExerciseCard> {
    const { card, draft } = await readPreparation(this.store, actor.organizationId, exerciseId);
    if (card.revision !== input.expectedRevision) throw new ExerciseStoreError('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const states = draft.forces.map(force => draft.readinessStates.find(state => state.subjectKind === 'FORCE' && state.subjectId === force.id) ?? initialState(force));
    return savePreparation(this.store, actor, exerciseId, input.expectedRevision, { ...draft, readinessStage: input.stage, readinessStates: states });
  }

  private advanceStates(draft: PreparationDraft, input: Omit<ReadinessCommandInput, 'expectedRevision'>): ReadinessState[] {
    if (!draft.readinessStage) throw new ExerciseStoreError('VALIDATION', 'Сначала задайте этап боевой готовности');
    if (input.signalReport) {
      const report = input.signalReport;
      const knownAuthor = draft.forces.some(force => force.identity.nodeId === report.authorId)
        || draft.readinessStage.activities.some(activity => activity.responsibleNodeId === report.authorId)
        || draft.readinessStage.signal.senderNodeId === report.authorId;
      if (!report.id.trim() || !report.text.trim() || !knownAuthor || !Number.isFinite(Date.parse(report.submittedAt))) {
        throw new ExerciseStoreError('VALIDATION', 'Подтверждение сигнала требует идентификатор, известного автора, время и содержание');
      }
    }
    return draft.readinessStates.map(previous => advanceReadiness(draft.readinessStage!, withSignalReport(previous, input.signalReport), {
      at: input.at,
      ...(input.signalReport ? { signalReceivedAt: input.signalReport.submittedAt } : {}),
      ...(input.completions ? { completions: input.completions } : {}),
      ...(input.criteria ? { criteria: input.criteria } : {}),
      ...(input.failures ? { failures: input.failures } : {}),
    }));
  }

  async advance(actor: ExerciseActor, exerciseId: string, input: ReadinessCommandInput): Promise<ExerciseCard> {
    const { card, draft } = await readPreparation(this.store, actor.organizationId, exerciseId);
    if (card.revision !== input.expectedRevision) throw new ExerciseStoreError('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const readinessStates = this.advanceStates(draft, input);
    if (JSON.stringify(readinessStates) === JSON.stringify(draft.readinessStates)) return card;
    return savePreparation(this.store, actor, exerciseId, input.expectedRevision, { ...draft, readinessStates });
  }

  async authorizePartial(actor: ExerciseActor, exerciseId: string, input: {
    expectedRevision: number;
    decision: Omit<ReadinessAuthorization, 'actorRole' | 'authorities'>;
  }): Promise<ExerciseCard> {
    const { card, draft } = await readPreparation(this.store, actor.organizationId, exerciseId);
    if (card.revision !== input.expectedRevision) throw new ExerciseStoreError('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    if (actor.userId !== input.decision.actorId || !actor.activeRole || !actor.authorities) {
      throw new ExerciseStoreError('FORBIDDEN', 'Решение должен принять уполномоченный руководитель');
    }
    const readinessStates = draft.readinessStates.map(state => authorizePartialReadiness(state, {
      ...input.decision, actorRole: actor.activeRole!, authorities: actor.authorities!,
    }, {
      userId: actor.userId, activeRole: actor.activeRole!, organizationId: actor.organizationId, authorities: actor.authorities!,
    }));
    return savePreparation(this.store, actor, exerciseId, input.expectedRevision, { ...draft, readinessStates });
  }

  async rehearse(actor: ExerciseActor, exerciseId: string, input: Omit<ReadinessCommandInput, 'expectedRevision'>) {
    const { draft } = await readPreparation(this.store, actor.organizationId, exerciseId);
    const readinessStates = this.advanceStates(draft, input);
    const report = {
      isolated: true,
      readinessStates,
      formation: draft.formation ? validateFormation(draft.formation) : null,
      logistics: draft.logistics ? validateSupplyPlan(draft.logistics) : null,
    };
    return { ...report, sha256: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  }
}
