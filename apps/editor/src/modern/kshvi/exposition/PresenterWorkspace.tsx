import { useState } from 'react';
import {
  controlExposition,
  decisionAt,
  planFactAt,
  type ExpositionSession,
  type PresenterCommand,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import { AudienceProjector, type AudienceProjectionView } from './AudienceProjector';
import { ChapterTimeline } from './ChapterTimeline';
import './exposition.css';

export function PresenterWorkspace({ session, projection, onSessionChange, onContinueFromCheckpoint }: {
  session: ExpositionSession;
  projection: AudienceProjectionView;
  onSessionChange(session: ExpositionSession): void;
  onContinueFromCheckpoint?: (checkpointId: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [checkpointId, setCheckpointId] = useState(session.program.allowedCheckpointIds[0] ?? '');
  const currentChapter = session.program.chapters.find(chapter => chapter.id === session.playback.chapterId) ?? session.program.chapters[0];
  const comparison = planFactAt(session, session.playback.atMs);
  const decisionFrame = session.program.frames.find(frame => frame.decision);
  const decision = decisionFrame?.decision ? decisionAt(session, decisionFrame.decision.id) : null;
  const allowedCheckpoints = session.checkpoints.filter(checkpoint => session.program.allowedCheckpointIds.includes(checkpoint.id));

  function apply(command: PresenterCommand): void {
    onSessionChange(controlExposition(session, command));
  }

  function nextCameraKeyframe(): void {
    const frames = session.program.cameraRoute.keyframes;
    const next = frames.find(frame => frame.atMs > session.playback.atMs) ?? frames[0];
    apply({ type: 'SEEK', atMs: next.atMs });
  }

  return <main className={`exposition-presenter${preview ? ' is-projector-preview' : ''}`}>
    <header className="exposition-presenter-header">
      <div>
        <div className="exposition-badges"><span className="exposition-badge">Экспозиция</span><span>{session.source === 'ARCHIVE' ? 'Архивный показ' : 'Автономный расчёт'}</span></div>
        <h1>{session.program.title}</h1>
        <p>Текущая глава: {currentChapter.title}</p>
      </div>
      <button type="button" onClick={() => setPreview(value => !value)}>{preview ? 'Вернуться к ведущему' : 'Предпросмотр аудитории'}</button>
    </header>

    {preview ? <AudienceProjector projection={projection} preview /> : <div className="exposition-presenter-grid">
      <div className="exposition-map-column">
        <AudienceProjector projection={projection} />
        <ChapterTimeline
          chapters={session.program.chapters}
          currentChapterId={session.playback.chapterId}
          currentMs={session.playback.atMs}
          onChapter={chapterId => apply({ type: 'SEEK_CHAPTER', chapterId })}
          onSeek={atMs => apply({ type: 'SEEK', atMs })}
        />
      </div>
      <aside className="exposition-presenter-controls" aria-label="Управление ведущего">
        <section><h2>Показ</h2>
          <div className="exposition-control-row">
            <button type="button" className="exposition-primary" onClick={() => apply({ type: session.playback.status === 'PLAYING' ? 'PAUSE' : 'PLAY' })}>
              {session.playback.status === 'PLAYING' ? 'Приостановить показ' : 'Запустить показ'}
            </button>
            <button type="button" onClick={() => apply({ type: 'SET_TEMPO', tempo: Math.min(8, session.playback.tempo * 2) })}>Ускорить ×2</button>
          </div>
          <p>Темп: {session.playback.tempo}×</p>
          <button type="button" onClick={nextCameraKeyframe}>Следующий кадр камеры</button>
        </section>

        {comparison && <section><h2>Замысел / факт</h2>
          <p>Замысел: {comparison.plan}</p><p>Факт: {comparison.fact}</p>
        </section>}

        {decision && <section><h2>Решение</h2>
          <button type="button" onClick={() => setDecisionOpen(value => !value)}>{decisionOpen ? 'Закрыть решение' : 'Открыть решение'}</button>
          {decisionOpen && <article className="exposition-decision-card"><h3>Карточка решения</h3><p>{decision.summary}</p>{decision.hiddenRationale && <p>{decision.hiddenRationale}</p>}</article>}
        </section>}

        <section><h2>Демонстрационная ветвь</h2>
          <p>Ветвь: {session.branchId}</p>
          {session.source === 'AUTONOMOUS' && <>
            <label>Контрольная точка
              <select value={checkpointId} onChange={event => setCheckpointId(event.target.value)}>
                {allowedCheckpoints.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.id} · {(checkpoint.atMs / 1_000).toFixed(1)} с</option>)}
              </select>
            </label>
            <button type="button" disabled={!checkpointId || !onContinueFromCheckpoint} onClick={() => onContinueFromCheckpoint?.(checkpointId)}>Продолжить от контрольной точки</button>
          </>}
          {session.program.branches.map(branch => <p key={branch.id}>Ветвь программы: {branch.title}</p>)}
        </section>
      </aside>
    </div>}
  </main>;
}
