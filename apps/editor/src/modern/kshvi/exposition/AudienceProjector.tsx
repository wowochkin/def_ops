import {
  cameraAt,
  type AudienceLayer,
  type ExpositionChapter,
  type ExpositionPlayback,
  type ExpositionProgram,
  type PlanFactComparison,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import { ExpositionMap } from './ExpositionMap';

export type AudienceProjectionView = Readonly<{
  sessionId: string;
  branchId: string;
  purpose: 'EXPOSITION';
  label: 'Экспозиция';
  source: 'ARCHIVE' | 'AUTONOMOUS';
  playback: ExpositionPlayback;
  projectorProfile: Readonly<{ id: string; kind: 'AUDIENCE_PROJECTOR' }>;
  program: Readonly<{
    id: string;
    title: string;
    chapters: readonly ExpositionChapter[];
    frames: readonly Readonly<{ id: string; atMs: number; title: string; caption: string }>[];
    cameraRoute: ExpositionProgram['cameraRoute'];
    layers: readonly AudienceLayer[];
    tempo: number;
    pauseMs: number;
    captions: ExpositionProgram['captions'];
    explanations: ExpositionProgram['explanations'];
    branches: readonly Readonly<{ id: string; title: string; chapterIds: readonly string[] }>[];
  }>;
  map: Readonly<{
    weather?: unknown;
    terrain?: unknown;
    logistics?: unknown;
    modernSymbols?: unknown;
    forces?: unknown;
    routes?: unknown;
  }>;
  planFact: readonly PlanFactComparison[];
  decision: Readonly<{ id: string; summary: string }> | null;
}>;

function summary(value: unknown): string {
  if (value && typeof value === 'object' && 'summary' in value && typeof value.summary === 'string') return value.summary;
  return typeof value === 'string' ? value : 'Данные слоя не опубликованы';
}

function symbols(value: unknown): readonly Readonly<{ id: string; label: string }>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => item && typeof item === 'object' && 'id' in item && 'label' in item
    && typeof item.id === 'string' && typeof item.label === 'string' ? [{ id: item.id, label: item.label }] : []);
}

export function AudienceProjector({ projection, preview = false }: {
  projection: AudienceProjectionView;
  preview?: boolean;
}) {
  const { program, map } = projection;
  const visible = (layer: AudienceLayer) => program.layers.includes(layer);
  const camera = cameraAt(program.cameraRoute, projection.playback.atMs);
  return <section className={`exposition-audience${preview ? ' is-preview' : ''}`} aria-label="Аудиторная проекция экспозиции" data-testid="audience-projection" data-session-id={projection.sessionId}>
    <header className="exposition-map-header">
      <div><span className="exposition-badge">Экспозиция</span><h2>{program.title}</h2></div>
      <span>Камера · центр {camera.center.map(value => value.toFixed(2)).join(', ')} · масштаб {camera.zoom.toFixed(1)} · поворот {camera.heading.toFixed(0)}°</span>
    </header>
    <div className="exposition-map-stage">
      <ExpositionMap map={map} layers={program.layers} camera={camera} />
      <div className="exposition-map-legend">
        {visible('weather') && <p>{`Погода: ${summary(map.weather)}`}</p>}
        {visible('terrain') && <p>{`Местность: ${summary(map.terrain)}`}</p>}
        {visible('logistics') && <p>{`МТО: ${summary(map.logistics)}`}</p>}
        {visible('modern-symbols') && <div className="exposition-symbol-list" aria-label="Современные знаки">
          {symbols(map.modernSymbols).map(symbol => <span key={symbol.id}>{symbol.label}</span>)}
        </div>}
      </div>
      <div className="exposition-public-notes">
        {program.captions.filter(caption => caption.atMs <= projection.playback.atMs).map(caption => <p key={caption.id}>{caption.text}</p>)}
        {program.explanations.filter(explanation => explanation.atMs <= projection.playback.atMs).map(explanation => <p key={explanation.id}>{explanation.text}</p>)}
      </div>
    </div>
    <footer className="exposition-projector-footer">Проекторный профиль: {projection.projectorProfile.id}</footer>
  </section>;
}
