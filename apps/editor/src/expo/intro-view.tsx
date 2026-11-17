/** Монтаж визитной карточки: общий голос и тринадцать самостоятельных сцен. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LINES } from './lines';
import { INTRO_CUES, INTRO_FACTORS, introCueAt } from './intro-story';
import type { IntroFrame, IntroPane } from './intro-scene';
import archiveMap from '../../demo/reference/berlin-atlas.jpg';
import archivePhoto from './pictures/berlin-guns.jpg';
import cityPhoto from './pictures/city-tanks.jpg';
import './intro.css';

export interface IntroViewProps {
  pane: IntroPane;
  line?: number;
  elapsedMs?: number;
  cueElapsedMs?: number;
  cueDurationMs?: number;
  paused?: boolean;
  onSkip?: () => void;
  onSelectScene?: (line: number) => void;
}

function SceneGraphics({ scene }: { scene: string }) {
  if (scene === 'archive') return <div className="intro-archive" aria-hidden="true">
    <figure className="intro-record intro-record-map"><img src={archiveMap} alt="" /><figcaption>КАРТОГРАФИЯ / БЕРЛИНСКАЯ ОПЕРАЦИЯ</figcaption></figure>
    <figure className="intro-record intro-record-photo"><img src={archivePhoto} alt="" /><figcaption>ФОТОХРОНИКА / АРТИЛЛЕРИЯ НА ПОЗИЦИЯХ</figcaption></figure>
    <div className="intro-record-index"><span>ИЗВЛЕЧЕНИЕ СВЕДЕНИЙ</span><b>Соединение</b><b>Положение</b><b>Состояние</b><b>Время</b><i>Данные → Модель</i></div>
  </div>;
  if (scene === 'math') return <div className="intro-math" aria-hidden="true">
    <div className="intro-equation">S<span>t + Δt</span><em>=</em> F <small>( состояние, приказы, среда )</small></div>
    <div className="intro-stateflow">{['Исходная обстановка', 'Движение и бой', 'Потери и расход', 'Новое состояние'].map((s, i) => <div key={s} style={{ '--i': i } as CSSProperties}><span>0{i + 1}</span><b>{s}</b><i /></div>)}</div>
    <p>ПОСЛЕДОВАТЕЛЬНЫЙ РАСЧЁТ ИЗМЕНЕНИЙ</p>
  </div>;
  if (scene === 'factors') return <div className="intro-factor-field" aria-label="Факторы модели">{INTRO_FACTORS.map((f, i) => <div key={f} style={{ '--i': i } as CSSProperties}><span>{String(i + 1).padStart(2, '0')}</span>{f}</div>)}</div>;
  if (scene === 'ai') return <div className="intro-analysis" aria-hidden="true"><span>СВЕДЕНИЯ</span><div className="intro-analysis-flow"><b>Обстановка</b><i>→</i><b>Связи и риски</b><i>→</i><b>Варианты действий</b></div><strong>Аргументы для решения</strong></div>;
  if (scene === 'berlin') return <div className="intro-berlin" aria-hidden="true"><img src={cityPhoto} alt="" /><span>БЕРЛИН / 1945</span><b>Историческая основа.<br />Пространство для новых решений.</b></div>;
  if (scene === 'scale') return <div className="intro-scale" aria-hidden="true"><span>АРХИТЕКТУРА РАЗВИТИЯ</span><div><b>Историческая<br />операция</b><i>→</i><b>Другие театры<br />и задачи</b><i>→</i><b>Оперативные<br />данные</b></div><p>Новые источники · Настройка модели · Проверка результатов</p></div>;
  return null;
}

export function IntroView({ pane, line = 1, elapsedMs = 0, cueElapsedMs, cueDurationMs, paused = false, onSkip, onSelectScene }: IntroViewProps) {
  const index = Math.max(0, Math.min(INTRO_CUES.length - 1, line - 1));
  const cue = INTRO_CUES[index];
  const fallback = introCueAt(elapsedMs);
  const localElapsed = cueElapsedMs ?? (fallback.line === line ? elapsedMs - fallback.start : 0);
  const duration = cueDurationMs ?? cue.durationMs;
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef({ line, elapsedMs, localElapsed, duration, paused, receivedAt: performance.now() });
  const previous = frame.current;
  // Повторная публикация того же состояния (например, подключение бокового окна)
  // не должна отбрасывать интерполированный кадр к прошлому такту режиссёра.
  if (previous.line !== line || previous.elapsedMs !== elapsedMs || previous.localElapsed !== localElapsed || previous.paused !== paused) {
    frame.current = { line, elapsedMs, localElapsed, duration, paused, receivedAt: performance.now() };
  } else previous.duration = duration;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const abort = new AbortController();
    let dispose: (() => void) | undefined;
    setUnavailable(false);
    const current = (): IntroFrame => {
      const f = frame.current;
      const delta = f.paused ? 0 : performance.now() - f.receivedAt;
      return { line: f.line, elapsedMs: f.elapsedMs + delta, progress: Math.max(0, Math.min(1, (f.localElapsed + delta) / f.duration)), paused: f.paused };
    };
    void import('./intro-scene').then(({ mountIntroScene }) => {
      if (abort.signal.aborted) return;
      return mountIntroScene(el, pane, current, abort.signal);
    }).then((stop) => {
      dispose = stop;
      if (abort.signal.aborted) dispose?.();
    }).catch(() => { if (!abort.signal.aborted) setUnavailable(true); });
    return () => { abort.abort(); dispose?.(); };
  }, [pane]);

  const selectScene = (next: number) => {
    if (!paused && next >= 1 && next <= INTRO_CUES.length) onSelectScene?.(next);
  };
  return <section className={`expo-intro3d expo-intro3d-${pane} intro-scene-${cue.scene}${unavailable ? ' intro-no-webgl' : ''}${onSelectScene ? ' intro-with-navigation' : ''}`} data-line={index + 1} data-scene={cue.scene} aria-label="Интро сеанса" style={{ '--cue-duration': `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' } as CSSProperties}>
    <div className="expo-intro3d-host" ref={host} aria-hidden="true" />
    <div className="intro-scan" aria-hidden="true" />
    <div className="expo-intro3d-shade" aria-hidden="true" />
    <div className="intro-montage" key={cue.key}>
      {pane === 'film' && <SceneGraphics scene={cue.scene} />}
      {pane === 'film' && <div className="intro-heading">
        <p className="intro-chapter"><i />{cue.chapter}</p>
        <h1 className="expo-intro3d-title">{cue.title}</h1>
        {pane === 'film' && <p className="intro-detail">{cue.detail}</p>}
      </div>}
      {pane !== 'film' && <div className="intro-side-caption">{pane === 'factors' ? 'Взаимосвязи факторов' : 'Пространство вариантов'}</div>}
    </div>
    {pane === 'film' && <><div className="intro-sequence" aria-hidden="true"><b>{String(index + 1).padStart(2, '0')}</b><span>/ {INTRO_CUES.length}</span></div>
    <div className="intro-subtitle"><span className="intro-subtitle-mark" aria-hidden="true">▰</span><p className="expo-intro3d-line" aria-live="off">{LINES.say[cue.key]?.[0]}</p></div>
    <footer><span className="expo-intro3d-email">info@profdailog.ru</span><span className="intro-footer-name">ДАННЫЕ → МОДЕЛЬ → РЕШЕНИЕ</span>{pane === 'film' && onSkip && <button type="button" className="expo-intro3d-skip" onClick={onSkip}>Пропустить <span aria-hidden="true">↗</span></button>}</footer></>}
    {onSelectScene ? <nav className="intro-scene-navigation" aria-label="Сцены интро">
      <button type="button" className="intro-scene-arrow" aria-label="Предыдущая сцена" title="Предыдущая сцена" disabled={paused || index === 0} onClick={() => selectScene(index)}>←</button>
      {INTRO_CUES.map((c, i) => {
        const name = c.chapter.replace(/^\d+\s*\/\s*/, '');
        return <button type="button" key={c.key} className={`intro-scene-link ${i < index ? 'is-done' : i === index ? 'is-current' : ''}`} aria-label={`Перейти к сцене ${i + 1}: ${name}`} aria-current={i === index ? 'step' : undefined} disabled={paused} onClick={() => selectScene(i + 1)}>
          <span className="intro-scene-tooltip" aria-hidden="true">{name}</span>
          <span className="intro-scene-track" aria-hidden="true"><i style={{ transform: `scaleX(${i < index ? 1 : i === index ? Math.min(1, localElapsed / duration) : 0})` }} /></span>
        </button>;
      })}
      <button type="button" className="intro-scene-arrow" aria-label="Следующая сцена" title="Следующая сцена" disabled={paused || index === INTRO_CUES.length - 1} onClick={() => selectScene(index + 2)}>→</button>
    </nav> : <div className="intro-timeline" aria-hidden="true">{INTRO_CUES.map((c, i) => <span key={c.key} className={i < index ? 'is-done' : i === index ? 'is-current' : ''}><i style={{ transform: `scaleX(${i < index ? 1 : i === index ? Math.min(1, localElapsed / duration) : 0})` }} /></span>)}</div>}
  </section>;
}
