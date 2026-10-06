/**
 * Шкала времени под картой: момент, на который показана обстановка.
 * Время показывается московское и местное (по поясу места событий); вводится —
 * в выбранном поясе. Проигрывание плавное, со скоростью «часов модельного
 * времени в секунду». Выключена — показаны все знаки сразу (как без времени).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MOSCOW_TZ, documentMoments, isDateOnly, timelineRange, toTime, type MapDocument, type TimeInstant } from '@def-ops/core';
import { DAY, HOUR, ZONE_CHOICES, clock, fmtMoment, fromMs, useZones, zoneName, zoneOffsetLabel } from './time';
import { MomentInput } from './MomentInput';

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  time: TimeInstant | null;
  setTime: (t: TimeInstant | null) => void;
  /** Новые знаки появляются на карте с текущего момента. */
  newFromNow: boolean;
  setNewFromNow: (v: boolean) => void;
  /** Пояс местного времени по месту на карте (если для карты не задан вручную). */
  autoZone: string;
}

/** Скорость проигрывания: часов модельного времени за секунду. */
const SPEEDS: [number, string][] = [[1, '1 ч/с'], [3, '3 ч/с'], [6, '6 ч/с'], [12, '12 ч/с'], [24, '1 сут/с'], [72, '3 сут/с']];

export function Timeline({ doc, setDoc, time, setTime, newFromNow, setNewFromNow, autoZone }: Props) {
  const { local, localFixed } = useZones();
  const range = timelineRange(doc);
  const moments = useMemo(() => documentMoments(doc), [doc]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('def_ops.speed')) || 6);
  const on = time !== null;

  const start = range ? toTime(range.start) : 0;
  const end = range ? Math.max(toTime(range.end), start + DAY) : 0;
  const cur = time ? toTime(time) : start;

  // плавное проигрывание: кадр за кадром, шаг — по прошедшему реальному времени
  const live = useRef({ cur, end, speed, setTime });
  live.current = { cur, end, speed, setTime };
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), pos = live.current.cur;
    const step = (now: number) => {
      const { end, speed, setTime } = live.current;
      pos += ((now - last) / 1000) * speed * HOUR;
      last = now;
      if (pos >= end) { setTime(fromMs(end)); setPlaying(false); return; }
      // точность модельного времени — минута (строка момента без секунд)
      setTime(fromMs(Math.floor(pos / 60000) * 60000));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const setTimeline = (p: Partial<NonNullable<MapDocument['timeline']>>) => {
    const base = doc.timeline ?? (range ? { start: range.start, end: range.end } : { start: '1945-04-16', end: '1945-05-09' });
    setDoc({ ...doc, timeline: { ...base, ...p } }, 'timeline');
  };
  const setRange = (s: string, e: string) => {
    if (!s || !e) return;
    const [a, b] = s <= e ? [s, e] : [e, s];
    setTimeline({ start: a, end: b });
  };

  const jump = (dir: 1 | -1) => {
    const list = moments.map(toTime);
    const t = dir > 0 ? list.find((m) => m > cur) : [...list].reverse().find((m) => m < cur);
    if (t !== undefined) setTime(fromMs(t));
  };

  if (!on) {
    return (
      <div className="timeline off">
        <button onClick={() => setTime(range ? (doc.timeline?.current ?? range.start) : '1945-04-16')}
          title="Показывать обстановку на выбранный момент: знаки появляются и перемещаются по датам">
          ⏱ Обстановка на дату
        </button>
        <span className="muted">{moments.length ? `в карте ${moments.length} ${plural(moments.length, 'дата', 'даты', 'дат')} изменений` : 'знаки показаны без учёта времени'}</span>
      </div>
    );
  }

  const motion = doc.timeline?.motion ?? 'smooth';
  const dateOnly = isDateOnly(time!);
  return (
    <div className="timeline">
      <div className="tl-row">
        <button className="link" title="Выключить время — показать все знаки" onClick={() => { setPlaying(false); setTime(null); }}>✕</button>
        <div className="tl-now">
          <b>{fmtMoment(dateOnly ? time : fromMs(toTime(time!)), false).replace(/, \d\d:\d\d мск$/, '')}</b>
          <span className="tl-clocks">
            <span title="Московское время">{clock(time!, MOSCOW_TZ)} мск</span>
            {local !== MOSCOW_TZ && <span title={`Местное время: ${zoneName(local)}, ${zoneOffsetLabel(time!, local)}`}>{clock(time!, local)} местн. <span className="muted">({zoneName(local)}, {zoneOffsetLabel(time!, local)})</span></span>}
          </span>
        </div>
        <button title="Предыдущая дата изменений" onClick={() => jump(-1)}>⏮</button>
        <button title="Минус сутки (Shift — час)" onClick={(e) => setTime(fromMs(cur - (e.shiftKey ? HOUR : DAY)))}>◀</button>
        <button title={playing ? 'Стоп' : 'Проиграть'} onClick={() => setPlaying(!playing)}>{playing ? '■' : '▶'}</button>
        <button title="Плюс сутки (Shift — час)" onClick={(e) => setTime(fromMs(cur + (e.shiftKey ? HOUR : DAY)))}>▶</button>
        <button title="Следующая дата изменений" onClick={() => jump(1)}>⏭</button>
        <select value={speed} title="Скорость проигрывания" onChange={(e) => { setSpeed(+e.target.value); try { localStorage.setItem('def_ops.speed', e.target.value); } catch { /* */ } }}>
          {SPEEDS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <MomentInput value={time} onChange={(t) => t && setTime(t)} title="Точный момент" />
        <span className="sep" />
        <label className="muted" title="Как знаки меняют положение между датами (у знака можно задать своё)">переход
          <select value={motion} onChange={(e) => setTimeline({ motion: e.target.value as 'smooth' | 'step' })}>
            <option value="smooth">плавно</option>
            <option value="step">скачком</option>
          </select>
        </label>
        <label className="muted" title="Пояс местного времени: по месту на карте или выбранный для карты">местное
          <select value={localFixed ? local : ''} onChange={(e) => setTimeline({ localZone: e.target.value || null })}>
            <option value="">по карте ({zoneName(autoZone)})</option>
            {ZONE_CHOICES.map((z) => <option key={z} value={z}>{zoneName(z)}</option>)}
          </select>
        </label>
        <label className="muted" title="Новые знаки появляются на карте с текущего момента (до него их нет)">
          <input type="checkbox" checked={newFromNow} onChange={(e) => setNewFromNow(e.target.checked)} /> новые — с этой даты
        </label>
        <span className="muted">период</span>
        <input type="date" value={range?.start.slice(0, 10) ?? ''} onChange={(e) => setRange(e.target.value, range?.end ?? e.target.value)} />
        <span className="muted">—</span>
        <input type="date" value={range?.end.slice(0, 10) ?? ''} onChange={(e) => setRange(range?.start ?? e.target.value, e.target.value)} />
      </div>
      {range && (
        <div className="tl-track">
          <input type="range" min={start} max={end} step={10 * 60000} value={Math.min(Math.max(cur, start), end)}
            onChange={(e) => { setPlaying(false); setTime(fromMs(Math.round(+e.target.value / 600000) * 600000)); }} />
          <div className="tl-marks">
            {moments.map((m) => {
              const x = (toTime(m) - start) / (end - start);
              if (x < 0 || x > 1) return null;
              return <span key={m} className="tl-mark" style={{ left: `${x * 100}%` }} title={fmtMoment(m, false, local)} onClick={() => setTime(m)} />;
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
