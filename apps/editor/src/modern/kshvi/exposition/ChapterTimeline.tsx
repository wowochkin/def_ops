import type { ExpositionChapter } from '../../../../../../packages/kshvi/src/exposition/browser-entry';

export function ChapterTimeline({ chapters, currentChapterId, currentMs, onChapter, onSeek }: {
  chapters: readonly ExpositionChapter[];
  currentChapterId: string;
  currentMs: number;
  onChapter(chapterId: string): void;
  onSeek(atMs: number): void;
}) {
  const duration = Math.max(1, ...chapters.map(chapter => chapter.endMs));
  return <section className="exposition-timeline" aria-label="Сценарий глав и шкала показа">
    <div className="exposition-chapters">
      {chapters.map((chapter, index) => <button
        type="button"
        key={chapter.id}
        className={chapter.id === currentChapterId ? 'is-current' : undefined}
        aria-current={chapter.id === currentChapterId ? 'step' : undefined}
        aria-label={chapter.title}
        onClick={() => onChapter(chapter.id)}
      >
        <span>{String(index + 1).padStart(2, '0')}</span>{chapter.title}
      </button>)}
    </div>
    <label>Шкала показа
      <input
        type="range"
        min={0}
        max={duration}
        step={100}
        value={currentMs}
        onChange={event => onSeek(Number(event.target.value))}
      />
    </label>
    <output>{(currentMs / 1_000).toFixed(1)} с / {(duration / 1_000).toFixed(1)} с</output>
  </section>;
}
