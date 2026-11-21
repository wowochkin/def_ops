import {
  cameraAt,
  type AudienceLayer,
  type ExpositionChapter,
  type ExpositionProgram,
  type ExpositionSession,
  type PlanFactComparison,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';

export type AudienceProjectionView = Readonly<{
  sessionId: string;
  branchId: string;
  purpose: 'EXPOSITION';
  label: 'Экспозиция';
  source: 'ARCHIVE' | 'AUTONOMOUS';
  playback: ExpositionSession['playback'];
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
  return <section className={`exposition-audience${preview ? ' is-preview' : ''}`} aria-label="Аудиторная проекция экспозиции" data-testid="audience-projection">
    <header className="exposition-map-header">
      <div><span className="exposition-badge">Экспозиция</span><h2>{program.title}</h2></div>
      <span>Камера · масштаб {camera.zoom.toFixed(1)}</span>
    </header>
    <div className="exposition-map-stage">
      <svg className="exposition-map-drawing" viewBox="0 0 800 420" role="img" aria-label="Схема общей карты с местностью и современными знаками">
        <rect width="800" height="420" className="exposition-map-ground" />
        {visible('terrain') && <g className="exposition-terrain">
          <path d="M0 310 C160 230 230 340 390 270 S650 190 800 250 V420 H0Z" />
          <path d="M80 90 l30 55 h-60z M130 65 l38 70 h-76z M190 105 l28 52 h-56z" />
          <text x="55" y="195">Лесной массив</text>
        </g>}
        {visible('logistics') && <g className="exposition-logistics">
          <path d="M110 355 C260 300 370 340 640 120" />
          <rect x="75" y="330" width="42" height="32" />
          <text x="52" y="388">Склад МТО</text>
        </g>}
        {visible('routes') && <path className="exposition-route" d="M170 280 L390 205 L630 160" />}
        {visible('modern-symbols') && <g className="exposition-unit-mark" transform="translate(410 145)">
          <rect width="96" height="58" /><path d="M0 0 L96 58 M96 0 L0 58" /><text x="48" y="82">Современный знак</text>
        </g>}
      </svg>
      <div className="exposition-map-legend">
        {visible('weather') && <p>{`Погода: ${summary(map.weather)}`}</p>}
        {visible('terrain') && <p>{`Местность: ${summary(map.terrain)}`}</p>}
        {visible('logistics') && <p>{`МТО: ${summary(map.logistics)}`}</p>}
        {visible('modern-symbols') && <div className="exposition-symbol-list" aria-label="Современные знаки">
          {symbols(map.modernSymbols).map(symbol => <span key={symbol.id}>{symbol.label}</span>)}
        </div>}
      </div>
      <div className="exposition-public-notes">
        {program.captions.map(caption => <p key={caption.id}>{caption.text}</p>)}
        {program.explanations.map(explanation => <p key={explanation.id}>{explanation.text}</p>)}
      </div>
    </div>
    <footer className="exposition-projector-footer">Проекторный профиль: {projection.projectorProfile.id}</footer>
  </section>;
}
