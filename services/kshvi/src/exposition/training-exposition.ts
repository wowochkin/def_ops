import balancedProfile from '../../../../packages/kshvi-agents/data/modern-profiles/balanced.json' with { type: 'json' };
import type { AgentEnginePort } from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../../packages/kshvi-agents/src/ports/modern-choice';
import { createAudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import { createCameraRoute } from '../../../../packages/kshvi/src/exposition/camera-route';
import { createExpositionProgram } from '../../../../packages/kshvi/src/exposition/exposition-program';
import {
  worldAtExposition,
  type OfficialExpositionArchive,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import { emptyWorld } from '../../../../packages/kshvi/src/model/world';
import { RustWorker } from '../agents/rust-worker';
import { ExpositionSessionService } from './exposition-session-service';
import { createProjectorProfile } from './exposition-projection';
import { SystemAgentExpositionCalculator } from './system-agent-calculator';

export const TRAINING_PROJECTOR_ID = 'exposition-projector';

export function trainingExpositionArchive(): OfficialExpositionArchive {
  const initialWorld = emptyWorld('training-exposition');
  initialWorld.resources.fuel = { onHand: 100, consumed: 0, supplied: 0, deficit: 0 };
  const journal = [{
    eventId: 'training-official-event-1', sequence: 1, atMs: 1_000, type: 'resource.consumed.v1',
    payload: { resourceId: 'fuel', amount: 5, supplied: 0 },
  }];
  return {
    archiveId: 'training-official-archive', branchId: 'training-conduct-branch', manifestHash: 'b'.repeat(64),
    journal,
    checkpoints: [{
      id: 'training-archive-cp', atMs: 1_000, journalCursor: 1, scenarioCursor: 1,
      world: worldAtExposition(initialWorld, journal, 1_000),
    }],
    officialAssessments: [{ id: 'training-official-assessment', score: 4 }],
    map: {
      weather: { summary: 'Пасмурно, видимость 8 км', serviceIntent: 'Служебные данные не публикуются' },
      terrain: {
        summary: 'Лесной массив и рубеж высоты',
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: 'Лесной массив', kind: 'forest' }, geometry: { type: 'Polygon', coordinates: [[[29.8, 50.1], [30.25, 50.05], [30.35, 50.35], [29.95, 50.42], [29.8, 50.1]]] } },
            { type: 'Feature', properties: { name: 'Рубеж высоты', kind: 'ridge' }, geometry: { type: 'LineString', coordinates: [[29.75, 49.95], [30.05, 50.04], [30.4, 49.98], [30.65, 50.08]] } },
            { type: 'Feature', properties: { name: 'Река', kind: 'water' }, geometry: { type: 'LineString', coordinates: [[29.7, 49.8], [29.95, 50.02], [30.2, 50.25], [30.55, 50.45]] } },
          ],
        },
      },
      logistics: {
        summary: 'Склад и маршрут подвоза',
        geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Склад МТО', kind: 'depot' }, geometry: { type: 'Point', coordinates: [29.95, 49.92] } }] },
      },
      routes: {
        geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Маршрут подвоза' }, geometry: { type: 'LineString', coordinates: [[29.95, 49.92], [30.08, 50.02], [30.25, 50.14]] } }] },
      },
      modernSymbols: [{ id: 'training-battalion', label: 'Батальон', side: 'BLUE', position: [30.25, 50.14] }],
      serviceIntent: 'Скрытый служебный замысел официального учения',
    },
    demonstration: {
      scenarioId: 'training-exposition', initialWorld,
      catalog: { id: 'modern-events', version: 'catalog-1' },
      systemSides: [
        { sideId: 'BLUE', agentId: 'agent-blue', profileVersion: 'modern-blue-1' },
        { sideId: 'RED', agentId: 'agent-red', profileVersion: 'modern-red-1' },
      ],
      rules: { reducerVersion: 1, profileVersion: 'full-simulation-1' },
      events: [
        { eventId: 'training-demo-event-1', atMs: 1_000, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 10, supplied: 0 }, checkpointId: 'cp-1' },
        { eventId: 'training-demo-event-2', atMs: 2_000, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 20, supplied: 5 }, checkpointId: 'cp-2' },
      ],
    },
  };
}

export function trainingExpositionProgram() {
  return createExpositionProgram({
    id: 'training-exposition-program', title: 'Демонстрация «Рубеж»',
    chapters: [
      { id: 'chapter-1', title: 'Исходная обстановка', startMs: 0, endMs: 1_000, frameIds: ['frame-1'], pauseAfterMs: 500 },
      { id: 'chapter-2', title: 'Развитие действий', startMs: 1_000, endMs: 3_000, frameIds: ['frame-2'], pauseAfterMs: 0 },
    ],
    frames: [
      { id: 'frame-1', atMs: 1_000, title: 'Первое решение', caption: 'Силы выдвигаются к рубежу', decision: { id: 'decision-1', summary: 'Удерживать рубеж', hiddenRationale: 'Закрытое обоснование решения' } },
      { id: 'frame-2', atMs: 2_000, title: 'Подвоз', caption: 'МТО пополняет запасы' },
    ],
    cameraRoute: createCameraRoute([
      { id: 'camera-1', atMs: 0, center: [30.1, 50.1], zoom: 9, heading: 0 },
      { id: 'camera-2', atMs: 2_000, center: [30.25, 50.14], zoom: 11, heading: 45 },
    ]),
    layers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'routes'], tempo: 1, pauseMs: 500,
    captions: [{ id: 'caption-public', atMs: 1_000, text: 'Публичная подпись' }],
    explanations: [
      { id: 'explanation-public', atMs: 1_000, text: 'Пояснение для аудитории', audience: true },
      { id: 'explanation-secret', atMs: 1_000, text: 'Служебный замысел ведущего', audience: false },
    ],
    branches: [{ id: 'branch-new', title: 'Альтернативное развитие', fromCheckpointId: 'cp-1', chapterIds: ['chapter-2'] }],
    allowedCheckpointIds: ['cp-1'],
    planFact: [{ id: 'comparison-1', atMs: 1_000, plan: 'Удержать исходный рубеж', fact: 'Рубеж удержан' }],
  });
}

export function createTrainingExpositionService(engine?: AgentEnginePort): ExpositionSessionService {
  let worker: AgentEnginePort | undefined = engine;
  const lazyEngine: AgentEnginePort = {
    async evaluateChoices(request) {
      worker ??= new RustWorker();
      return worker.evaluateChoices(request);
    },
    async close() { await worker?.close?.(); },
  };
  return new ExpositionSessionService({
    sourceArchive: trainingExpositionArchive(),
    program: trainingExpositionProgram(),
    calculator: new SystemAgentExpositionCalculator({
      engine: lazyEngine,
      profileFor: side => assertModernAgentProfile({ ...balancedProfile, id: side.agentId, version: side.profileVersion }),
    }),
    policy: createAudiencePolicy({
      id: 'training-audience-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
      showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicDecisionIds: [],
    }),
    projectors: [createProjectorProfile({
      id: TRAINING_PROJECTOR_ID, allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'routes'],
    })],
  });
}
