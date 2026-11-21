import { emptyWorld } from '../../src/model/world';
import type { OfficialExpositionArchive } from '../../src/exposition/exposition-session';
import { createCameraRoute } from '../../src/exposition/camera-route';
import { createExpositionProgram, type ExpositionProgram } from '../../src/exposition/exposition-program';

export function expositionProgram(): ExpositionProgram {
  return createExpositionProgram({
    id: 'program-1',
    title: 'Демонстрация «Рубеж»',
    chapters: [
      { id: 'chapter-1', title: 'Исходная обстановка', startMs: 0, endMs: 1_000, frameIds: ['frame-1'], pauseAfterMs: 500 },
      { id: 'chapter-2', title: 'Развитие действий', startMs: 1_000, endMs: 3_000, frameIds: ['frame-2'], pauseAfterMs: 0 },
    ],
    frames: [
      {
        id: 'frame-1', atMs: 1_000, title: 'Первое решение', caption: 'Силы выдвигаются к рубежу',
        decision: { id: 'decision-1', summary: 'Удерживать рубеж', hiddenRationale: 'Закрытое обоснование решения' },
      },
      { id: 'frame-2', atMs: 2_000, title: 'Подвоз', caption: 'МТО пополняет запасы' },
    ],
    cameraRoute: createCameraRoute([
      { id: 'camera-1', atMs: 0, center: [30, 50], zoom: 6, heading: 0 },
      { id: 'camera-2', atMs: 2_000, center: [32, 52], zoom: 8, heading: 90 },
    ]),
    layers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
    tempo: 1,
    pauseMs: 500,
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

export function officialArchive(): OfficialExpositionArchive {
  const initialWorld = emptyWorld('demo-scenario');
  initialWorld.resources.fuel = { onHand: 100, consumed: 0, supplied: 0, deficit: 0 };
  return {
    archiveId: 'official-archive-1',
    branchId: 'conduct-branch-1',
    manifestHash: 'a'.repeat(64),
    journal: [{
      eventId: 'official-event-1', sequence: 1, atMs: 1_000, type: 'resource.consumed.v1',
      payload: { resourceId: 'fuel', amount: 5, supplied: 0 },
    }],
    checkpoints: [{ id: 'archive-cp', atMs: 1_000, journalCursor: 1, world: structuredClone(initialWorld) }],
    officialAssessments: [{ id: 'official-assessment-1', score: 4 }],
    map: {
      weather: { summary: 'Пасмурно, видимость 8 км' },
      terrain: { summary: 'Лес и рубеж высоты' },
      logistics: { summary: 'Склад и маршрут подвоза' },
      modernSymbols: [{ id: 'symbol-1', label: 'Батальон', side: 'BLUE' }],
      serviceIntent: 'Скрытый служебный замысел',
    },
    demonstration: {
      scenarioId: 'demo-scenario',
      initialWorld,
      catalog: { id: 'modern-events', version: 'catalog-1' },
      systemSides: [
        { sideId: 'BLUE', agentId: 'agent-blue', profileVersion: 'modern-blue-1' },
        { sideId: 'RED', agentId: 'agent-red', profileVersion: 'modern-red-1' },
      ],
      rules: { reducerVersion: 1, profileVersion: 'full-simulation-1' },
      events: [
        {
          eventId: 'demo-event-1', atMs: 1_000, type: 'resource.consumed.v1',
          payload: { resourceId: 'fuel', amount: 10, supplied: 0 }, checkpointId: 'cp-1',
        },
        {
          eventId: 'demo-event-2', atMs: 2_000, type: 'resource.consumed.v1',
          payload: { resourceId: 'fuel', amount: 20, supplied: 5 }, checkpointId: 'cp-2',
        },
      ],
    },
  };
}
