import type {
  AudienceLayer,
  ExpositionProgram,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import './exposition.css';

const LAYER_LABELS: Readonly<Record<AudienceLayer, string>> = {
  weather: 'Погода', terrain: 'Местность', logistics: 'МТО', 'modern-symbols': 'Современные знаки', forces: 'Силы', routes: 'Маршруты',
};

export function ExpositionEditor({ program, onChange }: {
  program: ExpositionProgram;
  onChange(program: ExpositionProgram): void;
}) {
  const update = (patch: Partial<ExpositionProgram>) => onChange({ ...program, ...patch });
  const lastChapterEnd = program.chapters.at(-1)?.endMs ?? 0;
  const lastCamera = program.cameraRoute.keyframes.at(-1);
  return <main className="exposition-editor">
    <header><span className="exposition-badge">Экспозиция</span><h1>Редактор программы показа</h1><p>Все изменения относятся только к демонстрационной ветви.</p></header>
    <div className="exposition-editor-grid">
      <section><h2>Программа</h2>
        <label>Название программы<input value={program.title} onChange={event => update({ title: event.target.value })} /></label>
        <label>Темп показа<input type="number" min={0.25} max={8} step={0.25} value={program.tempo} onChange={event => update({ tempo: Number(event.target.value) })} /></label>
        <label>Пауза после показа, мс<input type="number" min={0} step={50} value={program.pauseMs} onChange={event => update({ pauseMs: Number(event.target.value) })} /></label>
        <fieldset><legend>Видимые слои общей карты</legend>
          {(Object.entries(LAYER_LABELS) as [AudienceLayer, string][]).map(([layer, label]) => <label key={layer} className="exposition-check">
            <input type="checkbox" checked={program.layers.includes(layer)} onChange={() => update({
              layers: program.layers.includes(layer) ? program.layers.filter(item => item !== layer) : [...program.layers, layer],
            })} />{label}
          </label>)}
        </fieldset>
      </section>

      <section><h2>Главы и ключевые кадры</h2>
        {program.chapters.map((chapter, index) => <article className="exposition-editor-row" key={chapter.id}>
          <label>Название главы {index + 1}<input value={chapter.title} onChange={event => update({
            chapters: program.chapters.map(item => item.id === chapter.id ? { ...item, title: event.target.value } : item),
          })} /></label>
          <label>Начало главы {index + 1}<input type="number" min={0} value={chapter.startMs} onChange={event => update({
            chapters: program.chapters.map(item => item.id === chapter.id ? { ...item, startMs: Number(event.target.value) } : item),
          })} /></label>
          <label>Окончание главы {index + 1}<input type="number" min={1} value={chapter.endMs} onChange={event => update({
            chapters: program.chapters.map(item => item.id === chapter.id ? { ...item, endMs: Number(event.target.value) } : item),
          })} /></label>
          <label>Пауза после главы {index + 1}<input type="number" min={0} value={chapter.pauseAfterMs} onChange={event => update({
            chapters: program.chapters.map(item => item.id === chapter.id ? { ...item, pauseAfterMs: Number(event.target.value) } : item),
          })} /></label>
        </article>)}
        <button type="button" onClick={() => update({ chapters: [...program.chapters, {
          id: `chapter-${program.chapters.length + 1}`, title: 'Новая глава', startMs: lastChapterEnd,
          endMs: lastChapterEnd + 1_000, frameIds: [], pauseAfterMs: program.pauseMs,
        }] })}>Добавить главу</button>
        {program.frames.map((frame, index) => <label key={frame.id}>Подпись ключевого кадра {index + 1}
          <input value={frame.caption} onChange={event => update({
            frames: program.frames.map(item => item.id === frame.id ? { ...item, caption: event.target.value } : item),
          })} />
        </label>)}
        <button type="button" onClick={() => {
          const id = `frame-${program.frames.length + 1}`;
          update({
            frames: [...program.frames, { id, atMs: lastChapterEnd, title: 'Новый ключевой кадр', caption: 'Подпись кадра' }],
            chapters: program.chapters.map((chapter, index) => index === program.chapters.length - 1 ? { ...chapter, frameIds: [...chapter.frameIds, id] } : chapter),
          });
        }}>Добавить ключевой кадр</button>
      </section>

      <section><h2>Маршрут камеры</h2>
        {program.cameraRoute.keyframes.map((frame, index) => <article className="exposition-editor-row" key={frame.id}>
          <label>Время камеры {index + 1}<input type="number" min={0} value={frame.atMs} onChange={event => update({
            cameraRoute: { keyframes: program.cameraRoute.keyframes.map(item => item.id === frame.id ? { ...item, atMs: Number(event.target.value) } : item) },
          })} /></label>
          <label>Масштаб камеры {index + 1}<input type="number" min={0.1} step={0.5} value={frame.zoom} onChange={event => update({
            cameraRoute: { keyframes: program.cameraRoute.keyframes.map(item => item.id === frame.id ? { ...item, zoom: Number(event.target.value) } : item) },
          })} /></label>
          <label>Поворот камеры {index + 1}<input type="number" value={frame.heading} onChange={event => update({
            cameraRoute: { keyframes: program.cameraRoute.keyframes.map(item => item.id === frame.id ? { ...item, heading: Number(event.target.value) } : item) },
          })} /></label>
        </article>)}
        <button type="button" onClick={() => update({ cameraRoute: { keyframes: [...program.cameraRoute.keyframes, {
          id: `camera-${program.cameraRoute.keyframes.length + 1}`, atMs: (lastCamera?.atMs ?? 0) + 1_000,
          center: lastCamera?.center ?? [30, 50], zoom: lastCamera?.zoom ?? 6, heading: lastCamera?.heading ?? 0,
        }] } })}>Добавить кадр камеры</button>
      </section>

      <section><h2>Подписи и пояснения</h2>
        {program.captions.map((caption, index) => <label key={caption.id}>{index === 0 ? 'Подпись для аудитории' : `Подпись для аудитории ${index + 1}`}
          <textarea value={caption.text} onChange={event => update({
            captions: program.captions.map(item => item.id === caption.id ? { ...item, text: event.target.value } : item),
          })} />
        </label>)}
        <button type="button" onClick={() => update({ captions: [...program.captions, {
          id: `caption-${program.captions.length + 1}`, atMs: 0, text: 'Новая подпись',
        }] })}>Добавить подпись</button>
        {program.explanations.map((explanation, index) => <label key={explanation.id}>{index === 0 ? 'Пояснение ведущего' : `Пояснение ведущего ${index + 1}`}
          <textarea value={explanation.text} onChange={event => update({
            explanations: program.explanations.map(item => item.id === explanation.id ? { ...item, text: event.target.value } : item),
          })} />
        </label>)}
        <button type="button" onClick={() => update({ explanations: [...program.explanations, {
          id: `explanation-${program.explanations.length + 1}`, atMs: 0, text: 'Новое пояснение', audience: false,
        }] })}>Добавить пояснение</button>
      </section>

      <section><h2>Ветви показа</h2>
        {program.branches.map((branch, index) => <label key={branch.id}>Название ветви {index + 1}
          <input value={branch.title} onChange={event => update({
            branches: program.branches.map(item => item.id === branch.id ? { ...item, title: event.target.value } : item),
          })} />
        </label>)}
        <button type="button" onClick={() => update({ branches: [...program.branches, {
          id: `branch-${program.branches.length + 1}`, title: 'Новая ветвь',
          fromCheckpointId: program.allowedCheckpointIds[0] ?? '', chapterIds: program.chapters.at(-1) ? [program.chapters.at(-1)!.id] : [],
        }] })}>Добавить ветвь</button>
      </section>
    </div>
  </main>;
}
