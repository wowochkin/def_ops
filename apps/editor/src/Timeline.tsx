/**
 * Шкала времени под картой: момент, на который показана обстановка.
 * Выключена — показаны все знаки сразу (как без времени).
 */
import { useEffect, useMemo, useState } from 'react';
import { documentMoments, timelineRange, toTime, type MapDocument, type TimeInstant } from '@def-ops/core';
import { DAY, HOUR, fmtMoment, fromInput, fromMs, toInput } from './time';

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  time: TimeInstant | null;
  setTime: (t: TimeInstant | null) => void;
  /** Новые знаки появляются на карте с текущего момента. */
  newFromNow: boolean;
  setNewFromNow: (v: boolean) => void;
}

export function Timeline({ doc, setDoc, time, setTime, newFromNow, setNewFromNow }: Props) {
  const range = timelineRange(doc);
  const moments = useMemo(() => documentMoments(doc), [doc]);
  const [playing, setPlaying] = useState(false);
  const on = time !== null;

  const start = range ? toTime(range.start) : 0;
  const end = range ? Math.max(toTime(range.end), start + DAY) : 0;
  const cur = time ? toTime(time) : start;

  // проигрывание: шаг — сутки
  useEffect(() => {
    if (!playing || !time) return;
    const t = setTimeout(() => {
      const next = toTime(time) + DAY;
      if (next > end) { setPlaying(false); return; }
      setTime(fromMs(next));
    }, 700);
    return () => clearTimeout(t);
  }, [playing, time, end, setTime]);

  const setRange = (s: TimeInstant | null, e: TimeInstant | null) => {
    if (!s || !e) return;
    const [a, b] = toTime(s) <= toTime(e) ? [s, e] : [e, s];
    setDoc({ ...doc, timeline: { start: a, end: b, current: doc.timeline?.current ?? null } }, 'timeline');
  };

  const jump = (dir: 1 | -1) => {
    const x = cur;
    const list = moments.map(toTime);
    const t = dir > 0 ? list.find((m) => m > x) : [...list].reverse().find((m) => m < x);
    if (t !== undefined) setTime(fromMs(t));
  };

  if (!on) {
    return (
      <div className="timeline off">
        <button onClick={() => setTime(range ? (doc.timeline?.current ?? range.start) : fromMs(Date.UTC(1945, 3, 16)))}
          title="Показывать обстановку на выбранный момент: знаки появляются и перемещаются по датам">
          ⏱ Обстановка на дату
        </button>
        <span className="muted">{moments.length ? `в карте ${moments.length} ${plural(moments.length, 'дата', 'даты', 'дат')} изменений` : 'знаки показаны без учёта времени'}</span>
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="tl-row">
        <button className="link" title="Выключить время — показать все знаки" onClick={() => { setPlaying(false); setTime(null); }}>✕</button>
        <b className="tl-now">{fmtMoment(time)}</b>
        <button title="Предыдущая дата изменений" onClick={() => jump(-1)}>⏮</button>
        <button title="Минус сутки (Shift — час)" onClick={(e) => setTime(fromMs(cur - (e.shiftKey ? HOUR : DAY)))}>◀</button>
        <button title={playing ? 'Стоп' : 'Проиграть по суткам'} onClick={() => setPlaying(!playing)}>{playing ? '■' : '▶'}</button>
        <button title="Плюс сутки (Shift — час)" onClick={(e) => setTime(fromMs(cur + (e.shiftKey ? HOUR : DAY)))}>▶</button>
        <button title="Следующая дата изменений" onClick={() => jump(1)}>⏭</button>
        <input type="datetime-local" value={toInput(time)} onChange={(e) => { const t = fromInput(e.target.value); if (t) setTime(t); }} title="Точный момент (время — UTC)" />
        <label className="muted" title="Новые знаки появляются на карте с текущего момента (до него их нет)">
          <input type="checkbox" checked={newFromNow} onChange={(e) => setNewFromNow(e.target.checked)} /> новые — с этой даты
        </label>
        <span className="sep" />
        <span className="muted">период</span>
        <input type="date" value={range ? toInput(range.start).slice(0, 10) : ''} onChange={(e) => setRange(fromInput(e.target.value + 'T00:00'), range?.end ?? fromInput(e.target.value + 'T00:00'))} />
        <span className="muted">—</span>
        <input type="date" value={range ? toInput(range.end).slice(0, 10) : ''} onChange={(e) => setRange(range?.start ?? fromInput(e.target.value + 'T00:00'), fromInput(e.target.value + 'T00:00'))} />
      </div>
      {range && (
        <div className="tl-track">
          <input type="range" min={start} max={end} step={HOUR} value={Math.min(Math.max(cur, start), end)}
            onChange={(e) => setTime(fromMs(Math.round(+e.target.value / HOUR) * HOUR))} />
          <div className="tl-marks">
            {moments.map((m) => {
              const x = (toTime(m) - start) / (end - start);
              if (x < 0 || x > 1) return null;
              return <span key={m} className="tl-mark" style={{ left: `${x * 100}%` }} title={fmtMoment(m)} onClick={() => setTime(m)} />;
            })}
          </div>
          <div className="tl-ends"><span>{fmtMoment(range.start, true)}</span><span>{fmtMoment(fromMs(end), true)}</span></div>
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
