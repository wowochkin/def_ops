import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createAutonomyProfile, createRehearsalRunReport, loadEventCatalog, rehearseCatalog, scheduleOperationalRange,
  updateAutonomyProfile, SCHEDULER_ALGORITHM_VERSION,
  type AutonomyProfile, type CatalogManifest, type EventTemplate, type RehearsalReport, type SchedulerRuntimeState, type SchedulerTarget,
} from '@def-ops/kshvi-events';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { ExerciseStoreError, type ExerciseActor, type ExerciseCard, type ExerciseStore } from '../store/exercise-store';
import { readPreparation, savePreparation } from './draft-access';

export type AutonomyAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN_DATA';
export type AutonomyCatalogItem = Readonly<{ template: EventTemplate; availability: AutonomyAvailability; reasons: readonly string[] }>;

const reasonLabels: Record<string, string> = {
  PRECONDITION_UNKNOWN: 'Недостаточно данных для проверки предусловия',
  PRECONDITION_FAILED: 'Предусловие текущего сценария не выполнено',
  ENVIRONMENT_COVERAGE_MISSING: 'Нет покрытия среды для выбранного района',
  AREA_NOT_APPLICABLE: 'Район не входит в область применимости события',
  SIDE_NOT_APPLICABLE: 'Сторона не входит в область применимости события',
  STAGE_NOT_APPLICABLE: 'Этап не входит в область применимости события',
  SCALE_NOT_APPLICABLE: 'Масштаб не соответствует событию',
  OUTSIDE_BOUNDING_BOX: 'Позиция находится вне географии события',
  OUTSIDE_OPERATIONAL_WINDOW: 'Событие недоступно в выбранном оперативном окне',
  OBSERVATION_SOURCE_UNAVAILABLE: 'Нет источника наблюдения',
  OBSERVATION_CHANNEL_UNAVAILABLE: 'Нет канала доведения наблюдения',
  RESOURCE_INSUFFICIENT: 'Недостаточно ресурсов для последствий события',
  SEVERITY_LIMIT: 'Превышена допустимая тяжесть',
  SEVERITY_BUDGET_EXCEEDED: 'Исчерпан бюджет тяжести этапа',
  MUTUALLY_EXCLUDED: 'Событие исключено уже выбранным событием',
};
const unknownReasons = new Set(['PRECONDITION_UNKNOWN', 'ENVIRONMENT_COVERAGE_MISSING', 'OBSERVATION_SOURCE_UNAVAILABLE', 'OBSERVATION_CHANNEL_UNAVAILABLE']);

function targetsOf(draft: PreparationDraft): SchedulerTarget[] {
  const targets = (draft.initialMap?.markers ?? []).filter(marker => marker.geometry).map(marker => {
    const geometry = marker.geometry!;
    const point = geometry.type === 'Point' ? geometry.coordinates : geometry.type === 'LineString' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
    return {
      sideId: marker.sideId || 'UNKNOWN', areaId: marker.kind === 'AREA' ? marker.id : draft.initialMap!.id,
      ...(point ? { longitude: point[0], latitude: point[1] } : {}),
    } satisfies SchedulerTarget;
  });
  if (targets.length) return targets;
  const forces = draft.forces.map(force => ({
    sideId: force.identity.sideId || 'UNKNOWN',
    areaId: force.position.area.status === 'KNOWN' && typeof force.position.area.value === 'string' ? force.position.area.value : 'UNASSIGNED',
  }));
  return forces.length ? forces : [{ sideId: 'UNKNOWN', areaId: 'UNASSIGNED' }];
}

function runtimeOf(draft: PreparationDraft, targets: readonly SchedulerTarget[], operationalSecond = 0): SchedulerRuntimeState {
  return {
    stageId: 'preparation', scale: 'operational', operationalSecond, facts: {}, resources: [],
    availableObservationSourceIds: [], availableChannelIds: [],
    environmentCoverageAreaIds: draft.environmentSnapshotId ? [...new Set(targets.map(target => target.areaId))] : [],
    occurrences: [], intervalEventCount: 0, stageEventCount: 0, stageSeverityCost: 0,
  };
}

export class AutonomyService {
  private catalogPromise: Promise<{ templates: EventTemplate[]; manifest: CatalogManifest; issues: readonly { severity: string; message: string }[] }> | null = null;

  constructor(private readonly store: ExerciseStore, private readonly directory = resolve('packages/kshvi-events/data/catalog')) {}

  private async catalog() {
    this.catalogPromise ??= loadEventCatalog(this.directory);
    const catalog = await this.catalogPromise;
    const errors = catalog.issues.filter(issue => issue.severity === 'ERROR');
    if (errors.length) throw new ExerciseStoreError('VALIDATION', `Каталог событий не прошёл проверку: ${errors.map(issue => issue.message).join('; ')}`);
    return catalog;
  }

