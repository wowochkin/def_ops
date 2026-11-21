import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createCameraRoute,
  createExpositionProgram,
  emptyWorld,
  startArchiveShow,
  type ExpositionSession,
  type OfficialExpositionArchive,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import type { AudienceProjectionView } from './AudienceProjector';
import { ExpositionEditor } from './ExpositionEditor';
import { PresenterWorkspace } from './PresenterWorkspace';
import './exposition.css';

function browserProgram() {
  return createExpositionProgram({
    id: 'browser-program', title: 'Демонстрация «Рубеж»',
    chapters: [
      { id: 'chapter-1', title: 'Исходная обстановка', startMs: 0, endMs: 1_000, frameIds: ['frame-1'], pauseAfterMs: 500 },
      { id: 'chapter-2', title: 'Развитие действий', startMs: 1_000, endMs: 3_000, frameIds: ['frame-2'], pauseAfterMs: 0 },
    ],
    frames: [
      { id: 'frame-1', atMs: 1_000, title: 'Первое решение', caption: 'Силы выдвигаются к рубежу', decision: { id: 'decision-1', summary: 'Удерживать рубеж', hiddenRationale: 'Закрытое обоснование решения' } },
      { id: 'frame-2', atMs: 2_000, title: 'Подвоз', caption: 'МТО пополняет запасы' },
    ],
    cameraRoute: createCameraRoute([
      { id: 'camera-1', atMs: 0, center: [30, 50], zoom: 6, heading: 0 },
      { id: 'camera-2', atMs: 2_000, center: [32, 52], zoom: 8, heading: 90 },
    ]),
    layers: ['weather', 'terrain', 'logistics', 'modern-symbols'], tempo: 1, pauseMs: 500,
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

function browserArchive(): OfficialExpositionArchive {
  const world = emptyWorld('browser-demo');
  world.resources.fuel = { onHand: 95, consumed: 5, supplied: 0, deficit: 0 };
  return {
    archiveId: 'browser-official-archive', branchId: 'browser-conduct-branch', manifestHash: 'b'.repeat(64),
    journal: [{ eventId: 'browser-event-1', sequence: 1, atMs: 1_000, type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 5, supplied: 0 } }],
    checkpoints: [{ id: 'archive-cp', atMs: 1_000, journalCursor: 1, world }],
    officialAssessments: [{ id: 'browser-official-assessment', score: 4 }],
    map: {
      weather: { summary: 'Пасмурно, видимость 8 км' }, terrain: { summary: 'Лес и рубеж высоты' },
      logistics: { summary: 'Склад и маршрут подвоза' }, modernSymbols: [{ id: 'symbol-1', label: 'Батальон', side: 'BLUE' }],
      serviceIntent: 'Скрытый служебный замысел',
    },
    demonstration: {
      scenarioId: 'browser-demo', initialWorld: world, catalog: { id: 'modern-events', version: 'catalog-1' },
      systemSides: [{ sideId: 'BLUE', agentId: 'agent-blue', profileVersion: 'modern-blue-1' }],
      rules: { reducerVersion: 1, profileVersion: 'full-simulation-1' }, events: [],
    },
  };
}

function createBrowserSession(): ExpositionSession {
  return startArchiveShow({
    sourceArchive: browserArchive(), program: browserProgram(), sessionId: 'browser-exposition', branchId: 'browser-exposition-branch',
  });
}

/** Имитация уже полученной с сервера проекции для автономного browser entry без Node-зависимостей. */
function browserProjection(session: ExpositionSession): AudienceProjectionView {
  return {
    sessionId: session.sessionId, branchId: session.branchId, purpose: 'EXPOSITION', label: 'Экспозиция', source: session.source,
    playback: session.playback, projectorProfile: { id: 'browser-projector', kind: 'AUDIENCE_PROJECTOR' },
    program: {
      id: session.program.id, title: session.program.title, chapters: session.program.chapters,
      frames: session.program.frames.map(frame => ({ id: frame.id, atMs: frame.atMs, title: frame.title, caption: frame.caption })),
      cameraRoute: session.program.cameraRoute, layers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
      tempo: session.program.tempo, pauseMs: session.program.pauseMs,
      captions: session.program.captions.filter(caption => caption.id === 'caption-public'),
      explanations: session.program.explanations.filter(explanation => explanation.audience),
      branches: session.program.branches.map(branch => ({ id: branch.id, title: branch.title, chapterIds: branch.chapterIds })),
    },
    map: {
      weather: session.map.weather, terrain: session.map.terrain, logistics: session.map.logistics, modernSymbols: session.map.modernSymbols,
    },
    planFact: session.program.planFact, decision: null,
  };
}

export function BrowserExpositionApp() {
  const [session, setSession] = useState(createBrowserSession);
  const [mode, setMode] = useState<'presenter' | 'editor'>('presenter');
  return <div className="exposition-browser-shell">
    <nav className="exposition-browser-nav" aria-label="Экспозиционный browser entry">
      <strong>Показ КШВИ</strong>
      <div><button type="button" onClick={() => setMode('presenter')}>Ведущий показ</button><button type="button" onClick={() => setMode('editor')}>Редактор программы</button></div>
    </nav>
    {mode === 'presenter' ? <PresenterWorkspace session={session} projection={browserProjection(session)} onSessionChange={setSession} />
      : <ExpositionEditor program={session.program} onChange={program => setSession(current => ({ ...current, program }))} />}
  </div>;
}

const root = document.getElementById('exposition-browser-root');
if (root) createRoot(root).render(<BrowserExpositionApp />);