  private profile(draft: PreparationDraft, exerciseId: string): AutonomyProfile {
    return draft.autonomy ?? createAutonomyProfile({ profileId: `autonomy-${exerciseId}`, level: 'MEDIUM' });
  }

  async describe(actor: ExerciseActor, exerciseId: string) {
    const [{ card, draft }, catalog] = await Promise.all([readPreparation(this.store, actor.organizationId, exerciseId), this.catalog()]);
    const profile = this.profile(draft, exerciseId);
    const targets = targetsOf(draft);
    const state = runtimeOf(draft, targets);
    const items = catalog.templates.map(template => {
      const evaluations = targets.map((target, index) => {
        const result = requireCandidate(template, profile, state, target, card.revisions[card.revisions.length - 1]!.sha256, String(catalog.manifest.version), index);
        return result.trace.candidates[0]?.rejectionReasons ?? ['NO_ELIGIBLE_CANDIDATES'];
      });
      const available = evaluations.some(reasons => reasons.length === 0);
      const reasons = [...new Set(evaluations.flat())];
      const availability: AutonomyAvailability = available ? 'AVAILABLE' : reasons.length && reasons.every(reason => unknownReasons.has(reason)) ? 'UNKNOWN_DATA' : 'UNAVAILABLE';
      return { template, availability, reasons: reasons.map(reason => reasonLabels[reason] ?? reason) } satisfies AutonomyCatalogItem;
    });
    return { manifest: catalog.manifest, profile, targets, items };
  }

  async saveProfile(actor: ExerciseActor, exerciseId: string, input: { expectedRevision: number; profile: AutonomyProfile }): Promise<ExerciseCard> {
    const { card, draft } = await readPreparation(this.store, actor.organizationId, exerciseId);
    if (card.revision !== input.expectedRevision) throw new ExerciseStoreError('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const profile = draft.autonomy
      ? updateAutonomyProfile(draft.autonomy, { level: input.profile.level, settings: input.profile.settings, intensity: input.profile.intensity }, card.state)
      : createAutonomyProfile({
        profileId: input.profile.profileId, level: input.profile.level,
        ...(input.profile.level === 'CUSTOM' ? { settings: input.profile.settings } : {}), intensity: input.profile.intensity,
      });
    return savePreparation(this.store, actor, exerciseId, input.expectedRevision, { ...draft, autonomy: profile });
  }

  async rehearse(actor: ExerciseActor, exerciseId: string, input: { seeds: readonly string[]; fromSecond: number; toSecond: number }) {
    const [{ card, draft }, catalog] = await Promise.all([readPreparation(this.store, actor.organizationId, exerciseId), this.catalog()]);
    if (!input.seeds.length || new Set(input.seeds).size !== input.seeds.length || input.toSecond <= input.fromSecond) {
      throw new ExerciseStoreError('VALIDATION', 'Репетиция требует уникальные зёрна и положительный интервал');
    }
    const profile = this.profile(draft, exerciseId);
    const targets = targetsOf(draft);
    const state = runtimeOf(draft, targets, input.fromSecond);
    const base = {
      templates: catalog.templates, profile, state, targets, branchId: exerciseId,
      snapshotHash: card.revisions[card.revisions.length - 1]!.sha256, templateSetVersion: String(catalog.manifest.version),
      plannedReactiveEvents: [],
    };
    let report: RehearsalReport;
    if (profile.settings.attemptsPerOperationalHour === 0) {
      const runs = input.seeds.map(seed => createRehearsalRunReport({
        seed, profile, templates: catalog.templates,
        result: scheduleOperationalRange({ ...base, seed, fromSecond: input.fromSecond, toSecond: input.toSecond, instanceState: 'ACTIVE' }),
      }));
      report = { reportVersion: 1, algorithmVersion: SCHEDULER_ALGORITHM_VERSION, catalogVersion: String(catalog.manifest.version), methodicalProfile: profile.methodicalProfile, runs };
    } else {
      report = rehearseCatalog({ ...base, seeds: input.seeds, fromSecond: input.fromSecond, toSecond: input.toSecond });
    }
    return { ...report, sha256: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  }
}

function requireCandidate(template: EventTemplate, profile: AutonomyProfile, state: SchedulerRuntimeState, target: SchedulerTarget, snapshotHash: string, templateSetVersion: string, index: number) {
  // Импорт локализован здесь, чтобы вся проверка использовала тот же кандидатский контур, что и репетиция.
  return candidateSelector({
    templates: [template], category: template.category, profile, state, target,
    interval: { index: 0, startSecond: state.operationalSecond, endSecond: state.operationalSecond + 3600 },
    attemptOrdinal: index + 1, seed: 'catalog-availability', branchId: 'catalog', snapshotHash, templateSetVersion,
  });
}

import { selectCandidate as candidateSelector } from '@def-ops/kshvi-events';
